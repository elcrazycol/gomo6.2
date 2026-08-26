package crudengine

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/privacy"
)

const profileWallAuthorJSON = `COALESCE(
  json_build_object(
    'username', u.username,
    'display_name', u.display_name,
    'nickname_emoji_id', u.nickname_emoji_id,
    'is_anonymous', COALESCE(u.is_anonymous, false),
    'avatar_url', u.avatar_url
  ),
  '{}'::json
) AS author`

// profileWallCommentAuthorJSON — the author embed for wall comments. For
// soft-deleted comments (is_deleted = TRUE) the author is scrubbed from the
// API response entirely (M-3 from the 2026-08-14 audit): the UI already
// renders "Автор неизвестен", but the API used to return the author's
// profile forever. The comment queries also null out c.user_id with the same
// CASE so no identity survives the deletion on any read path. The users join
// is harmless for deleted rows (the CASE never references u).
const profileWallCommentAuthorJSON = `CASE WHEN c.is_deleted THEN '{}'::json ELSE COALESCE(
  json_build_object(
    'username', u.username,
    'display_name', u.display_name,
    'nickname_emoji_id', u.nickname_emoji_id,
    'is_anonymous', COALESCE(u.is_anonymous, false),
    'avatar_url', u.avatar_url
  ),
  '{}'::json
) END AS author`

// wallPostCountsSQL returns the correlated-subquery columns that embed the
// interaction state of every wall post. The {viewer} placeholder is replaced
// with the authenticated viewer's parameter reference by
// profileWallFinishSelectQuery.
//
// Embedding counts here removed the biggest request amplifier in the wall UI:
// the client used to fire 5 requests per post (likes count, comments count,
// reposts count, my like, my repost) — a 20-post wall cost 100 requests.
const wallPostCountsSQL = `
       (SELECT COUNT(*) FROM profile_wall_post_likes l WHERE l.post_id = p.id) AS likes_count,
       (SELECT COUNT(*) FROM profile_wall_post_comments cm WHERE cm.post_id = p.id) AS comments_count,
       (SELECT COUNT(*) FROM profile_wall_post_reposts r WHERE r.post_id = p.id) AS reposts_count,
       (SELECT COUNT(*) FROM profile_wall_post_views v WHERE v.post_id = p.id) AS views_count,
       EXISTS(SELECT 1 FROM profile_wall_post_likes l WHERE l.post_id = p.id AND l.user_id = {viewer}) AS liked_by_viewer,
       (SELECT r.id FROM profile_wall_post_reposts r WHERE r.post_id = p.id AND r.user_id = {viewer} AND r.wall_user_id = {viewer} LIMIT 1) AS my_repost_record_id,
       (SELECT r.reposted_wall_post_id FROM profile_wall_post_reposts r WHERE r.post_id = p.id AND r.user_id = {viewer} AND r.wall_user_id = {viewer} LIMIT 1) AS my_reposted_wall_post_id,`

// wallCommentCountsSQL — same idea for comments: like count + my like state
// embedded, so the comment tree needs no per-comment requests.
const wallCommentCountsSQL = `
       (SELECT COUNT(*) FROM profile_wall_comment_likes cl WHERE cl.comment_id = c.id) AS likes_count,
       EXISTS(SELECT 1 FROM profile_wall_comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = {viewer}) AS liked_by_viewer,`

// wallPostListBaseQuery — SELECT skeleton shared by the legacy single-query
// path and the keyset pages. The {viewer} placeholder is substituted by
// runWallSelectQuery.
const wallPostListBaseQuery = `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       ` + wallPostCountsSQL + `
       ` + profileWallAuthorJSON + `
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
`

