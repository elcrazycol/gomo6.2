package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

const profileWallAuthorJSON = `COALESCE(
  json_build_object(
    'username', u.username,
    'is_anonymous', COALESCE(u.is_anonymous, false),
    'avatar_url', u.avatar_url
  ),
  '{}'::json
) AS author`

// handleProfileWallPostsGet — GET /profile_wall_posts with nested author (users join).
func (h *UniversalHandler) handleProfileWallPostsGet(c *gin.Context) {
	// Private profile: block wall posts from non-friends
	if targetUserID := c.Query("user_id"); targetUserID != "" {
		var viewerID string
		if claims, exists := c.Get("claims"); exists {
			if uc, ok := claims.(*auth.Claims); ok {
				viewerID = uc.UserID
			}
		}
		shouldFilter, ps, err := ShouldFilterPrivateProfile(h.db, viewerID, targetUserID)
		if err == nil && shouldFilter && ps.PrivateHideWall {
			c.JSON(http.StatusOK, models.SuccessResponse([]interface{}{}))
			return
		}
	}

	query := `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       ` + profileWallAuthorJSON + `
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
`
	h.profileWallFinishSelectQuery(c, query, "p", 1)
}

// handleProfileWallPostCommentsGet — GET comments with author.
func (h *UniversalHandler) handleProfileWallPostCommentsGet(c *gin.Context) {
	query := `
SELECT c.id, c.post_id, c.user_id, c.content, c.content_json, c.created_at, c.updated_at,
       ` + profileWallAuthorJSON + `
FROM profile_wall_post_comments c
LEFT JOIN users u ON u.id = c.user_id
`
	h.profileWallFinishSelectQuery(c, query, "c", 1)
}

func (h *UniversalHandler) profileWallFinishSelectQuery(c *gin.Context, baseQuery, tableAlias string, argIndex int) {
	var args []interface{}
	ai := argIndex
	var clauses []string
	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
			continue
		}
		if !isValidColumnName(key) {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := buildFilterClause(tableAlias+"."+key, rawValue, ai)
			if clause != "" {
				clauses = append(clauses, clause)
				args = append(args, nextArgs...)
				ai = nextIndex
			}
		}
	}
	if orRaw := c.Query("or"); orRaw != "" {
		orRaw = strings.Trim(orRaw, "()")
		parts := splitCSV(orRaw)
		var orClauses []string
		for _, part := range parts {
			col, op, value, ok := parseOrCondition(part)
			if !ok {
				continue
			}
			clause, nextArgs, nextIndex := buildFilterFromParts(tableAlias+"."+col, op, value, ai)
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
	query := baseQuery
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}
	if orders := c.QueryArray("order"); len(orders) > 0 {
		joined := ""
		for i, o := range orders {
			if i > 0 {
				joined += ","
			}
			joined += o
		}
		if s, ok := parseOrderClause(joined, tableAlias); ok {
			query += " ORDER BY " + s
		}
	}
	if limit := c.Query("limit"); limit != "" {
		if n, err := strconv.Atoi(limit); err == nil && n >= 0 && n <= 10000 {
			query += " LIMIT " + strconv.Itoa(n)
		}
	}
	if offset := c.Query("offset"); offset != "" {
		if n, err := strconv.Atoi(offset); err == nil && n >= 0 && n <= 1000000 {
			query += " OFFSET " + strconv.Itoa(n)
		}
	}

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
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
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
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

func (h *UniversalHandler) fetchProfileWallPostWithAuthor(id string) (map[string]interface{}, error) {
	q := `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       ` + profileWallAuthorJSON + `
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
WHERE p.id = $1`
	return h.fetchOneProfileWallRow(q, id)
}

func (h *UniversalHandler) fetchProfileWallCommentWithAuthor(id string) (map[string]interface{}, error) {
	q := `
SELECT c.id, c.post_id, c.user_id, c.content, c.content_json, c.created_at, c.updated_at,
       ` + profileWallAuthorJSON + `
FROM profile_wall_post_comments c
LEFT JOIN users u ON u.id = c.user_id
WHERE c.id = $1`
	return h.fetchOneProfileWallRow(q, id)
}

func (h *UniversalHandler) fetchOneProfileWallRow(q string, id string) (map[string]interface{}, error) {
	rows, err := h.db.Query(q, id)
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

// tryRespondProfileWallEnriched replaces POST/PUT response with author embed when applicable.
func (h *UniversalHandler) tryRespondProfileWallEnriched(c *gin.Context, tableName string, result map[string]interface{}) bool {
	if tableName != "profile_wall_posts" && tableName != "profile_wall_post_comments" {
		return false
	}
	id := result["id"]
	if id == nil {
		return false
	}
	idStr := fmt.Sprint(id)
	var row map[string]interface{}
	var err error
	if tableName == "profile_wall_posts" {
		row, err = h.fetchProfileWallPostWithAuthor(idStr)
	} else {
		row, err = h.fetchProfileWallCommentWithAuthor(idStr)
	}
	if err != nil || row == nil {
		c.JSON(http.StatusOK, models.SuccessResponse(result))
		return true
	}
	c.JSON(http.StatusOK, models.SuccessResponse(row))
	return true
}
