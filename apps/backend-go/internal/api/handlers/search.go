package handlers

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/metrics"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/search"
	"github.com/google/uuid"
)

// SearchHandler handles full-text search across users, boards, threads, and posts.
type SearchHandler struct {
	db            *sql.DB
	searchService *search.Service // optional — nil falls back to PostgreSQL FTS
}

// NewSearchHandler creates a new SearchHandler.
func NewSearchHandler(db *sql.DB) *SearchHandler {
	return &SearchHandler{db: db}
}

// SetSearchService injects the Meilisearch engine. A nil (or disabled) service
// keeps the PostgreSQL full-text fallback in charge.
func (h *SearchHandler) SetSearchService(s *search.Service) {
	h.searchService = s
}

// SearchResult is the unified response for the search endpoint.
type SearchResult struct {
	Users   []map[string]interface{} `json:"users"`
	Boards  []map[string]interface{} `json:"boards"`
	Threads []map[string]interface{} `json:"threads"`
	Posts   []map[string]interface{} `json:"posts"`
}

// Per-category result caps. They match the historical SQL limits so the
// client-side slicing in the UI keeps working unchanged.
const (
	defaultUserLimit   = 24
	defaultBoardLimit  = 24
	defaultThreadLimit = 60
	defaultPostLimit   = 30
	maxSearchLimit     = 100
)

// searchOptions carries the parsed optional filters.
type searchOptions struct {
	types    map[string]bool // nil = every category
	authorID string          // resolved UUID, "" = no author filter
	since    int64           // unix seconds, 0 = no date filter
	recent   bool            // sort by created_at desc
	limit    int             // 0 = per-category default
}

func (o searchOptions) wants(category string) bool {
	return o.types == nil || o.types[category]
}

func (o searchOptions) sortClause() []string {
	if !o.recent {
		return nil // Meilisearch relevance order
	}
	return []string{"created_at:desc"}
}

func (o searchOptions) limitFor(def int) int {
	if o.limit > 0 {
		return o.limit
	}
	return def
}

