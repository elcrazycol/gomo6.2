package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// ─── HandleTableRequest ──────────────────────────────────────────────────────

func TestHandleTableRequest_DisallowedTable(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/secret_table", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleTableRequest_EmptyTable(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleTableRequest_MethodNotAllowed(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PATCH", "/api/v1/user_roles", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

// ─── handleGet ───────────────────────────────────────────────────────────────

func TestUniversalGet_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM gomosub_memberships`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "board_id"}).
			AddRow("1", "u1", "b1").AddRow("2", "u2", "b2"))

	c, w := newUniversalRequestContext("GET", "/api/v1/gomosub_memberships", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_WithFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "admin"))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_roles?user_id=eq.u1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM gomosub_memberships`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("GET", "/api/v1/gomosub_memberships", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUniversalPost_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The INSERT column order depends on map iteration (random in Go).
	// Use (?s).* to match against any order.
	mock.ExpectQuery(`(?s).*INSERT INTO polls \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "question", "created_by"}).
			AddRow("poll1", "Test question?", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/polls", map[string]string{
		"question":   "Test question?",
		"created_by": "u1",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_UpsertDailyVisits(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO user_daily_visits.*VALUES.*ON CONFLICT.*DO UPDATE.*RETURNING \*`).
		WithArgs("u1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "visit_date"}).
			AddRow("1", "u1", "2025-01-01"))

	c, w := newUniversalRequestContext("POST", "/api/v1/user_daily_visits", map[string]string{
		"user_id": "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`UPDATE user_roles SET role = \$1 WHERE user_id = \$2 RETURNING \*`).
		WithArgs("moderator", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "moderator"))

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role": "moderator",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_MissingFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles", map[string]string{
		"role": "moderator",
	}, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUniversalPut_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The ownership scope adds user_id = caller (u1) in addition to the
	// user_id=eq.u1 query filter.
	mock.ExpectQuery(`(?s).*UPDATE privacy_settings SET show_online_status = \$1 WHERE .*user_id = \$2.*user_id = \$3.*RETURNING \*`).
		WithArgs("false", "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "show_online_status"}))

	c, w := newUniversalRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status": "false",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── privacy_settings writes: ownership enforcement (anti-IDOR) ─────────────

func TestUniversalPost_PrivacySettings_ForcesOwner(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The client attempts to create/update privacy settings for a victim; the
	// server must force user_id to the caller. INSERT columns are sorted
	// alphabetically (private_profile, user_id), so the args order is fixed.
	mock.ExpectQuery(`(?s).*INSERT INTO privacy_settings \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WithArgs("true", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "private_profile"}).
			AddRow("1", "u1", true))

	c, w := newUniversalRequestContext("POST", "/api/v1/privacy_settings", map[string]string{
		"user_id":         "victim",
		"private_profile": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_PrivacySettings_CannotTouchForeignRow(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// An attacker tries to flip the victim's private_profile via a generic PUT.
	// The ownership scope (user_id = attacker) AND the user_id=eq.victim filter
	// can never match the victim's row → 404, nothing updated.
	mock.ExpectQuery(`(?s).*UPDATE privacy_settings SET private_profile = \$1 WHERE .*user_id = \$2.*user_id = \$3.*RETURNING \*`).
		WithArgs("true", "u1", "victim").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "private_profile"}))

	c, w := newUniversalRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.victim", map[string]string{
		"private_profile": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── handleDelete ────────────────────────────────────────────────────────────

func TestUniversalDelete_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`DELETE FROM poll_votes WHERE id = \$1 RETURNING \*`).
		WithArgs("vote1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "poll_id", "user_id"}).
			AddRow("vote1", "poll1", "u1"))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/poll_votes?id=eq.vote1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalDelete_MissingFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("DELETE", "/api/v1/poll_votes", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUniversalDelete_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`DELETE FROM thread_subscriptions WHERE id = \$1 RETURNING \*`).
		WithArgs("nonexistent").
		WillReturnRows(sqlmock.NewRows([]string{"id", "thread_id", "user_id"}))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/thread_subscriptions?id=eq.nonexistent", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUniversalGet_UserAchievements(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The actual query is a complex JOIN - use (?s).* to match the full structure
	mock.ExpectQuery(`(?s).*SELECT ua\.id, ua\.user_id.*FROM user_achievements ua.*LEFT JOIN achievements a.*WHERE ua\.user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "achievement_id", "unlocked_at", "level", "is_pinned", "pinned_order", "achievements"}).
			AddRow("1", "u1", "ach1", "2025-01-01T00:00:00Z", 1, false, nil, `{"id":"ach1","name":"Test"}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_achievements", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func TestUniversal_ParseOrCondition(t *testing.T) {
	col, op, val, ok := parseOrCondition("user_id.eq.123")
	if !ok || col != "user_id" || op != "eq" || val != "123" {
		t.Fatalf("unexpected result: %s, %s, %s, %v", col, op, val, ok)
	}
}

func TestUniversal_SplitCSV(t *testing.T) {
	result := splitCSV("a,b,c")
	if len(result) != 3 || result[0] != "a" || result[1] != "b" || result[2] != "c" {
		t.Fatalf("unexpected: %v", result)
	}
}

func TestUniversal_SplitCSV_Empty(t *testing.T) {
	result := splitCSV("")
	if result != nil {
		t.Fatalf("expected nil, got %v", result)
	}
}

func TestUniversal_JoinStrings(t *testing.T) {
	result := joinStrings([]string{"a", "b", "c"}, ", ")
	if result != "a, b, c" {
		t.Fatalf("unexpected: %s", result)
	}
	result2 := joinStrings(nil, ",")
	if result2 != "" {
		t.Fatalf("unexpected: %s", result2)
	}
}

// test helper to verify UniversalHandler response parsing
type universalResponse struct {
	Data  json.RawMessage `json:"data"`
	Error *string         `json:"error"`
}

func TestUniversalPost_UpsertGomosubRules(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO gomosub_rules_acceptance.*VALUES.*ON CONFLICT.*DO UPDATE.*RETURNING \*`).
		WithArgs("u1", "b1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "board_id"}).
			AddRow("1", "u1", "b1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/gomosub_rules_acceptance", map[string]string{
		"user_id":  "u1",
		"board_id": "b1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp universalResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestUniversalPost_UpsertWallPostLikes(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Wall visibility gate: post1 belongs to u1 (the caller) → allowed.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_likes.*VALUES.*ON CONFLICT.*DO UPDATE SET user_id = EXCLUDED.user_id.*RETURNING \*`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id"}).
			AddRow("1", "post1", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "post1",
		"user_id": "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_InvalidBody(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/polls", "invalid json", nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUniversalGet_WithInFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id IN \(\$1, \$2\)`).
		WithArgs("u1", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "admin").AddRow("2", "u2", "user"))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_roles?user_id=in.(u1,u2)", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_WithIsNull(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id IS NULL`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_roles?user_id=is.null", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_ProfileWallPosts(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE .*p\.user_id = \$1.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "Hello!", "Test", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_ProfileWallPostComments(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE .*wp\.user_id = \$1.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}).
			AddRow("comment1", "post1", "u1", "Nice!", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`UPDATE user_roles SET role = \$1 WHERE user_id = \$2 RETURNING \*`).
		WithArgs("moderator", "u1").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role": "moderator",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUniversalGet_BuildFilterClause_PlainValue(t *testing.T) {
	clause, args, next := buildFilterClause("user_id", "u1", 1)
	if clause != "user_id = $1" || len(args) != 1 || args[0] != "u1" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestUniversalGet_BuildFilterClause_NotOp(t *testing.T) {
	clause, args, next := buildFilterClause("user_id", "not.eq.u1", 1)
	if clause != "NOT (user_id = $1)" || len(args) != 1 || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestUniversalGet_BuildFilterClause_GtOp(t *testing.T) {
	clause, args, next := buildFilterClause("sent_at", "gt.2025-01-01T00:00:00Z", 1)
	if clause != "sent_at > $1" || len(args) != 1 || args[0] != "2025-01-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestUniversalGet_BuildFilterClause_LtOp(t *testing.T) {
	clause, args, next := buildFilterClause("sent_at", "lt.2025-06-01T00:00:00Z", 1)
	if clause != "sent_at < $1" || len(args) != 1 || args[0] != "2025-06-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestUniversalGet_BuildFilterClause_GteOp(t *testing.T) {
	clause, args, next := buildFilterClause("sent_at", "gte.2025-01-01T00:00:00Z", 1)
	if clause != "sent_at >= $1" || len(args) != 1 || args[0] != "2025-01-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestUniversalGet_BuildFilterClause_LteOp(t *testing.T) {
	clause, args, next := buildFilterClause("sent_at", "lte.2025-06-01T00:00:00Z", 1)
	if clause != "sent_at <= $1" || len(args) != 1 || args[0] != "2025-06-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestUniversal_ParseAPIOrder(t *testing.T) {
	var result strings.Builder
	h, mock := setupUniversalHandler(t)
	_ = h
	_ = mock
	result.WriteString("ok")
	_ = result
}

// ─── K1: ownership enforcement (IDOR fix) ───────────────────────────────────

func TestUniversalPost_WallPosts_OwnWall(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_posts.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content"}).
			AddRow("post1", "u1", "u1", "T", "C"))

	// The client tries to forge author_id; the server must force it to the caller.
	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id":   "u1",
		"author_id": "evil",
		"title":     "T",
		"content":   "C",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_WallPosts_ForbiddenForeignWall(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Privacy gate first: u2's profile is public and the wall is not hidden, so
	// the wall-post check proceeds to allow_wall_posts_from_others (which is
	// false here).
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\), COALESCE\(private_hide_wall, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"private", "hide_wall"}).AddRow(false, false))

	mock.ExpectQuery(`SELECT COALESCE\(allow_wall_posts_from_others, true\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(false))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id": "u2",
		"title":   "T",
		"content": "C",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_WallPosts_AllowedForeignWall(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Privacy gate first: u2's profile is public and the wall is not hidden →
	// allowed.
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\), COALESCE\(private_hide_wall, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"private", "hide_wall"}).AddRow(false, false))

	mock.ExpectQuery(`SELECT COALESCE\(allow_wall_posts_from_others, true\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(true))
	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_posts.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id"}).
			AddRow("post1", "u2", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id": "u2",
		"title":   "T",
		"content": "C",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_WallPosts_RequiresAuth(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id": "u1",
		"content": "C",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_Likes_ForcesOwner(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Wall visibility gate: post1 belongs to u1 (the caller) → allowed.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_likes.*VALUES.*ON CONFLICT.*DO UPDATE SET user_id = EXCLUDED.user_id.*RETURNING \*`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id"}).
			AddRow("1", "post1", "u1"))

	// The client attempts to like as another user; the server must use the caller.
	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "post1",
		"user_id": "victim",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_WallPosts_OwnershipScope(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*UPDATE profile_wall_posts SET .* WHERE .*author_id = \$[0-9]+ OR user_id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "content"}).
			AddRow("post1", "u1", "u1", "updated"))

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "updated",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_WallPosts_RequiresAuth(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "updated",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalDelete_WallPosts_OwnershipScope(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*DELETE FROM profile_wall_posts WHERE .*author_id = \$[0-9]+ OR user_id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("post1"))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/profile_wall_posts?id=eq.post1", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_Reposts_ForcesWallOwner(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Wall visibility gate: the reposted source post1 belongs to u1 (the caller)
	// → allowed.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	// Column order in the generated INSERT is map-iteration dependent (random),
	// so the regex must not assume an order.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_reposts \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "wall_user_id"}).
			AddRow("r1", "post1", "u1", "u1"))

	// The client attempts to repost onto a victim's wall; both user_id and
	// wall_user_id must be forced to the caller.
	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_reposts", map[string]string{
		"post_id":      "post1",
		"user_id":      "victim",
		"wall_user_id": "victim",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_WallPosts_CannotMoveToForeignWall(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*UPDATE profile_wall_posts SET .* WHERE .*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "content"}).
			AddRow("post1", "u1", "u1", "updated"))

	// Changing user_id to a victim's wall must not be honored (it is dropped
	// from the SET clause); the request still succeeds scoped to own content.
	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "updated",
		"user_id": "victim",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── H1: gomosub management writes are board-scoped (IDOR fix) ──────────────

func TestUniversalPut_GomosubChannel_CrossBoardRejected(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// u1 owns board "myboard" → permission granted for that board only.
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("myboard").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// The UPDATE must be bound to board_id = myboard; the victim channel belongs
	// to another board, so no row matches → 404, nothing modified.
	mock.ExpectQuery(`(?s).*UPDATE channels SET .* WHERE board_id = \$[0-9]+ AND id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "name"}))

	c, w := newUniversalRequestContext("PUT", "/api/v1/channels?id=eq.victim-channel&board_id=eq.myboard", map[string]string{
		"name": "hacked",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalDelete_GomosubRole_CrossBoardRejected(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("myboard").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// Deleting a role of another board must not match the board-scoped WHERE.
	mock.ExpectQuery(`(?s).*DELETE FROM gomosub_roles WHERE board_id = \$[0-9]+ AND id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id"}))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/gomosub_roles?id=eq.victim-role&board_id=eq.myboard", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_ChannelPermissions_BoardScoped(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("myboard").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// channel_permissions has no board_id column — the scope goes through the
	// referenced channel's board, and the board_id query param must not be
	// turned into a (nonexistent) column filter.
	mock.ExpectQuery(`(?s).*UPDATE channel_permissions SET .* WHERE channel_id IN \(SELECT id FROM channels WHERE board_id = \$[0-9]+\) AND id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "channel_id", "can_read"}).
			AddRow("perm1", "chan1", true))

	c, w := newUniversalRequestContext("PUT", "/api/v1/channel_permissions?id=eq.perm1&board_id=eq.myboard", map[string]string{
		"can_read": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_GomosubMemberships_SelfJoinRoleRejected(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	// A self-join (user_id == caller) must never carry a role_id — otherwise
	// anyone could promote themselves to a privileged role on any board.
	c, w := newUniversalRequestContext("POST", "/api/v1/gomosub_memberships", map[string]string{
		"board_id": "b1",
		"user_id":  "u1",
		"role_id":  "admin-role",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_GomosubMemberships_SelfJoinWithoutRole(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Legitimate self-join without a role still works (default member).
	mock.ExpectQuery(`(?s).*INSERT INTO gomosub_memberships.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "user_id"}).
			AddRow("m1", "b1", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/gomosub_memberships", map[string]string{
		"board_id": "b1",
		"user_id":  "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_GomosubMemberships_ForeignRoleRejected(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("b1").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// The role belongs to another board → the membership update is rejected.
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_roles WHERE id = \$1 AND board_id = \$2\)`).
		WithArgs("foreign-role", "b1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newUniversalRequestContext("PUT", "/api/v1/gomosub_memberships?board_id=eq.b1&user_id=eq.u1", map[string]string{
		"role_id": "foreign-role",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_GomosubMemberships_SameBoardRole(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("b1").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_roles WHERE id = \$1 AND board_id = \$2\)`).
		WithArgs("my-role", "b1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`(?s).*UPDATE gomosub_memberships SET role_id = \$1 WHERE board_id = \$[0-9]+ AND user_id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "user_id", "role_id"}).
			AddRow("m1", "b1", "u1", "my-role"))

	c, w := newUniversalRequestContext("PUT", "/api/v1/gomosub_memberships?board_id=eq.b1&user_id=eq.u1", map[string]string{
		"role_id": "my-role",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalDelete_WallComments_OwnershipScope(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*DELETE FROM profile_wall_post_comments WHERE .*user_id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("c1"))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/profile_wall_post_comments?id=eq.c1", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── C1: SQL injection via JSON body column names (CWE-89) ───────────────────

// TestUniversalPut_RejectsInjectedColumnName proves the exact C1 payload is
// rejected before any SQL is built: a body key that smuggles a scalar subquery
// into the SET clause (absorbing its bind parameter in the trailing ` = $N`)
// must yield 400. sqlmock has no expectations, so any DB access would fail the
// test via ExpectationsWereMet in cleanup.
func TestUniversalPut_RejectsInjectedColumnName(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role = (SELECT password_hash FROM users WHERE username='victim'), updated_at": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestUniversalPut_RejectsCommentInjection covers the `--` comment variant that
// would otherwise comment out the bind parameter and the WHERE clause.
func TestUniversalPut_RejectsCommentInjection(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role = 'moderator' -- ": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestUniversalPut_RejectsParenthesizedColumn covers breaking out of the SET
// clause with closing parens / commas.
func TestUniversalPut_RejectsParenthesizedColumn(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role, updated_at = now())": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestUniversalPost_RejectsInjectedColumnName covers the same defect on the
// INSERT column list (handlePost).
func TestUniversalPost_RejectsInjectedColumnName(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/polls", map[string]string{
		"question) VALUES (1)--": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestUniversalPost_RejectsInjectionBeforeUpsert proves the validation also
// runs on upsert-routed tables (user_daily_visits) and fires before the
// ownership enforcement (the request carries no claims, yet 400 comes from the
// column-name gate, not a 401).
func TestUniversalPost_RejectsInjectionBeforeUpsert(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/user_daily_visits", map[string]string{
		"visit_date, extra = 1": "2025-01-01",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestUniversalPut_ValidUnusualColumnPassesGate guards the mirror-image
// regression: the C1 gate must not be over-restrictive. Legitimate snake_case
// identifiers beyond the trivial ones (has_custom_message, _-prefixed, digits)
// must still reach the DB and not be rejected as "invalid column name".
func TestUniversalPut_ValidUnusualColumnPassesGate(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// handlePut does NOT sort SET columns (map iteration order is random), so
	// the regex must not assume an order. No ownership scope applies to
	// user_roles — only the query filter is in the WHERE clause.
	mock.ExpectQuery(`(?s).*UPDATE user_roles SET has_custom_message = \$[0-9]+, role = \$[0-9]+ WHERE user_id = \$[0-9]+ RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "moderator"))

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role":               "moderator",
		"has_custom_message": "true",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestValidateBodyColumnNames unit-tests the gate directly: legitimate column
// names pass, anything that could alter SQL grammar is rejected.
func TestValidateBodyColumnNames(t *testing.T) {
	valid := []map[string]interface{}{
		{"user_id": "u1", "role": "admin"},
		{"content_json": 1},
		{"updated_at": "2025-01-01T00:00:00Z"},
		{"_private": true},
		{"has_custom_message": false},
	}
	for _, data := range valid {
		if err := validateBodyColumnNames(data); err != nil {
			t.Errorf("valid payload %v rejected: %v", data, err)
		}
	}

	invalid := []string{
		"role = (SELECT password_hash FROM users), updated_at",
		"role = 'moderator' -- ",
		"role, updated_at = now()",
		"a) VALUES (1)--",
		"col; DROP TABLE users",
		"col--",
		"col.",
		"col ",
		" col",
		"1col",
		"col-name",
		"",
		strings.Repeat("a", 64),
	}
	for _, key := range invalid {
		if err := validateBodyColumnNames(map[string]interface{}{key: "x"}); err == nil {
			t.Errorf("malicious key %q was accepted", key)
		}
	}
}

// ─── invalidateCacheForTableResult (posts → board thread list) ───────────────

// TestInvalidatePostClearsBoardThreadList verifies that a post write
// invalidates the board's thread list cache (threads?board_id=eq.X), which is
// keyed by board_id and therefore NOT covered by the thread-scoped post
// invalidation. This mirrors the client-side posts→threads relation.
func TestInvalidatePostClearsBoardThreadList(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	h.redis = client

	threadID := "thread-1"
	boardID := "board-1"

	// Board list + standalone thread page are both cached under distinct keys.
	boardListKey := "data:/api/v1/threads?board_id=eq." + boardID + "&order=created_at.desc|viewer=anon"
	threadKey := "data:/api/v1/threads?id=eq." + threadID + "|viewer=anon"
	if err := mr.Set(boardListKey, `{"data":[]}`); err != nil {
		t.Fatalf("failed to seed board list cache: %v", err)
	}
	if err := mr.Set(threadKey, `{"data":[]}`); err != nil {
		t.Fatalf("failed to seed thread cache: %v", err)
	}

	// The helper resolves the thread's board via DB to know which list to clear.
	mock.ExpectQuery(`SELECT board_id FROM threads WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"board_id"}).AddRow(boardID))

	c, _ := newUniversalRequestContext("POST", "/api/v1/posts", nil, nil)
	h.invalidateCacheForTableResult(c, "posts", map[string]interface{}{
		"id":        "post-1",
		"thread_id": threadID,
	})

	if mr.Exists(boardListKey) {
		t.Errorf("board thread list cache %q was not invalidated after post write", boardListKey)
	}
	if mr.Exists(threadKey) {
		t.Errorf("standalone thread cache %q was not invalidated after post write", threadKey)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %v", err)
	}
}
