package universal

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/handlers"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/models"
)

// handleUserAchievementsGet returns rows shaped like PostgREST embeds: nested "achievements" object
// with multi-level support (levels JSONB, current_level, max_level).
func (h *UniversalHandler) handleUserAchievementsGet(c *gin.Context) {
	// Whenever a user opens their own achievements page, reconcile every group
	// from live data (debounced, in the background — see
	// scheduleAchievementRecompute). Counter groups self-heal in the engine,
	// but a user who has an untriggered period (a thread posted through a path
	// that didn't emit before the fix, or stale rows from the old system)
	// would otherwise carry the mismatch forward until their next event. This
	// makes the page reflect reality when viewed without blocking the request
	// or hammering the DB on every visit.
	if owner := strings.TrimPrefix(c.Query("user_id"), "eq."); owner != "" && owner == authenticatedUserID(c) && h.achEngine != nil {
		h.scheduleAchievementRecompute(owner)
	}

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
		if !crud.IsValidColumnName(key) {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := crud.BuildFilterClause(key, rawValue, argIndex)
			if clause != "" {
				clauses = append(clauses, clause)
				args = append(args, nextArgs...)
				argIndex = nextIndex
			}
		}
	}
	if orRaw := c.Query("or"); orRaw != "" {
		parts := crud.SplitCSV(orRaw)
		var orClauses []string
		for _, part := range parts {
			col, op, value, ok := crud.ParseOrCondition(part)
			if !ok {
				continue
			}
			clause, nextArgs, nextIndex := crud.BuildFilterFromParts(col, op, value, argIndex)
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
	// Always bind the result set to the authenticated user or to the explicitly
	// requested profile. The generic compatibility endpoint must never allow a
	// caller to omit user_id and enumerate every user's achievements.
	// Anonymous callers may read OTHER users' achievements (profile pages are
	// public for guests), but without an explicit user_id filter there is
	// nothing to bind the query to — guests get an empty result set.
	viewerID := authenticatedUserID(c)
	targetUserID := strings.TrimPrefix(c.Query("user_id"), "eq.")
	if targetUserID == "" {
		if viewerID == "" {
			c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
			return
		}
		targetUserID = viewerID
	}
	clauses = append(clauses, "ua.user_id = $"+strconv.Itoa(argIndex))
	args = append(args, targetUserID)
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}

	// Private profile: hide achievements from non-friends
	if userID := c.Query("user_id"); userID != "" {
		uid := strings.TrimPrefix(userID, "eq.")
		canView, err := handlers.CanViewUserAchievements(h.db, viewerID, uid)
		if err != nil {
			serverError(c, "handler error", err)
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
		if s, ok := crud.ParseOrderClause(joined, ""); ok {
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
	var results []map[string]interface{}
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

// achievementRecomputeWindow is the minimum gap between two full recomputes of
// one user's achievements, so opening the page repeatedly doesn't re-run all
// source-count queries every time.
const achievementRecomputeWindow = 60 * time.Second

// scheduleAchievementRecompute reconciles a user's achievements from live data
// in the background, at most once per achievementRecomputeWindow per user. The
// engine's own event increments already keep counters fresh; this is only a
// drift-healing safety net for rows that predate an emit or a missed event, so
// a short debounce is plenty.
func (h *UniversalHandler) scheduleAchievementRecompute(userID string) {
	if userID == "" || h.achEngine == nil {
		return
	}
	h.achievementRecomputeMu.Lock()
	last, ok := h.achievementRecomputeAt[userID]
	if ok && time.Since(last) < achievementRecomputeWindow {
		h.achievementRecomputeMu.Unlock()
		return
	}
	h.achievementRecomputeAt[userID] = time.Now()
	h.achievementRecomputeMu.Unlock()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Achievements] recompute panic: %v", r)
			}
		}()
		h.achEngine.RecomputeUser(context.Background(), userID)
	}()
}