// Search performs a full-text search across all searchable entities.
// GET /api/v1/search?q=...&type=threads,posts&author=<uuid|username>&since=30d&sort=recent&limit=50
//
// When a Meilisearch engine is configured the query is served by it (typo
// tolerance, prefix matching, filters); otherwise — or if the engine errors —
// the PostgreSQL full-text path runs instead.
//
// Search godoc
// @Summary      Full-text search
// @Description  Search across users, boards, threads, and posts
// @Tags         Search
// @Produce      json
// @Param        q query string true "Search query (min 2 chars)"
// @Param        type query string false "Categories: users,boards,threads,posts (default all)"
// @Param        author query string false "Restrict threads/posts to an author (UUID or username)"
// @Param        since query string false "Only results created after (unix seconds or 30d/12h/2w/6m/1y)"
// @Param        sort query string false "'recent' sorts by creation date, otherwise relevance"
// @Param        limit query int false "Per-category result cap (max 100)"
// @Success      200 {object} models.APIResponse
// @Router       /search [get]
func (h *SearchHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" || len([]rune(q)) < 2 {
		c.JSON(http.StatusOK, models.SuccessResponse(emptySearchResult()))
		return
	}

	// Viewer identity (anonymous when no token). Used both for the SQL privacy
	// gate and the private-profile fallback on the engine path.
	var sqlViewerID interface{}
	viewerID := ""
	if claims, ok := c.Get("claims"); ok {
		if uc, ok2 := claims.(*auth.Claims); ok2 && uc != nil && uc.UserID != "" {
			sqlViewerID = uc.UserID
			viewerID = uc.UserID
		}
	}

	opts := searchOptions{
		types:  parseSearchTypes(c.Query("type")),
		since:  parseSince(c.Query("since")),
		recent: strings.EqualFold(strings.TrimSpace(c.Query("sort")), "recent"),
		limit:  parseSearchLimit(c.Query("limit")),
	}

	metrics.App.SearchRequested()

	// An author filter that names nobody yields no results rather than silently
	// dropping the filter and returning everything.
	if author := strings.TrimSpace(c.Query("author")); author != "" {
		opts.authorID = h.resolveAuthorID(c.Request.Context(), author)
		if opts.authorID == "" {
			c.JSON(http.StatusOK, models.SuccessResponse(emptySearchResult()))
			return
		}
	}

	var result SearchResult
	if h.searchService != nil && h.searchService.Enabled() {
		result = h.searchViaEngine(c.Request.Context(), q, viewerID, sqlViewerID, opts)
	} else {
		result = h.searchViaSQL(c.Request.Context(), q, sqlViewerID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// searchViaEngine serves the query from Meilisearch. It degrades to the SQL
// path on any engine error so a search outage never becomes an API outage.
func (h *SearchHandler) searchViaEngine(ctx context.Context, q, viewerID string, sqlViewerID interface{}, opts searchOptions) SearchResult {
	result := emptySearchResult()

	sinceClause := ""
	if opts.since > 0 {
		sinceClause = "created_at >= " + strconv.FormatInt(opts.since, 10)
	}
	authorClause := ""
	if opts.authorID != "" {
		// authorID is a validated UUID, never raw user text.
		authorClause = "author_id = " + strconv.Quote(opts.authorID)
	}

	// Content is additionally pinned to public boards. Private profiles and
	// private-board content are not in the index at all, so this clause is the
	// belt to the indexer's braces.
	contentFilter := search.AndFilter(search.PublicContentClause(), authorClause, sinceClause)
	userFilter := search.AndFilter(sinceClause)
	boardFilter := search.AndFilter(sinceClause)

	queries := make([]search.MultiQuery, 0, 4)
	if opts.wants("users") {
		queries = append(queries, search.MultiQuery{
			IndexKey: search.IndexUsers, Query: q, Filter: userFilter,
			Sort: opts.sortClause(), Limit: opts.limitFor(defaultUserLimit),
		})
	}
	if opts.wants("boards") {
		queries = append(queries, search.MultiQuery{
			IndexKey: search.IndexBoards, Query: q, Filter: boardFilter,
			Sort: opts.sortClause(), Limit: opts.limitFor(defaultBoardLimit),
		})
	}
	if opts.wants("threads") {
		queries = append(queries, search.MultiQuery{
			IndexKey: search.IndexThreads, Query: q, Filter: contentFilter,
			Sort: opts.sortClause(), Limit: opts.limitFor(defaultThreadLimit),
		})
	}
	if opts.wants("posts") {
		queries = append(queries, search.MultiQuery{
			IndexKey: search.IndexPosts, Query: q, Filter: contentFilter,
			Sort: opts.sortClause(), Limit: opts.limitFor(defaultPostLimit),
		})
	}

	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	hits, err := h.searchService.MultiSearch(ctx, queries)
	if err != nil {
		log.Printf("[Search] meilisearch error, falling back to SQL: %v", err)
		metrics.App.SearchEngineFallback()
		return h.searchViaSQL(ctx, q, sqlViewerID)
	}
	metrics.App.SearchServedByEngine()

	if r, ok := hits[search.IndexUsers]; ok {
		result.Users = normaliseUsers(r.Hits)
	}
	if r, ok := hits[search.IndexBoards]; ok {
		result.Boards = normaliseBoards(r.Hits)
	}
	if r, ok := hits[search.IndexThreads]; ok {
		result.Threads = normaliseThreads(r.Hits)
	}
	if r, ok := hits[search.IndexPosts]; ok {
		result.Posts = normalisePosts(r.Hits)
	}

	// Private profiles are deliberately absent from the index. The owner and
	// mutual friends still find them, mirroring the SQL surface's L1 rule.
	if opts.wants("users") && viewerID != "" {
		result.Users = mergeUserResults(result.Users,
			h.privateProfileUsers(ctx, q, viewerID, opts.limitFor(defaultUserLimit)))
	}
	return result
}

// searchViaSQL is the PostgreSQL full-text fallback (rusian tsvector + GIN).
func (h *SearchHandler) searchViaSQL(ctx context.Context, q string, viewerID interface{}) SearchResult {
	result := emptySearchResult()

	// ── Users (profiles) ──────────────────────────────────────────────
	// L1 (security audit): private profiles must not be enumerable through
	// search. A private-profile user appears in results only for the owner
	// themself or a mutual friend; anonymous visitors and non-friends never
	// see them — mirroring the profiles endpoint, which hides the same rows.
	// The avatar CASE additionally strips avatars of private_hide_avatar
	// profiles from everyone but the owner or a mutual friend.
	result.Users = h.searchTable(ctx,
		`SELECT u.id, u.public_id, u.username, u.display_name,
		        CASE WHEN ps.private_profile IS TRUE AND ps.private_hide_avatar IS TRUE
		                  AND ($2::uuid IS NULL OR (u.id <> $2::uuid AND NOT EXISTS (
		                      SELECT 1 FROM friendships f
		                      WHERE (f.user1_id = u.id AND f.user2_id = $2::uuid)
		                         OR (f.user1_id = $2::uuid AND f.user2_id = u.id)
		                  )))
		             THEN NULL ELSE u.avatar_url END AS avatar_url
		 FROM users u
		 LEFT JOIN privacy_settings ps ON ps.user_id = u.id
		 WHERE u.is_remote = false
		   AND u.search_vector @@ plainto_tsquery('russian', $1)
		   AND (COALESCE(ps.private_profile, false) = false
		        OR ($2::uuid IS NOT NULL AND (
		            u.id = $2::uuid
		            OR EXISTS (
		                SELECT 1 FROM friendships f
		                WHERE (f.user1_id = u.id AND f.user2_id = $2::uuid)
		                   OR (f.user1_id = $2::uuid AND f.user2_id = u.id)
		            )
		        )))
		 ORDER BY ts_rank(u.search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 24`, q, viewerID)

	// ── Boards (gomosubs + regular boards) ───────────────────────────
	result.Boards = h.searchTable(ctx,
		`SELECT id, slug, name, description, cover_image_url, is_gomosub
		 FROM boards
		 WHERE search_vector @@ plainto_tsquery('russian', $1) AND visibility != 'private'
		 ORDER BY ts_rank(search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 24`, q)

	// ── Threads ───────────────────────────────────────────────────────
	result.Threads = h.searchTable(ctx,
		`SELECT t.id, t.public_id, t.title, t.content, t.created_at, t.updated_at, t.board_id,
		        b.slug AS board_slug, b.name AS board_name, b.is_gomosub AS board_is_gomosub
		 FROM threads t
		 JOIN boards b ON b.id = t.board_id
		 WHERE t.search_vector @@ plainto_tsquery('russian', $1) AND b.visibility != 'private'
		 ORDER BY ts_rank(t.search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 60`, q)

	// ── Posts ─────────────────────────────────────────────────────────
	result.Posts = h.searchTable(ctx,
		`SELECT p.id, p.content, p.created_at, p.thread_id,
		        t.title AS thread_title, t.board_id, t.public_id AS thread_public_id,
		        b.slug AS board_slug, b.name AS board_name, b.is_gomosub AS board_is_gomosub,
		        u.username, u.avatar_url
		 FROM posts p
		 JOIN threads t ON t.id = p.thread_id
		 JOIN boards b ON b.id = t.board_id
		 LEFT JOIN users u ON u.id = p.user_id
		 WHERE p.search_vector @@ plainto_tsquery('russian', $1) AND b.visibility != 'private'
		 ORDER BY ts_rank(p.search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 30`, q)

	return result
}

// privateProfileUsers returns private-profile users matching q that the viewer
// may see (the viewer themself or a mutual friend). The engine index excludes
// these rows by design, so the engine path calls this to avoid regressing the
// SQL surface's behaviour.
func (h *SearchHandler) privateProfileUsers(ctx context.Context, q, viewerID string, limit int) []map[string]interface{} {
	const query = `
		SELECT u.id, u.public_id, u.username, u.display_name, u.avatar_url
		FROM users u
		JOIN privacy_settings ps ON ps.user_id = u.id
		WHERE ps.private_profile IS TRUE
		  AND (u.username ILIKE '%' || $1 || '%'
		       OR COALESCE(u.display_name, '') ILIKE '%' || $1 || '%')
		  AND (u.id = $2::uuid OR EXISTS (
		      SELECT 1 FROM friendships f
		      WHERE (f.user1_id = u.id AND f.user2_id = $2::uuid)
		         OR (f.user1_id = $2::uuid AND f.user2_id = u.id)
		  ))
		ORDER BY u.username
		LIMIT $3`
	return h.searchTable(ctx, query, q, viewerID, limit)
}

// resolveAuthorID accepts a UUID or a username and returns a user UUID ("" when
// nothing matches).
func (h *SearchHandler) resolveAuthorID(ctx context.Context, author string) string {
	if _, err := uuid.Parse(author); err == nil {
		return author
	}
	var id string
	if err := h.db.QueryRowContext(ctx,
		`SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`, author).Scan(&id); err == nil {
		return id
	}
	return ""
}

func parseSearchTypes(raw string) map[string]bool {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.EqualFold(raw, "all") {
		return nil
	}
	types := make(map[string]bool)
	for _, part := range strings.Split(raw, ",") {
		switch strings.TrimSpace(part) {
		case "users", "boards", "threads", "posts":
			types[strings.TrimSpace(part)] = true
		}
	}
	if len(types) == 0 {
		return nil
	}
	return types
}

func parseSearchLimit(raw string) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return 0
	}
	if n > maxSearchLimit {
		return maxSearchLimit
	}
	return n
}

