package handlers

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// SearchHandler handles full-text search across users, boards, threads, and posts.
type SearchHandler struct {
	db *sql.DB
}

// NewSearchHandler creates a new SearchHandler.
func NewSearchHandler(db *sql.DB) *SearchHandler {
	return &SearchHandler{db: db}
}

// SearchResult is the unified response for the search endpoint.
type SearchResult struct {
	Users   []map[string]interface{} `json:"users"`
	Boards  []map[string]interface{} `json:"boards"`
	Threads []map[string]interface{} `json:"threads"`
	Posts   []map[string]interface{} `json:"posts"`
}

// Search performs a full-text search across all searchable entities.
// GET /api/v1/search?q=...
//
// Search godoc
// @Summary      Full-text search
// @Description  Search across users, boards, threads, and posts
// @Tags         Search
// @Produce      json
// @Param        q query string true "Search query (min 2 chars)"
// @Success      200 {object} models.APIResponse
// @Router       /search [get]
func (h *SearchHandler) Search(c *gin.Context) {
	q := c.Query("q")
	if q == "" || len([]rune(q)) < 2 {
		c.JSON(http.StatusOK, models.SuccessResponse(SearchResult{}))
		return
	}

	result := SearchResult{}

	// Viewer identity (anonymous when no token). Used to strip avatars of
	// private-profile users: search must never leak a photo that the profile
	// endpoint hides. Nil for anonymous — passing an empty string into a
	// UUID-typed comparison would make Postgres throw a cast error, and passing
	// NULL into `u.id <> $2` would silently re-expose avatars.
	var viewerID interface{}
	if claims, ok := c.Get("claims"); ok {
		if uc, ok2 := claims.(*auth.Claims); ok2 && uc != nil && uc.UserID != "" {
			viewerID = uc.UserID
		}
	}

	// ── Users (profiles) ──────────────────────────────────────────────
	// Anonymous ($2 IS NULL) → strip avatar for private profiles.
	// Authenticated non-friend → strip avatar unless owner or mutual friend.
	result.Users = h.searchTable(
		`SELECT u.id, u.username, u.display_name,
		        CASE WHEN ps.private_profile IS TRUE AND ps.private_hide_avatar IS TRUE
		                  AND ($2::uuid IS NULL OR (u.id <> $2::uuid AND NOT EXISTS (
		                      SELECT 1 FROM friendships f
		                      WHERE (f.user1_id = u.id AND f.user2_id = $2::uuid)
		                         OR (f.user1_id = $2::uuid AND f.user2_id = u.id)
		                  )))
		             THEN NULL ELSE u.avatar_url END AS avatar_url
		 FROM users u
		 LEFT JOIN privacy_settings ps ON ps.user_id = u.id
		 WHERE u.is_remote = false AND u.search_vector @@ plainto_tsquery('russian', $1)
		 ORDER BY ts_rank(u.search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 24`, q, viewerID)

	// ── Boards (gomosubs + regular boards) ───────────────────────────
	result.Boards = h.searchTable(
		`SELECT id, slug, name, description, cover_image_url, is_gomosub
		 FROM boards
		 WHERE search_vector @@ plainto_tsquery('russian', $1) AND visibility != 'private'
		 ORDER BY ts_rank(search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 24`, q)

	// ── Threads ───────────────────────────────────────────────────────
	result.Threads = h.searchTable(
		`SELECT t.id, t.title, t.content, t.created_at, t.updated_at, t.board_id,
		        b.slug AS board_slug, b.name AS board_name, b.is_gomosub AS board_is_gomosub
		 FROM threads t
		 JOIN boards b ON b.id = t.board_id
		 WHERE t.search_vector @@ plainto_tsquery('russian', $1) AND b.visibility != 'private'
		 ORDER BY ts_rank(t.search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 60`, q)

	// ── Posts ─────────────────────────────────────────────────────────
	result.Posts = h.searchTable(
		`SELECT p.id, p.content, p.created_at, p.thread_id,
		        t.title AS thread_title, t.board_id,
		        b.slug AS board_slug, b.name AS board_name, b.is_gomosub AS board_is_gomosub,
		        u.username, u.avatar_url
		 FROM posts p
		 JOIN threads t ON t.id = p.thread_id
		 JOIN boards b ON b.id = t.board_id
		 LEFT JOIN users u ON u.id = p.user_id
		 WHERE p.search_vector @@ plainto_tsquery('russian', $1) AND b.visibility != 'private'
		 ORDER BY ts_rank(p.search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 30`, q)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// searchTable is a helper that executes a query and returns the rows as JSON maps.
func (h *SearchHandler) searchTable(query string, args ...interface{}) []map[string]interface{} {
	rows, err := h.db.Query(query, args...)
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
