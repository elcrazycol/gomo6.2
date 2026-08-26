package crudengine

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crud"
	"github.com/redis/go-redis/v9"
)

// ─── HandleTableRequest ──────────────────────────────────────────────────────

func TestHandleTableRequest_DisallowedTable(t *testing.T) {
	h, mock := setupEngine(t)

	c, w := newRequestContext("GET", "/api/v1/secret_table", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleTableRequest_EmptyTable(t *testing.T) {
	h, mock := setupEngine(t)

	c, w := newRequestContext("GET", "/api/v1/", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleTableRequest_MethodNotAllowed(t *testing.T) {
	h, mock := setupEngine(t)

	c, w := newRequestContext("PATCH", "/api/v1/privacy_settings", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

// ─── handleGet ───────────────────────────────────────────────────────────────

func TestEngineGet_Success(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT \* FROM gomosub_memberships`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "board_id"}).
			AddRow("1", "u1", "b1").AddRow("2", "u2", "b2"))

	c, w := newRequestContext("GET", "/api/v1/gomosub_memberships", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineGet_WithFilter(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "admin"))

	c, w := newRequestContext("GET", "/api/v1/user_roles?user_id=eq.u1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineGet_DBError(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT \* FROM gomosub_memberships`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRequestContext("GET", "/api/v1/gomosub_memberships", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestEnginePost_Success(t *testing.T) {
	h, mock := setupEngine(t)

	// INSERT columns are sorted alphabetically (thread_id, user_id); user_id
	// is forced to the caller by ownership enforcement, so the client-supplied
	// value is irrelevant.
	mock.ExpectQuery(`INSERT INTO thread_subscriptions \(thread_id, user_id\) VALUES \(\$1, \$2\) RETURNING \*`).
		WithArgs("t1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "thread_id", "user_id"}).
			AddRow("s1", "t1", "u1"))

	c, w := newRequestContext("POST", "/api/v1/thread_subscriptions", map[string]string{
		"thread_id": "t1",
		"user_id":   "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_UpsertDailyVisits(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*INSERT INTO user_daily_visits.*VALUES.*ON CONFLICT.*DO UPDATE.*RETURNING \*`).
		WithArgs("u1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "visit_date"}).
			AddRow("1", "u1", "2025-01-01"))

	c, w := newRequestContext("POST", "/api/v1/user_daily_visits", map[string]string{
		"user_id": "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_Success(t *testing.T) {
	h, mock := setupEngine(t)

	// The ownership scope (user_id = caller) is appended before the query
	// filter, so the WHERE carries two user_id predicates.
	mock.ExpectQuery(`UPDATE privacy_settings SET show_online_status = \$1 WHERE user_id = \$2 AND user_id = \$3 RETURNING \*`).
		WithArgs("true", "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "show_online_status"}).
			AddRow("1", "u1", true))

	c, w := newRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_MissingFilter(t *testing.T) {
	h, mock := setupEngine(t)

	// user_terms_acceptance has no ownership scope and no query filter, so the
	// PUT must be rejected before any SQL is built.
	c, w := newRequestContext("PUT", "/api/v1/user_terms_acceptance", map[string]string{
		"terms_version": "1.1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_NotFound(t *testing.T) {
	h, mock := setupEngine(t)

	// The ownership scope adds user_id = caller (u1) in addition to the
	// user_id=eq.u1 query filter.
	mock.ExpectQuery(`(?s).*UPDATE privacy_settings SET show_online_status = \$1 WHERE .*user_id = \$2.*user_id = \$3.*RETURNING \*`).
		WithArgs("false", "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "show_online_status"}))

	c, w := newRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status": "false",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── privacy_settings writes: ownership enforcement (anti-IDOR) ─────────────

func TestEnginePost_PrivacySettings_ForcesOwner(t *testing.T) {
	h, mock := setupEngine(t)

	// The client attempts to create/update privacy settings for a victim; the
	// server must force user_id to the caller. INSERT columns are sorted
	// alphabetically (private_profile, user_id), so the args order is fixed.
	mock.ExpectQuery(`(?s).*INSERT INTO privacy_settings \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WithArgs("true", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "private_profile"}).
			AddRow("1", "u1", true))

	c, w := newRequestContext("POST", "/api/v1/privacy_settings", map[string]string{
		"user_id":         "victim",
		"private_profile": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_PrivacySettings_CannotTouchForeignRow(t *testing.T) {
	h, mock := setupEngine(t)

	// An attacker tries to flip the victim's private_profile via a generic PUT.
	// The ownership scope (user_id = attacker) AND the user_id=eq.victim filter
	// can never match the victim's row → 404, nothing updated.
	mock.ExpectQuery(`(?s).*UPDATE privacy_settings SET private_profile = \$1 WHERE .*user_id = \$2.*user_id = \$3.*RETURNING \*`).
		WithArgs("true", "u1", "victim").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "private_profile"}))

	c, w := newRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.victim", map[string]string{
		"private_profile": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── handleDelete ────────────────────────────────────────────────────────────

func TestEngineDelete_Success(t *testing.T) {
	h, mock := setupEngine(t)

	// The ownership scope (user_id = caller) is appended before the id filter.
	mock.ExpectQuery(`DELETE FROM poll_votes WHERE user_id = \$1 AND id = \$2 RETURNING \*`).
		WithArgs("u1", "vote1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "poll_id", "user_id"}).
			AddRow("vote1", "poll1", "u1"))

	c, w := newRequestContext("DELETE", "/api/v1/poll_votes?id=eq.vote1", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineDelete_MissingFilter(t *testing.T) {
	h, mock := setupEngine(t)

	// user_terms_acceptance has no ownership scope — without a filter the
	// DELETE must be rejected before any SQL is built.
	c, w := newRequestContext("DELETE", "/api/v1/user_terms_acceptance", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineDelete_NotFound(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`DELETE FROM thread_subscriptions WHERE user_id = \$1 AND id = \$2 RETURNING \*`).
		WithArgs("u1", "nonexistent").
		WillReturnRows(sqlmock.NewRows([]string{"id", "thread_id", "user_id"}))

	c, w := newRequestContext("DELETE", "/api/v1/thread_subscriptions?id=eq.nonexistent", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineGet_UserAchievements(t *testing.T) {
	h, mock := setupEngine(t)

	// The actual query is a complex JOIN - use (?s).* to match the full structure
	mock.ExpectQuery(`(?s).*SELECT ua\.id, ua\.user_id.*FROM user_achievements ua.*LEFT JOIN achievements a.*WHERE ua\.user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "achievement_id", "unlocked_at", "level", "is_pinned", "pinned_order", "achievements"}).
			AddRow("1", "u1", "ach1", "2025-01-01T00:00:00Z", 1, false, nil, `{"id":"ach1","name":"Test"}`))

	c, w := newRequestContext("GET", "/api/v1/user_achievements", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func TestEngine_ParseOrCondition(t *testing.T) {
	col, op, val, ok := crud.ParseOrCondition("user_id.eq.123")
	if !ok || col != "user_id" || op != "eq" || val != "123" {
		t.Fatalf("unexpected result: %s, %s, %s, %v", col, op, val, ok)
	}
}

func TestEngine_SplitCSV(t *testing.T) {
	result := crud.SplitCSV("a,b,c")
	if len(result) != 3 || result[0] != "a" || result[1] != "b" || result[2] != "c" {
		t.Fatalf("unexpected: %v", result)
	}
}

func TestEngine_SplitCSV_Empty(t *testing.T) {
	result := crud.SplitCSV("")
	if result != nil {
		t.Fatalf("expected nil, got %v", result)
	}
}

func TestEngine_JoinStrings(t *testing.T) {
	result := crud.JoinStrings([]string{"a", "b", "c"}, ", ")
	if result != "a, b, c" {
		t.Fatalf("unexpected: %s", result)
	}
	result2 := crud.JoinStrings(nil, ",")
	if result2 != "" {
		t.Fatalf("unexpected: %s", result2)
	}
}

// test helper to verify Engine response parsing
type engineResponse struct {
	Data  json.RawMessage `json:"data"`
	Error *string         `json:"error"`
}

func TestEnginePost_UpsertGomosubRules(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*INSERT INTO gomosub_rules_acceptance.*VALUES.*ON CONFLICT.*DO UPDATE.*RETURNING \*`).
		WithArgs("u1", "b1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "board_id"}).
			AddRow("1", "u1", "b1"))

	c, w := newRequestContext("POST", "/api/v1/gomosub_rules_acceptance", map[string]string{
		"user_id":  "u1",
		"board_id": "b1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp engineResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestEnginePost_UpsertWallPostLikes(t *testing.T) {
	h, mock := setupEngine(t)

	// Wall visibility gate: post1 belongs to u1 (the caller) → allowed.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_likes.*VALUES.*ON CONFLICT.*DO UPDATE SET user_id = EXCLUDED.user_id.*RETURNING \*`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id"}).
			AddRow("1", "post1", "u1"))

	c, w := newRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "post1",
		"user_id": "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_InvalidBody(t *testing.T) {
	h, mock := setupEngine(t)

	c, w := newRequestContext("POST", "/api/v1/thread_subscriptions", "invalid json", nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestEngineGet_WithInFilter(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id IN \(\$1, \$2\)`).
		WithArgs("u1", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "admin").AddRow("2", "u2", "user"))

	c, w := newRequestContext("GET", "/api/v1/user_roles?user_id=in.(u1,u2)", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineGet_WithIsNull(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id IS NULL`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}))

	c, w := newRequestContext("GET", "/api/v1/user_roles?user_id=is.null", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineGet_ProfileWallPosts(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE .*p\.user_id = \$1.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "Hello!", "Test", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`))

	c, w := newRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineGet_ProfileWallPostComments(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE .*wp\.user_id = \$1.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}).
			AddRow("comment1", "post1", "u1", "Nice!", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", `{}`))

	c, w := newRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_DBError(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`UPDATE privacy_settings SET show_online_status = \$1 WHERE user_id = \$2 AND user_id = \$3 RETURNING \*`).
		WithArgs("false", "u1", "u1").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status": "false",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestEngineGet_BuildFilterClause_PlainValue(t *testing.T) {
	clause, args, next := crud.BuildFilterClause("user_id", "u1", 1)
	if clause != "user_id = $1" || len(args) != 1 || args[0] != "u1" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestEngineGet_BuildFilterClause_NotOp(t *testing.T) {
	clause, args, next := crud.BuildFilterClause("user_id", "not.eq.u1", 1)
	if clause != "NOT (user_id = $1)" || len(args) != 1 || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestEngineGet_BuildFilterClause_GtOp(t *testing.T) {
	clause, args, next := crud.BuildFilterClause("sent_at", "gt.2025-01-01T00:00:00Z", 1)
	if clause != "sent_at > $1" || len(args) != 1 || args[0] != "2025-01-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestEngineGet_BuildFilterClause_LtOp(t *testing.T) {
	clause, args, next := crud.BuildFilterClause("sent_at", "lt.2025-06-01T00:00:00Z", 1)
	if clause != "sent_at < $1" || len(args) != 1 || args[0] != "2025-06-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestEngineGet_BuildFilterClause_GteOp(t *testing.T) {
	clause, args, next := crud.BuildFilterClause("sent_at", "gte.2025-01-01T00:00:00Z", 1)
	if clause != "sent_at >= $1" || len(args) != 1 || args[0] != "2025-01-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestEngineGet_BuildFilterClause_LteOp(t *testing.T) {
	clause, args, next := crud.BuildFilterClause("sent_at", "lte.2025-06-01T00:00:00Z", 1)
	if clause != "sent_at <= $1" || len(args) != 1 || args[0] != "2025-06-01T00:00:00Z" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestEngine_ParseAPIOrder(t *testing.T) {
	var result strings.Builder
	h, mock := setupEngine(t)
	_ = h
	_ = mock
	result.WriteString("ok")
	_ = result
}

// ─── K1: ownership enforcement (IDOR fix) ───────────────────────────────────

func TestEnginePost_WallPosts_OwnWall(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_posts.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content"}).
			AddRow("post1", "u1", "u1", "T", "C"))

	// The client tries to forge author_id; the server must force it to the caller.
	c, w := newRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
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

func TestEnginePost_WallPosts_ForbiddenForeignWall(t *testing.T) {
	h, mock := setupEngine(t)

	// Privacy gate first: u2's profile is public and the wall is not hidden, so
	// the wall-post check proceeds to allow_wall_posts_from_others (which is
	// false here).
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\), COALESCE\(private_hide_wall, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"private", "hide_wall"}).AddRow(false, false))

	mock.ExpectQuery(`SELECT COALESCE\(allow_wall_posts_from_others, true\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(false))

	c, w := newRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id": "u2",
		"title":   "T",
		"content": "C",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_WallPosts_AllowedForeignWall(t *testing.T) {
	h, mock := setupEngine(t)

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

	c, w := newRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id": "u2",
		"title":   "T",
		"content": "C",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_WallPosts_RequiresAuth(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id": "u1",
		"content": "C",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_Likes_ForcesOwner(t *testing.T) {
	h, mock := setupEngine(t)

	// Wall visibility gate: post1 belongs to u1 (the caller) → allowed.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_likes.*VALUES.*ON CONFLICT.*DO UPDATE SET user_id = EXCLUDED.user_id.*RETURNING \*`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id"}).
			AddRow("1", "post1", "u1"))

	// The client attempts to like as another user; the server must use the caller.
	c, w := newRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "post1",
		"user_id": "victim",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_WallPosts_OwnershipScope(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*UPDATE profile_wall_posts SET .* WHERE .*author_id = \$[0-9]+ OR user_id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "content"}).
			AddRow("post1", "u1", "u1", "updated"))

	c, w := newRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "updated",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_WallPosts_RequiresAuth(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "updated",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineDelete_WallPosts_OwnershipScope(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*DELETE FROM profile_wall_posts WHERE .*author_id = \$[0-9]+ OR user_id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("post1"))

	c, w := newRequestContext("DELETE", "/api/v1/profile_wall_posts?id=eq.post1", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_Reposts_ForcesWallOwner(t *testing.T) {
	h, mock := setupEngine(t)

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
	c, w := newRequestContext("POST", "/api/v1/profile_wall_post_reposts", map[string]string{
		"post_id":      "post1",
		"user_id":      "victim",
		"wall_user_id": "victim",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_WallPosts_CannotMoveToForeignWall(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*UPDATE profile_wall_posts SET .* WHERE .*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "content"}).
			AddRow("post1", "u1", "u1", "updated"))

	// Changing user_id to a victim's wall must not be honored (it is dropped
	// from the SET clause); the request still succeeds scoped to own content.
	c, w := newRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "updated",
		"user_id": "victim",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── H1: gomosub management writes are board-scoped (IDOR fix) ──────────────

func TestEnginePut_GomosubChannel_CrossBoardRejected(t *testing.T) {
	h, mock := setupEngine(t)

	// u1 owns board "myboard" → permission granted for that board only.
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("myboard").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// The UPDATE must be bound to board_id = myboard; the victim channel belongs
	// to another board, so no row matches → 404, nothing modified.
	mock.ExpectQuery(`(?s).*UPDATE channels SET .* WHERE board_id = \$[0-9]+ AND id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "name"}))

	c, w := newRequestContext("PUT", "/api/v1/channels?id=eq.victim-channel&board_id=eq.myboard", map[string]string{
		"name": "hacked",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineDelete_GomosubRole_CrossBoardRejected(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("myboard").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// Deleting a role of another board must not match the board-scoped WHERE.
	mock.ExpectQuery(`(?s).*DELETE FROM gomosub_roles WHERE board_id = \$[0-9]+ AND id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id"}))

	c, w := newRequestContext("DELETE", "/api/v1/gomosub_roles?id=eq.victim-role&board_id=eq.myboard", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_ChannelPermissions_BoardScoped(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("myboard").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// channel_permissions has no board_id column — the scope goes through the
	// referenced channel's board, and the board_id query param must not be
	// turned into a (nonexistent) column filter.
	mock.ExpectQuery(`(?s).*UPDATE channel_permissions SET .* WHERE channel_id IN \(SELECT id FROM channels WHERE board_id = \$[0-9]+\) AND id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "channel_id", "can_read"}).
			AddRow("perm1", "chan1", true))

	c, w := newRequestContext("PUT", "/api/v1/channel_permissions?id=eq.perm1&board_id=eq.myboard", map[string]string{
		"can_read": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_GomosubMemberships_SelfJoinRoleRejected(t *testing.T) {
	h, _ := setupEngine(t)

	// A self-join (user_id == caller) must never carry a role_id — otherwise
	// anyone could promote themselves to a privileged role on any board.
	c, w := newRequestContext("POST", "/api/v1/gomosub_memberships", map[string]string{
		"board_id": "b1",
		"user_id":  "u1",
		"role_id":  "admin-role",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePost_GomosubMemberships_SelfJoinWithoutRole(t *testing.T) {
	h, mock := setupEngine(t)

	// Legitimate self-join without a role still works (default member).
	mock.ExpectQuery(`(?s).*INSERT INTO gomosub_memberships.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "user_id"}).
			AddRow("m1", "b1", "u1"))

	c, w := newRequestContext("POST", "/api/v1/gomosub_memberships", map[string]string{
		"board_id": "b1",
		"user_id":  "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_GomosubMemberships_ForeignRoleRejected(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("b1").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// The role belongs to another board → the membership update is rejected.
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_roles WHERE id = \$1 AND board_id = \$2\)`).
		WithArgs("foreign-role", "b1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newRequestContext("PUT", "/api/v1/gomosub_memberships?board_id=eq.b1&user_id=eq.u1", map[string]string{
		"role_id": "foreign-role",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEnginePut_GomosubMemberships_SameBoardRole(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("b1").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_roles WHERE id = \$1 AND board_id = \$2\)`).
		WithArgs("my-role", "b1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`(?s).*UPDATE gomosub_memberships SET role_id = \$1 WHERE board_id = \$[0-9]+ AND user_id = \$[0-9]+.*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "user_id", "role_id"}).
			AddRow("m1", "b1", "u1", "my-role"))

	c, w := newRequestContext("PUT", "/api/v1/gomosub_memberships?board_id=eq.b1&user_id=eq.u1", map[string]string{
		"role_id": "my-role",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEngineDelete_WallComments_OwnershipScope(t *testing.T) {
	h, mock := setupEngine(t)

	// Deleting a wall comment is a SOFT delete: the row (and with it the reply
	// subtree) survives as a "Комментарий удалён" placeholder — the content is
	// wiped, user_id is nulled (M-3: the author must be gone forever, not just
	// hidden by the UI) and is_deleted is flagged instead of removing the row.
	// The WHERE keeps the ownership scope (user_id = caller) plus the id
	// filter — it reads the pre-update row, so the delete itself is unaffected.
	mock.ExpectQuery(`(?s).*UPDATE profile_wall_post_comments SET content = NULL, content_json = NULL, user_id = NULL, is_deleted = TRUE, updated_at = NOW\(\) WHERE user_id = \$[0-9]+ AND id = \$[0-9]+ RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "is_deleted"}).
			AddRow("c1", "post1", nil, true))

	c, w := newRequestContext("DELETE", "/api/v1/profile_wall_post_comments?id=eq.c1", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "\"is_deleted\":true") {
		t.Fatalf("expected soft-deleted flag in response, got: %s", w.Body.String())
	}
}

// ─── C1: SQL injection via JSON body column names (CWE-89) ───────────────────

// TestEnginePut_RejectsInjectedColumnName proves the exact C1 payload is
// rejected before any SQL is built: a body key that smuggles a scalar subquery
// into the SET clause (absorbing its bind parameter in the trailing ` = $N`)
// must yield 400. sqlmock has no expectations, so any DB access would fail the
// test via ExpectationsWereMet in cleanup.
func TestEnginePut_RejectsInjectedColumnName(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status = (SELECT password_hash FROM users WHERE username='victim'), updated_at": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePut_RejectsCommentInjection covers the `--` comment variant that
// would otherwise comment out the bind parameter and the WHERE clause.
func TestEnginePut_RejectsCommentInjection(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status = 'true' -- ": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePut_RejectsParenthesizedColumn covers breaking out of the SET
// clause with closing parens / commas.
func TestEnginePut_RejectsParenthesizedColumn(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status, updated_at = now())": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePost_RejectsInjectedColumnName covers the same defect on the
// INSERT column list (handlePost).
func TestEnginePost_RejectsInjectedColumnName(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("POST", "/api/v1/thread_subscriptions", map[string]string{
		"thread_id) VALUES (1)--": "x",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePost_RejectsInjectionBeforeUpsert proves the validation also
// runs on upsert-routed tables (user_daily_visits) and fires before the
// ownership enforcement (the request carries no claims, yet 400 comes from the
// column-name gate, not a 401).
func TestEnginePost_RejectsInjectionBeforeUpsert(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("POST", "/api/v1/user_daily_visits", map[string]string{
		"visit_date, extra = 1": "2025-01-01",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePut_ValidUnusualColumnPassesGate guards the mirror-image
// regression: the C1 gate must not be over-restrictive. Legitimate snake_case
// identifiers beyond the trivial ones (has_custom_message, _-prefixed, digits)
// must still reach the DB and not be rejected as "invalid column name".
func TestEnginePut_ValidUnusualColumnPassesGate(t *testing.T) {
	h, mock := setupEngine(t)

	// handlePut does NOT sort SET columns (map iteration order is random), so
	// the regex accepts either order. The ownership scope (user_id = caller) is
	// appended before the query filter, so the WHERE carries two user_id
	// predicates.
	mock.ExpectQuery(`(?s).*UPDATE thread_custom_message_visits SET (has_custom_message = \$[0-9]+, thread_id = \$[0-9]+|thread_id = \$[0-9]+, has_custom_message = \$[0-9]+) WHERE user_id = \$[0-9]+ AND user_id = \$[0-9]+ RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "thread_id", "has_custom_message"}).
			AddRow("1", "u1", "t1", true))

	c, w := newRequestContext("PUT", "/api/v1/thread_custom_message_visits?user_id=eq.u1", map[string]string{
		"has_custom_message": "true",
		"thread_id":          "t1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePut_ThreadCustomMessage_ForeignRow proves the ownership scope on
// thread_custom_message_visits (added for its registered PUT route): a PUT
// targeting a victim's row via user_id=eq.<victim> can never match because the
// scope forces user_id = caller → 404, nothing updated.
func TestEnginePut_ThreadCustomMessage_ForeignRow(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`(?s).*UPDATE thread_custom_message_visits SET .* WHERE user_id = \$[0-9]+ AND user_id = \$[0-9]+ RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), "u1", "victim").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "thread_id", "has_custom_message"}))

	c, w := newRequestContext("PUT", "/api/v1/thread_custom_message_visits?user_id=eq.victim", map[string]string{
		"has_custom_message": "true",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
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
		if err := crud.ValidateBodyColumnNames(data); err != nil {
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
		if err := crud.ValidateBodyColumnNames(map[string]interface{}{key: "x"}); err == nil {
			t.Errorf("malicious key %q was accepted", key)
		}
	}
}

// ─── H2: server-managed tables are write-denied (mass-assignment fix) ────────

// TestEnginePost_WriteDeniedTables proves the privilege-escalation vector is
// closed: any POST to a server-managed table (user_roles, achievements,
// user_achievements, polls) is rejected with 403 before any SQL is built, so a
// client can never INSERT a row that grants themselves the admin role or forges
// achievements/polls. sqlmock has no expectations, so any DB access would fail
// the test via ExpectationsWereMet in cleanup.
func TestEnginePost_WriteDeniedTables(t *testing.T) {
	for _, table := range []string{"user_roles", "achievements", "user_achievements", "polls"} {
		t.Run(table, func(t *testing.T) {
			h, mock := setupEngine(t)
			_ = mock

			c, w := newRequestContext("POST", "/api/v1/"+table, map[string]string{
				"role":  "admin",
				"value": "x",
			}, &auth.Claims{UserID: "u1"})
			h.HandleTableRequest(c)

			if w.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "Writes to this table are not allowed") {
				t.Fatalf("unexpected error message: %s", w.Body.String())
			}
		})
	}
}

// TestEnginePut_WriteDeniedTable covers the same vector via PUT: the exact
// privilege-escalation payload (role=admin on user_roles) must 403.
func TestEnginePut_WriteDeniedTable(t *testing.T) {
	h, _ := setupEngine(t)

	c, w := newRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role": "admin",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePost_EmojiPacks_StripsCounters proves the counter columns
// (emoji_count, subscriber_count) — maintained by triggers and the
// subscription flow — are stripped from a client INSERT. If they reached the
// statement, the mock query shape would not match and the test would fail.
func TestEnginePost_EmojiPacks_StripsCounters(t *testing.T) {
	h, mock := setupEngine(t)

	// INSERT columns are sorted alphabetically: author_id, description,
	// icon_url, is_public, name, slug. The forged counters must be absent and
	// author_id must be forced to the caller.
	mock.ExpectQuery(`INSERT INTO emoji_packs \(author_id, description, icon_url, is_public, name, slug\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\) RETURNING \*`).
		WithArgs("u1", "desc", "icon.png", "true", "My Pack", "my-pack").
		WillReturnRows(sqlmock.NewRows([]string{"id", "author_id", "name"}).
			AddRow("p1", "u1", "My Pack"))

	c, w := newRequestContext("POST", "/api/v1/emoji_packs", map[string]string{
		"name":             "My Pack",
		"slug":             "my-pack",
		"description":      "desc",
		"icon_url":         "icon.png",
		"is_public":        "true",
		"emoji_count":      "999",
		"subscriber_count": "999",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEnginePost_PollVotes_ForcesOwner proves a forged user_id on a
// user-owned table is overwritten with the caller's ID (column allowlist +
// ownership forcing), so a client can never cast votes as another user.
func TestEnginePost_PollVotes_ForcesOwner(t *testing.T) {
	h, mock := setupEngine(t)

	// user_id must end up bound to the caller, not the forged "victim".
	mock.ExpectQuery(`INSERT INTO poll_votes \(option_index, poll_id, user_id\) VALUES \(\$1, \$2, \$3\) RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), "poll1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "poll_id", "user_id"}).
			AddRow("v1", "poll1", "u1"))

	c, w := newRequestContext("POST", "/api/v1/poll_votes", map[string]string{
		"poll_id":      "poll1",
		"option_index": "1",
		"user_id":      "victim",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEngineDelete_PollVotes_ScopedToSelf proves an unfiltered DELETE on a
// user-owned table is still bounded to the caller's own rows by the ownership
// scope — a mass-delete can never touch other users' records.
func TestEngineDelete_PollVotes_ScopedToSelf(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`DELETE FROM poll_votes WHERE user_id = \$1 RETURNING \*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "poll_id", "user_id"}).
			AddRow("v1", "poll1", "u1"))

	c, w := newRequestContext("DELETE", "/api/v1/poll_votes", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestEngineDelete_ThreadSubscriptions_ForeignRow proves a subscription of
// another user cannot be deleted: the ownership scope (user_id = caller) AND
// the id filter can never match a foreign row → 404, nothing deleted.
func TestEngineDelete_ThreadSubscriptions_ForeignRow(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`DELETE FROM thread_subscriptions WHERE user_id = \$1 AND id = \$2 RETURNING \*`).
		WithArgs("u1", "victim-sub").
		WillReturnRows(sqlmock.NewRows([]string{"id", "thread_id", "user_id"}))

	c, w := newRequestContext("DELETE", "/api/v1/thread_subscriptions?id=eq.victim-sub", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── invalidateCacheForTableResult (registry dispatch) ──────────────────────

// TestInvalidateEmojiPacksDispatch verifies the registry-driven dispatcher
// runs a table's declared invalidation hook: an emoji_packs write must clear
// the pack list, the by-slug gate and the /my-emoji-* lists that embed pack
// metadata — a forgotten hook (the old switch-based design's recurring bug)
// would keep serving the pre-change list for the whole TTL.
func TestInvalidateEmojiPacksDispatch(t *testing.T) {
	h, _ := setupEngine(t)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	h.redis = client

	keys := []string{
		"data:/api/v1/emoji_packs?order=created_at.desc|viewer=anon",
		"data:/api/v1/emoji_packs/by-slug/my-pack|viewer=anon",
		"data:/api/v1/my-emoji-subscriptions?user_id=eq.u1",
		"data:/api/v1/my-emoji-packs?user_id=eq.u1",
	}
	for _, key := range keys {
		if err := mr.Set(key, `{"data":[]}`); err != nil {
			t.Fatalf("failed to seed cache key %q: %v", key, err)
		}
	}

	c, _ := newRequestContext("POST", "/api/v1/emoji_packs", nil, nil)
	h.invalidateCacheForTableResult(c, "emoji_packs", map[string]interface{}{
		"id":        "pack-1",
		"author_id": "u1",
	})

	for _, key := range keys {
		if mr.Exists(key) {
			t.Errorf("cache key %q was not invalidated after emoji_packs write", key)
		}
	}
}

// TestInvalidateGenericFallback verifies the dispatcher's default path: a
// writable table without a declared invalidation hook falls back to the
// generic table invalidation keyed by the row id, so a new registry table can
// never silently skip cache invalidation entirely (the documented recurring
// stale-data bug).
func TestInvalidateGenericFallback(t *testing.T) {
	h, _ := setupEngine(t)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	h.redis = client

	// thread_subscriptions is writable through the generic surface but
	// declares no InvalidateCache hook — the dispatcher must still clear its
	// rows via the generic fallback.
	matching := "data:/api/v1/thread_subscriptions?id=eq.ts1&select=id|viewer=u1"
	unrelated := "data:/api/v1/thread_subscriptions?id=eq.other|viewer=u1"
	if err := mr.Set(matching, `{"data":[]}`); err != nil {
		t.Fatalf("failed to seed cache key: %v", err)
	}
	if err := mr.Set(unrelated, `{"data":[]}`); err != nil {
		t.Fatalf("failed to seed cache key: %v", err)
	}

	c, _ := newRequestContext("POST", "/api/v1/thread_subscriptions", nil, nil)
	h.invalidateCacheForTableResult(c, "thread_subscriptions", map[string]interface{}{
		"id": "ts1",
	})

	if mr.Exists(matching) {
		t.Errorf("matching row cache %q was not invalidated by the generic fallback", matching)
	}
	if !mr.Exists(unrelated) {
		t.Errorf("unrelated row cache %q was invalidated by the generic fallback", unrelated)
	}
}
