package handlers

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
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
func (h *SearchHandler) Search(c *gin.Context) {
	q := c.Query("q")
	if q == "" || len([]rune(q)) < 2 {
		c.JSON(http.StatusOK, models.SuccessResponse(SearchResult{}))
		return
	}

	result := SearchResult{}

	// ── Users (profiles) ──────────────────────────────────────────────
	result.Users = h.searchTable(
		`SELECT id, username, display_name, avatar_url
		 FROM users
		 WHERE is_remote = false AND search_vector @@ plainto_tsquery('russian', $1)
		 ORDER BY ts_rank(search_vector, plainto_tsquery('russian', $1)) DESC
		 LIMIT 24`, q)

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