// handleProfileWallPostsGet — GET /profile_wall_posts with nested author (users join)
// and per-post interaction counts (likes/comments/reposts + viewer state).
//
// The plain wall list (a user_id filter, nothing else) is served with keyset
// pagination: page 1 = all pinned posts + the first batch of unpinned posts,
// later pages = unpinned posts after an opaque (created_at, id) cursor. Every
// other filter shape (id=eq, is_pinned=eq, or, offset) keeps the legacy
// single-query path so focused-post, moderation and stats reads are unchanged.
func (h *Engine) handleProfileWallPostsGet(c *gin.Context) {
	if wallKeysetEligible(c) {
		h.handleProfileWallPostsGetKeyset(c)
		return
	}
	h.profileWallFinishSelectQuery(c, wallPostListBaseQuery, "p", 1, "p.user_id", "ps")
}

// wallKeysetEligible reports whether a request is the plain wall list: a
// user_id filter with no id/is_pinned/or/offset overrides.
func wallKeysetEligible(c *gin.Context) bool {
	if c.Query("user_id") == "" {
		return false
	}
	for _, key := range []string{"id", "is_pinned", "or", "offset"} {
		if c.Query(key) != "" {
			return false
		}
	}
	return true
}

// wallCursor is an opaque (created_at, id) keyset position. The client never
// inspects it — it just echoes next_cursor back on the next page request.
type wallCursor struct {
	createdAt time.Time
	id        string
}

func encodeWallCursor(row map[string]interface{}) string {
	ct, _ := row["created_at"].(time.Time)
	return ct.Format(time.RFC3339Nano) + "::" + fmt.Sprint(row["id"])
}

func parseWallCursor(raw string) (wallCursor, bool) {
	parts := strings.SplitN(raw, "::", 2)
	if len(parts) != 2 {
		return wallCursor{}, false
	}
	ct, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil || parts[1] == "" {
		return wallCursor{}, false
	}
	return wallCursor{createdAt: ct, id: parts[1]}, true
}

// handleProfileWallPostsGetKeyset serves the paginated wall list:
//   - no cursor → all pinned posts + the first `limit` unpinned posts;
//   - cursor     → the next `limit` unpinned posts after the cursor.
//
// Each query probes `limit + 1` rows so has_more is exact. The response
// carries has_more + next_cursor; pinned posts only appear on the first page.
func (h *Engine) handleProfileWallPostsGetKeyset(c *gin.Context) {
	limit := 10
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	unpinnedOrder := `"p"."created_at" DESC, "p"."id" DESC`
	var pinnedRows []map[string]interface{}
	var unpinnedRows []map[string]interface{}

	cursorRaw := c.Query("cursor")
	if cursorRaw == "" {
		// First page: every pinned post (bounded — pins are few by design) on
		// top, then the newest unpinned batch.
		var err error
		pinnedRows, err = h.runWallSelectQuery(c, wallPostListBaseQuery, "p", 1, "p.user_id", "ps", wallSelectOptions{
			extraWhere: "p.is_pinned = true",
			orderBy:    `"p"."pinned_order" ASC, "p"."created_at" DESC, "p"."id" DESC`,
			limit:      100,
		})
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}

		unpinnedRows, err = h.runWallSelectQuery(c, wallPostListBaseQuery, "p", 1, "p.user_id", "ps", wallSelectOptions{
			extraWhere: "p.is_pinned = false",
			orderBy:    unpinnedOrder,
			limit:      limit + 1,
		})
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
	} else {
		cur, ok := parseWallCursor(cursorRaw)
		if !ok {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("invalid cursor"))
			return
		}
		var err error
		unpinnedRows, err = h.runWallSelectQuery(c, wallPostListBaseQuery, "p", 1, "p.user_id", "ps", wallSelectOptions{
			extraWhere: "p.is_pinned = false",
			cursor:     &cur,
			orderBy:    unpinnedOrder,
			limit:      limit + 1,
		})
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
	}

	hasMore := len(unpinnedRows) > limit
	var nextCursor *string
	if hasMore {
		unpinnedRows = unpinnedRows[:limit]
		nc := encodeWallCursor(unpinnedRows[len(unpinnedRows)-1])
		nextCursor = &nc
	}

	results := append(pinnedRows, unpinnedRows...)
	resp := models.SuccessResponse(results)
	resp.HasMore = &hasMore
	resp.NextCursor = nextCursor
	c.JSON(http.StatusOK, resp)
}

