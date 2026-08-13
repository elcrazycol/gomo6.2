package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
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
       EXISTS(SELECT 1 FROM profile_wall_post_likes l WHERE l.post_id = p.id AND l.user_id = {viewer}) AS liked_by_viewer,
       (SELECT r.id FROM profile_wall_post_reposts r WHERE r.post_id = p.id AND r.user_id = {viewer} AND r.wall_user_id = {viewer} LIMIT 1) AS my_repost_record_id,
       (SELECT r.reposted_wall_post_id FROM profile_wall_post_reposts r WHERE r.post_id = p.id AND r.user_id = {viewer} AND r.wall_user_id = {viewer} LIMIT 1) AS my_reposted_wall_post_id,`

// wallCommentCountsSQL — same idea for comments: like count + my like state
// embedded, so the comment tree needs no per-comment requests.
const wallCommentCountsSQL = `
       (SELECT COUNT(*) FROM profile_wall_comment_likes cl WHERE cl.comment_id = c.id) AS likes_count,
       EXISTS(SELECT 1 FROM profile_wall_comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = {viewer}) AS liked_by_viewer,`

// handleProfileWallPostsGet — GET /profile_wall_posts with nested author (users join)
// and per-post interaction counts (likes/comments/reposts + viewer state).
func (h *UniversalHandler) handleProfileWallPostsGet(c *gin.Context) {
	query := `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       ` + wallPostCountsSQL + `
       ` + profileWallAuthorJSON + `
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
`
	h.profileWallFinishSelectQuery(c, query, "p", 1, "p.user_id", "ps")
}

// handleProfileWallPostCommentsGet — GET comments with author.
func (h *UniversalHandler) handleProfileWallPostCommentsGet(c *gin.Context) {
	// L5: the join to the parent post must be INNER, not LEFT. The privacy
	// predicate below compares wp.user_id (the wall owner) against the viewer;
	// with a LEFT JOIN a comment whose post has been deleted leaves wp.user_id
	// NULL, so COALESCE(NULL, false) = false makes the predicate pass and the
	// orphan comment becomes readable by every authenticated user. An INNER
	// JOIN drops such orphans entirely.
	query := `
SELECT c.id, c.post_id, c.user_id, c.parent_id, c.content, c.content_json, c.created_at, c.updated_at,
       ` + wallCommentCountsSQL + `
       ` + profileWallAuthorJSON + `
FROM profile_wall_post_comments c
LEFT JOIN users u ON u.id = c.user_id
INNER JOIN profile_wall_posts wp ON wp.id = c.post_id
LEFT JOIN privacy_settings ps ON ps.user_id = wp.user_id
`
	h.profileWallFinishSelectQuery(c, query, "c", 1, "wp.user_id", "ps")
}

func (h *UniversalHandler) profileWallFinishSelectQuery(c *gin.Context, baseQuery, tableAlias string, argIndex int, ownerColumn, privacyAlias string) {
	// Guests are allowed to read walls: they get the same predicate with an
	// empty viewer ID, which matches no ownership/friendship rows and therefore
	// only exposes walls of public profiles that have not hidden their wall
	// (private_hide_wall). Private walls stay hidden from anonymous callers.
	viewerID := authenticatedUserID(c)

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
	// toggle must not be a no-op. This predicate is intentionally duplicated in
	// the write path (enforcePostOwnership), the WebSocket room gate and the
	// media route (canViewUserWall) so every channel enforces the same rule.
	viewerArg := "$" + strconv.Itoa(ai)
	clauses = append(clauses, "("+
		ownerColumn+" = "+viewerArg+
		" OR (COALESCE("+privacyAlias+".private_profile, false) = false AND COALESCE("+privacyAlias+".private_hide_wall, false) = false)"+
		" OR EXISTS (SELECT 1 FROM friendships f WHERE (f.user1_id = "+ownerColumn+" AND f.user2_id = "+viewerArg+") OR (f.user1_id = "+viewerArg+" AND f.user2_id = "+ownerColumn+")))")
	args = append(args, viewerID)

	// The viewer parameter reference is only known now that the filter clauses
	// are built; substitute it into the {viewer} placeholder used by the count
	// subqueries in the SELECT list.
	baseQuery = strings.ReplaceAll(baseQuery, "{viewer}", viewerArg)

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
		serverError(c, "handler error", err)
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
			serverError(c, "handler error", err)
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

func (h *UniversalHandler) fetchProfileWallPostWithAuthor(id string, viewerID string) (map[string]interface{}, error) {
	q := `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       ` + wallPostCountsSQL + `
       ` + profileWallAuthorJSON + `
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
WHERE p.id = $1`
	query := strings.ReplaceAll(q, "{viewer}", "$2")
	return h.fetchOneProfileWallRow(query, id, viewerID)
}

func (h *UniversalHandler) fetchProfileWallCommentWithAuthor(id string, viewerID string) (map[string]interface{}, error) {
	q := `
SELECT c.id, c.post_id, c.user_id, c.parent_id, c.content, c.content_json, c.created_at, c.updated_at,
       ` + wallCommentCountsSQL + `
       ` + profileWallAuthorJSON + `
FROM profile_wall_post_comments c
LEFT JOIN users u ON u.id = c.user_id
WHERE c.id = $1`
	query := strings.ReplaceAll(q, "{viewer}", "$2")
	return h.fetchOneProfileWallRow(query, id, viewerID)
}

func (h *UniversalHandler) fetchOneProfileWallRow(q string, args ...interface{}) (map[string]interface{}, error) {
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
	viewerID := authenticatedUserID(c)
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
