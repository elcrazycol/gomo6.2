package wall

import (
	"database/sql"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/privacy"
)

// ─── Profile albums ─────────────────────────────────────────────────────────
//
// Albums are named collections of wall posts (many-to-many via
// profile_album_posts). Visibility inherits the wall rule: an album (and its
// posts) is served only to viewers who may see the owner's wall
// (privacy.CanViewWall — the same rule the wall reads enforce). Writes are
// owner-only: the generic registry binds profile_albums to the caller via
// OwnSingle, and the album_posts POST guard verifies album + post ownership
// here (fail-closed L5 lookups).

// eqValue extracts the plain value of a PostgREST "op.value" filter
// (e.g. "eq.abc-123" → "abc-123"); a plain value passes through.
func eqValue(raw string) string {
	if i := strings.IndexByte(raw, '.'); i >= 0 {
		return raw[i+1:]
	}
	return raw
}

// scanRows decodes the current result set into row maps using the same
// conventions as the wall read path ([]byte → string, JSONB columns decoded,
// everything else passed through for JSON marshalling).
func scanRows(rows *sql.Rows) ([]map[string]interface{}, error) {
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
				row[col] = crud.DecodeJSONBMap(val)
				continue
			}
			if col == "content_json" || col == "attachments" {
				row[col] = crud.DecodeJSONB(val)
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
	return results, rows.Err()
}

// HandleAlbumsGet — GET /profile_albums?user_id=eq.<owner>. Serves the album
// list of a user whose wall the viewer may see, embedding each album's
// post_count (ordered oldest first). Hidden/private walls return an empty list
// so album existence is never leaked to unauthorized viewers.
func (s *Service) HandleAlbumsGet(c *gin.Context) {
	ownerID := eqValue(c.Query("user_id"))
	if ownerID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_id filter is required"))
		return
	}
	viewerID := httpx.AuthenticatedUserID(c)
	visible, err := privacy.CanViewWall(s.db, viewerID, ownerID)
	if err != nil {
		httpx.ServerError(c, "check wall privacy", err)
		return
	}
	if !visible {
		c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
		return
	}

	rows, err := s.db.Query(`
		SELECT a.id, a.user_id, a.name, a.created_at, a.updated_at,
		       (SELECT COUNT(*) FROM profile_album_posts ap WHERE ap.album_id = a.id)::int AS post_count
		FROM profile_albums a
		WHERE a.user_id = $1
		ORDER BY a.created_at ASC, a.id ASC`, ownerID)
	if err != nil {
		httpx.ServerError(c, "database error", err)
		return
	}
	defer rows.Close()

	results, err := scanRows(rows)
	if err != nil {
		httpx.ServerError(c, "database error", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// HandleAlbumPostsGet — GET /profile_album_posts?album_id=eq.<id>. Serves the
// album's wall posts as full wall rows (author embed + interaction counts),
// newest-added first. The album must exist and its owner's wall must be
// visible to the viewer; otherwise the response is empty.
func (s *Service) HandleAlbumPostsGet(c *gin.Context) {
	albumID := eqValue(c.Query("album_id"))
	if albumID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("album_id filter is required"))
		return
	}
	var ownerID string
	err := s.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id FROM profile_albums WHERE id = $1", albumID).Scan(&ownerID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Album not found"))
		} else {
			httpx.ServerError(c, "lookup album", err)
		}
		return
	}

	viewerID := httpx.AuthenticatedUserID(c)
	visible, err := privacy.CanViewWall(s.db, viewerID, ownerID)
	if err != nil {
		httpx.ServerError(c, "check wall privacy", err)
		return
	}
	if !visible {
		c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
		return
	}

	q := `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       ` + wallPostCountsSQL + `
       ` + profileWallAuthorJSON + `
FROM profile_album_posts ap
JOIN profile_wall_posts p ON p.id = ap.post_id
LEFT JOIN users u ON u.id = p.author_id
WHERE ap.album_id = $1
ORDER BY ap.added_at DESC, ap.post_id DESC`
	viewerArg := "NULL"
	if viewerID != "" {
		viewerArg = "$2"
	}
	q = strings.ReplaceAll(q, "{viewer}", viewerArg)
	args := []interface{}{albumID}
	if viewerID != "" {
		args = append(args, viewerID)
	}

	rows, err := s.db.Query(q, args...)
	if err != nil {
		httpx.ServerError(c, "database error", err)
		return
	}
	defer rows.Close()

	results, err := scanRows(rows)
	if err != nil {
		httpx.ServerError(c, "database error", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// PrepareAlbumBody validates the client-writable album fields: a non-empty
// name of at most 80 characters (the DB CHECK mirrors the same bounds).
func (s *Service) PrepareAlbumBody(c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	name, _ := data["name"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Album name is required"))
		return false
	}
	if utf8.RuneCountInString(name) > 80 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Album name must be 80 characters or fewer"))
		return false
	}
	data["name"] = name
	return true
}

// PrepareAlbumPostBody guards profile_album_posts writes. POST is owner-scoped
// here (the table has no user_id column for the generic OwnSingle): the album
// must belong to the caller and the post must exist on the caller's wall —
// both lookups fail closed (L5), so a client can never add foreign posts to
// someone else's album or reference a deleted post.
func (s *Service) PrepareAlbumPostBody(c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method != "POST" {
		return true
	}
	albumID, _ := data["album_id"].(string)
	postID, _ := data["post_id"].(string)
	if albumID == "" || postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("album_id and post_id are required"))
		return false
	}
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return false
	}

	var albumOwner string
	err := s.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id FROM profile_albums WHERE id = $1", albumID).Scan(&albumOwner)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Album not found"))
		} else {
			httpx.ServerError(c, "lookup album", err)
		}
		return false
	}
	if albumOwner != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("This album belongs to another user"))
		return false
	}

	var postOwner string
	err = s.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&postOwner)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
		} else {
			httpx.ServerError(c, "lookup wall post", err)
		}
		return false
	}
	if postOwner != userID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Post is not on this wall"))
		return false
	}
	return true
}

// InvalidateAlbumsCache clears the owner's album-list cache after an album
// write. Deleting an album cascades to its join rows, so the deleted album's
// cached post list is cleared too.
func (s *Service) InvalidateAlbumsCache(_ *gin.Context, result map[string]interface{}) {
	if s.redis == nil {
		return
	}
	if userID := crud.WallResultString(result["user_id"]); userID != "" {
		cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_albums*user_id=eq."+userID+"*")
		cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_albums*user_id="+userID+"*")
	}
	if albumID := crud.WallResultString(result["id"]); albumID != "" {
		cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_album_posts*album_id=eq."+albumID+"*")
	}
}

// InvalidateAlbumPostsCache clears the album's cached post list after a
// membership write, plus the owner's album list (its post_count changed).
func (s *Service) InvalidateAlbumPostsCache(c *gin.Context, result map[string]interface{}) {
	if s.redis == nil {
		return
	}
	albumID := crud.WallResultString(result["album_id"])
	if albumID == "" {
		return
	}
	cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_album_posts*album_id=eq."+albumID+"*")
	if s.db == nil {
		return
	}
	var ownerID string
	if err := s.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id FROM profile_albums WHERE id = $1", albumID).Scan(&ownerID); err == nil && ownerID != "" {
		cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_albums*user_id=eq."+ownerID+"*")
		cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_albums*user_id="+ownerID+"*")
	}
}