// handleProfileWallPostCommentsGet — GET comments with author.
func (h *Engine) handleProfileWallPostCommentsGet(c *gin.Context) {
	// L5: the join to the parent post must be INNER, not LEFT. The privacy
	// predicate below compares wp.user_id (the wall owner) against the viewer;
	// with a LEFT JOIN a comment whose post has been deleted leaves wp.user_id
	// NULL, so COALESCE(NULL, false) = false makes the predicate pass and the
	// orphan comment becomes readable by every authenticated user. An INNER
	// JOIN drops such orphans entirely.
	// M-3: a soft-deleted comment must not leak its author — the author embed
	// AND the user_id column are scrubbed when is_deleted (the UI placeholder
	// "Автор неизвестен" must no longer be a lie at the API level).
	query := `
SELECT c.id, c.post_id,
       CASE WHEN c.is_deleted THEN NULL ELSE c.user_id END AS user_id,
       c.parent_id, c.content, c.content_json, c.created_at, c.updated_at,
       c.is_deleted,
       ` + wallCommentCountsSQL + `
       ` + profileWallCommentAuthorJSON + `
FROM profile_wall_post_comments c
LEFT JOIN users u ON u.id = c.user_id
INNER JOIN profile_wall_posts wp ON wp.id = c.post_id
LEFT JOIN privacy_settings ps ON ps.user_id = wp.user_id
`
	h.profileWallFinishSelectQuery(c, query, "c", 1, "wp.user_id", "ps")
}

// wallSelectOptions tweaks runWallSelectQuery for the paginated wall list.
type wallSelectOptions struct {
	// extraWhere is AND-ed into the WHERE clause with literal values (no
	// placeholders) — e.g. "p.is_pinned = true".
	extraWhere string
	// orderBy overrides the order query params when non-empty.
	orderBy string
	// limit > 0 sets an explicit LIMIT (otherwise the limit param is used).
	limit int
	// cursor adds the keyset predicate (created_at, id) < cursor.
	cursor *wallCursor
}

