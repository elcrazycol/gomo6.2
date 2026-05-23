package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// handleUserAchievementsGet returns rows shaped like PostgREST embeds: nested "achievements" object.
func (h *UniversalHandler) handleUserAchievementsGet(c *gin.Context) {
	query := `
SELECT ua.id, ua.user_id, ua.achievement_id, ua.unlocked_at,
  COALESCE(ua.level, 1) AS level,
  COALESCE(ua.is_pinned, false) AS is_pinned,
  ua.pinned_order,
  COALESCE(
    json_build_object(
      'id', a.id::text,
      'name', a.name,
      'description', a.description,
      'icon', a.icon,
      'category', a.category,
      'achievement_type', COALESCE(a.reward_type::text, '')
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
	if order := c.Query("order"); order != "" {
		if s, ok := parseSupabaseOrderClause(order, "ua"); ok {
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