// parseSince accepts unix seconds or a relative window (30d, 12h, 2w, 6m, 1y;
// m = 30 days) and returns unix seconds (0 = no filter).
func parseSince(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return n
	}
	if len(raw) < 2 {
		return 0
	}
	n, err := strconv.ParseInt(raw[:len(raw)-1], 10, 64)
	if err != nil || n <= 0 {
		return 0
	}
	var unit time.Duration
	switch raw[len(raw)-1] {
	case 'h':
		unit = time.Hour
	case 'd':
		unit = 24 * time.Hour
	case 'w':
		unit = 7 * 24 * time.Hour
	case 'm':
		unit = 30 * 24 * time.Hour
	case 'y':
		unit = 365 * 24 * time.Hour
	default:
		return 0
	}
	return time.Now().Add(-time.Duration(n) * unit).Unix()
}

func emptySearchResult() SearchResult {
	return SearchResult{
		Users:   []map[string]interface{}{},
		Boards:  []map[string]interface{}{},
		Threads: []map[string]interface{}{},
		Posts:   []map[string]interface{}{},
	}
}

// ── Engine hit normalisation ────────────────────────────────────────────────
// The index documents are richer than the API response; these pick and rename
// the fields the frontend contract expects, and turn the indexed unix
// timestamps back into RFC3339 strings (the shape PostgreSQL returned).