// runWallSelectQuery builds and runs the wall/comment SELECT — filters, or
// conditions, the visibility predicate, viewer substitution, order and
// limit/offset — and returns the decoded rows. The caller decides how to
// respond (the legacy path wraps it in SuccessResponse, the keyset path adds
// has_more/next_cursor).
func (h *Engine) runWallSelectQuery(c *gin.Context, baseQuery, tableAlias string, argIndex int, ownerColumn, privacyAlias string, opts wallSelectOptions) ([]map[string]interface{}, error) {
	// Guests are allowed to read walls: they get the same predicate with an
	// empty viewer ID, which matches no ownership/friendship rows and therefore
	// only exposes walls of public profiles that have not hidden their wall
	// (private_hide_wall). Private walls stay hidden from anonymous callers.
	viewerID := httpx.AuthenticatedUserID(c)

	var args []interface{}
	ai := argIndex
	var clauses []string
	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" || key == "cursor" {
			continue
		}
		if !crud.IsValidColumnName(key) {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := crud.BuildFilterClause(tableAlias+"."+key, rawValue, ai)
			if clause != "" {
				clauses = append(clauses, clause)
				args = append(args, nextArgs...)
				ai = nextIndex
			}
		}
	}
	if orRaw := c.Query("or"); orRaw != "" {
		orRaw = strings.Trim(orRaw, "()")
		parts := crud.SplitCSV(orRaw)
		var orClauses []string
		for _, part := range parts {
			col, op, value, ok := crud.ParseOrCondition(part)
			if !ok {
				continue
			}
			clause, nextArgs, nextIndex := crud.BuildFilterFromParts(tableAlias+"."+col, op, value, ai)
			if clause != "" {
				orClauses = append(orClauses, clause)
				args = append(args, nextArgs...)
				ai = nextIndex
			}
		}
		if len(orClauses) > 0 {
			clauses = append(clauses, "("+strings.Join(orClauses, " OR ")+")")
		}
	}

	// Apply the same visibility predicate to every row, including repost
	// lookups that do not carry a user_id filter, so private walls cannot be
	// enumerated by post ID. Guests (viewerID == "") only ever match the
	// "public profile with visible wall" branch.
	//
	// Privacy guarantee: a wall is visible to the owner, to mutual friends, and
	// to everyone else ONLY when the profile is public AND the owner has not
	// hidden the wall (private_hide_wall). private_profile = true always means
	// a private wall (the sub-settings can never re-open it), and for public
	// profiles private_hide_wall = true hides the wall from non-friends — the
	// toggle must not be a no-op. The clause comes from privacy.WallVisibilityClause
	// (the single SQL form of privacy.CanViewWall), shared with the wall media
	// gate, so every channel enforces the same rule.
	//
	// Guests get SQL NULL for the viewer reference (see {viewer} substitution
	// below): an empty string would break the uuid comparisons in the count
	// subqueries (500), and NULL correctly never matches owner/friendship rows.
	viewerArg := "NULL"
	if viewerID != "" {
		viewerArg = "$" + strconv.Itoa(ai)
		args = append(args, viewerID)
		ai++
	}
	clauses = append(clauses, privacy.WallVisibilityClause(ownerColumn, privacyAlias, viewerArg))

	if opts.extraWhere != "" {
		clauses = append(clauses, opts.extraWhere)
	}
	if opts.cursor != nil {
		clauses = append(clauses, "("+tableAlias+".created_at, "+tableAlias+".id) < ($"+strconv.Itoa(ai)+"::timestamptz, $"+strconv.Itoa(ai+1)+"::uuid)")
		args = append(args, opts.cursor.createdAt, opts.cursor.id)
	}

	// The viewer parameter reference is only known now that the filter clauses
	// are built; substitute it into the {viewer} placeholder used by the count
	// subqueries in the SELECT list.
	//
	// For guests (viewerID == "") we substitute SQL NULL instead of an empty
	// parameter: the count subqueries compare against uuid columns, and an
	// empty string cannot be cast to uuid (invalid input syntax → 500). NULL
	// means "no viewer" — liked_by_viewer/my_repost stay false/NULL, which is
	// exactly what an anonymous visitor should see.
	baseQuery = strings.ReplaceAll(baseQuery, "{viewer}", viewerArg)

	query := baseQuery
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}
	if opts.orderBy != "" {
		query += " ORDER BY " + opts.orderBy
	} else if orders := c.QueryArray("order"); len(orders) > 0 {
		joined := ""
		for i, o := range orders {
			if i > 0 {
				joined += ","
			}
			joined += o
		}
		if s, ok := crud.ParseOrderClause(joined, tableAlias); ok {
			query += " ORDER BY " + s
		}
	}
	if opts.limit > 0 {
		query += " LIMIT " + strconv.Itoa(opts.limit)
	} else if limit := c.Query("limit"); limit != "" {
		if n, err := strconv.Atoi(limit); err == nil && n >= 0 && n <= 10000 {
			query += " LIMIT " + strconv.Itoa(n)
		}
	}
	if opts.limit == 0 {
		if offset := c.Query("offset"); offset != "" {
			if n, err := strconv.Atoi(offset); err == nil && n >= 0 && n <= 1000000 {
				query += " OFFSET " + strconv.Itoa(n)
			}
		}
	}

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns, _ := rows.Columns()
	results := []map[string]interface{}{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}
		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if col == "author" {
				row[col] = decodeJSONColumn(val)
				continue
			}
			if col == "content_json" || col == "attachments" {
				row[col] = decodeMaybeJSONB(val)
				continue
			}
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}
	return results, nil
}

