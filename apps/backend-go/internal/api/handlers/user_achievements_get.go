package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// handleUserAchievementsGet returns rows shaped like PostgREST embeds: nested "achievements" object
// with multi-level support (levels JSONB, current_level, max_level).
func (h *UniversalHandler) handleUserAchievementsGet(c *gin.Context) {
	query := `
SELECT ua.id, ua.user_id, ua.achievement_id, ua.unlocked_at,
  COALESCE(ua.current_level, 0) AS level,
  COALESCE(ua.is_pinned, false) AS is_pinned,
  ua.pinned_order,
  ua.progress_current,
  COALESCE(
    json_build_object(
      'id', a.id::text,
      'group_key', a.group_key,
      'title', COALESCE(a.title, a.name),
      'name', a.name,
      'description', a.description,
      'icon', COALESCE(a.icon, 'sparkles'),
      'category', a.category,
      'rarity', COALESCE(a.rarity, 'common'),
      'achievement_type', COALESCE(a.achievement_type, 'one_time'),
      'reward_type', a.reward_type,
      'reward_value', a.reward_value,
      'hidden', COALESCE(a.hidden, false),
      'levels', COALESCE(a.levels::text, '[]')::json
    ),
    '{}'::json
  ) AS achievements
FROM user_achievements ua
LEFT JOIN achievements a ON a.id = ua.achievement_id
`
	var args []interface{}
	argIndex := 1
	var clauses []string
	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
			continue
		}
		if !isValidColumnName(key) {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := buildFilterClause(key, rawValue, argIndex)
			if clause != "" {
				clauses = append(clauses, clause)
				args = append(args, nextArgs...)
				argIndex = nextIndex
			}
		}
	}
	if orRaw := c.Query("or"); orRaw != "" {
		parts := splitCSV(orRaw)
		var orClauses []string
		for _, part := range parts {
			col, op, value, ok := parseOrCondition(part)
			if !ok {
				continue
			}
			clause, nextArgs, nextIndex := buildFilterFromParts(col, op, value, argIndex)
			if clause != "" {
				orClauses = append(orClauses, clause)
				args = append(args, nextArgs...)
				argIndex = nextIndex
			}
		}
		if len(orClauses) > 0 {
			clauses = append(clauses, "("+strings.Join(orClauses, " OR ")+")")
		}
	}
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}

	// Private profile: hide achievements from non-friends
	if userID := c.Query("user_id"); userID != "" {
		uid := strings.TrimPrefix(userID, "eq.")
		var viewerID string
		if claims, exists := c.Get("claims"); exists {
			if uc, ok := claims.(*auth.Claims); ok {
				viewerID = uc.UserID
			}
		}
		canView, err := CanViewUserContent(h.db, viewerID, uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		if !canView {
			c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
			return
		}
	}
	if orders := c.QueryArray("order"); len(orders) > 0 {
		joined := ""
		for i, o := range orders {
			if i > 0 {
				joined += ","
			}
			joined += o
		}
		// No table alias for ORDER BY — columns are aliases in SELECT (e.g., level = COALESCE(ua.current_level, 0))
		if s, ok := parseOrderClause(joined, ""); ok {
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
	var results []map[string]interface{}
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
			if col == "achievements" {
				row[col] = decodeJSONColumn(val)
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

func decodeJSONColumn(val interface{}) map[string]interface{} {
	var raw []byte
	switch v := val.(type) {
	case []byte:
		raw = v
	case string:
		raw = []byte(v)
	default:
		return map[string]interface{}{}
	}
	if len(raw) == 0 {
		return map[string]interface{}{}
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return map[string]interface{}{}
	}
	return m
}