func normaliseUsers(hits []map[string]interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(hits))
	for _, h := range hits {
		out = append(out, map[string]interface{}{
			"id":           h["id"],
			"public_id":    h["public_id"],
			"username":     h["username"],
			"display_name": h["display_name"],
			"avatar_url":   h["avatar_url"],
		})
	}
	return out
}

func normaliseBoards(hits []map[string]interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(hits))
	for _, h := range hits {
		out = append(out, map[string]interface{}{
			"id":              h["id"],
			"slug":            h["slug"],
			"name":            h["name"],
			"description":     h["description"],
			"cover_image_url": h["cover_image_url"],
			"is_gomosub":      h["is_gomosub"],
		})
	}
	return out
}

func normaliseThreads(hits []map[string]interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(hits))
	for _, h := range hits {
		out = append(out, map[string]interface{}{
			"id":               h["id"],
			"public_id":        h["public_id"],
			"title":            h["title"],
			"content":          h["content"],
			"created_at":       unixToRFC3339(h["created_at"]),
			"updated_at":       unixToRFC3339(h["updated_at"]),
			"board_id":         h["board_id"],
			"board_slug":       h["board_slug"],
			"board_name":       h["board_name"],
			"board_is_gomosub": h["board_is_gomosub"],
		})
	}
	return out
}

func normalisePosts(hits []map[string]interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(hits))
	for _, h := range hits {
		out = append(out, map[string]interface{}{
			"id":               h["id"],
			"content":          h["content"],
			"created_at":       unixToRFC3339(h["created_at"]),
			"thread_id":        h["thread_id"],
			"thread_public_id": h["thread_public_id"],
			"thread_title":     h["thread_title"],
			"board_id":         h["board_id"],
			"board_slug":       h["board_slug"],
			"board_name":       h["board_name"],
			"board_is_gomosub": h["board_is_gomosub"],
			"username":         h["author_username"],
			"avatar_url":       h["author_avatar_url"],
		})
	}
	return out
}

func unixToRFC3339(v interface{}) interface{} {
	switch n := v.(type) {
	case float64:
		return time.Unix(int64(n), 0).UTC().Format(time.RFC3339)
	case int64:
		return time.Unix(n, 0).UTC().Format(time.RFC3339)
	default:
		return v
	}
}

func mergeUserResults(primary, extra []map[string]interface{}) []map[string]interface{} {
	if len(extra) == 0 {
		return primary
	}
	seen := make(map[string]bool, len(primary))
	for _, u := range primary {
		if id, ok := u["id"].(string); ok {
			seen[id] = true
		}
	}
	for _, u := range extra {
		id, _ := u["id"].(string)
		if id != "" && seen[id] {
			continue
		}
		primary = append(primary, u)
	}
	return primary
}

// searchTable is a helper that executes a query and returns the rows as JSON maps.
func (h *SearchHandler) searchTable(ctx context.Context, query string, args ...interface{}) []map[string]interface{} {
	rows, err := h.db.QueryContext(ctx, query, args...)
	if err != nil {
		log.Printf("[Search] query error: %v", err)
		return []map[string]interface{}{}
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return []map[string]interface{}{}
	}

	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			continue
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	if results == nil {
		return []map[string]interface{}{}
	}
	return results
}