// profileWallFinishSelectQuery builds and runs the query, then responds. Used
// by the comments handler and the legacy single-query wall path.
func (h *Engine) profileWallFinishSelectQuery(c *gin.Context, baseQuery, tableAlias string, argIndex int, ownerColumn, privacyAlias string) {
	results, err := h.runWallSelectQuery(c, baseQuery, tableAlias, argIndex, ownerColumn, privacyAlias, wallSelectOptions{})
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

func decodeMaybeJSONB(val interface{}) interface{} {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case []byte:
		var out interface{}
		if json.Unmarshal(v, &out) == nil {
			return out
		}
		return string(v)
	case string:
		var out interface{}
		if json.Unmarshal([]byte(v), &out) == nil {
			return out
		}
		return v
	default:
		return val
	}
}

func (h *Engine) fetchProfileWallPostWithAuthor(id string, viewerID string) (map[string]interface{}, error) {
	q := `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       ` + wallPostCountsSQL + `
       ` + profileWallAuthorJSON + `
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
WHERE p.id = $1`
	query := strings.ReplaceAll(q, "{viewer}", wallViewerArg(viewerID, 2))
	if viewerID == "" {
		return h.fetchOneProfileWallRow(query, id)
	}
	return h.fetchOneProfileWallRow(query, id, viewerID)
}

func (h *Engine) fetchProfileWallCommentWithAuthor(id string, viewerID string) (map[string]interface{}, error) {
	q := `
SELECT c.id, c.post_id,
       CASE WHEN c.is_deleted THEN NULL ELSE c.user_id END AS user_id,
       c.parent_id, c.content, c.content_json, c.created_at, c.updated_at,
       c.is_deleted,
       ` + wallCommentCountsSQL + `
       ` + profileWallCommentAuthorJSON + `
FROM profile_wall_post_comments c
LEFT JOIN users u ON u.id = c.user_id
WHERE c.id = $1`
	query := strings.ReplaceAll(q, "{viewer}", wallViewerArg(viewerID, 2))
	if viewerID == "" {
		return h.fetchOneProfileWallRow(query, id)
	}
	return h.fetchOneProfileWallRow(query, id, viewerID)
}

func (h *Engine) fetchOneProfileWallRow(q string, args ...interface{}) (map[string]interface{}, error) {
	rows, err := h.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, sql.ErrNoRows
	}
	columns, _ := rows.Columns()
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}
	if err := rows.Scan(valuePtrs...); err != nil {
		return nil, err
	}
	row := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		if col == "author" {
			row[col] = decodeJSONColumn(val)
			continue
		}
		if col == "content_json" || col == "attachments" {
			row[col] = decodeMaybeJSONB(val)
			continue
		}
		if b, ok := val.([]byte); ok {
			row[col] = string(b)
		} else {
			row[col] = val
		}
	}
	return row, nil
}

// wallViewerArg returns the SQL expression referencing the viewer parameter for
// the {viewer} placeholder in the count subqueries. Guests (empty viewerID) get
// SQL NULL — an empty string would fail the uuid cast in the subqueries (500),
// while NULL correctly means "no viewer" (liked_by_viewer false, my_repost
// NULL).
func wallViewerArg(viewerID string, argIndex int) string {
	if viewerID == "" {
		return "NULL"
	}
	return "$" + strconv.Itoa(argIndex)
}

// tryRespondProfileWallEnriched replaces POST/PUT response with author embed when applicable.
func (h *Engine) tryRespondProfileWallEnriched(c *gin.Context, tableName string, result map[string]interface{}) bool {
	if tableName != "profile_wall_posts" && tableName != "profile_wall_post_comments" {
		return false
	}
	id := result["id"]
	if id == nil {
		return false
	}
	idStr := fmt.Sprint(id)
	viewerID := httpx.AuthenticatedUserID(c)
	var row map[string]interface{}
	var err error
	if tableName == "profile_wall_posts" {
		row, err = h.fetchProfileWallPostWithAuthor(idStr, viewerID)
	} else {
		row, err = h.fetchProfileWallCommentWithAuthor(idStr, viewerID)
	}
	if err != nil || row == nil {
		c.JSON(http.StatusOK, models.SuccessResponse(result))
		return true
	}
	c.JSON(http.StatusOK, models.SuccessResponse(row))
	return true
}
