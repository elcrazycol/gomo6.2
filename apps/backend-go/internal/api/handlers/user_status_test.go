package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// setupUserStatusHandler creates a UserStatusHandler with a mock DB and a real hub (no redis).
func setupUserStatusHandler(t *testing.T) (*UserStatusHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	hub := websocket.NewHub(nil, nil) // no redis, no real connections
	handler := NewUserStatusHandler(db, hub)
	return handler, mock
}

// newStatusGETContext creates a gin context for GET /users/:id/status with path param :id.
func newStatusGETContext(userID string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	req := httptest.NewRequest(http.MethodGet, "/users/"+userID+"/status", nil)
	c.Request = req
	c.Params = []gin.Param{{Key: "id", Value: userID}}

	return c, w
}

// newBulkStatusContext creates a gin context for POST /users/status/bulk with JSON body.
func newBulkStatusContext(body interface{}) (*gin.Context, *httptest.ResponseRecorder) {
	return newPOSTContext("/users/status/bulk", body, nil, nil)
}

// ─── GetOnlineUsers ──────────────────────────────────────────────────────────

func TestGetOnlineUsers_EmptyHub(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	c, w := newGETContext("/users/online", nil)
	h.GetOnlineUsers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			OnlineUsers []string `json:"online_users"`
			Count       int      `json:"count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if resp.Data.Count != 0 {
		t.Fatalf("expected 0, got %d", resp.Data.Count)
	}
	if len(resp.Data.OnlineUsers) != 0 {
		t.Fatalf("expected empty online_users, got %v", resp.Data.OnlineUsers)
	}
	_ = mock
}

// ─── GetUserStatus ───────────────────────────────────────────────────────────

func TestGetUserStatus_OnlineWithLastSeen(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userID := "550e8400-e29b-41d4-a716-446655440000"
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_online", "last_seen_at", "show_status"}).
			AddRow(userID, true, now, true))

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if status.UserID != userID {
		t.Fatalf("expected userID %q, got %q", userID, status.UserID)
	}
	if !status.IsOnline {
		t.Fatal("expected is_online = true")
	}
	if status.LastSeen == nil {
		t.Fatal("expected last_seen to be non-nil")
	}
	if !status.LastSeen.Equal(now) {
		t.Fatalf("expected last_seen %v, got %v", now, status.LastSeen)
	}
}

func TestGetUserStatus_OnlineNoLastSeen(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userID := "550e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_online", "last_seen_at", "show_status"}).
			AddRow(userID, true, nil, true))

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if !status.IsOnline {
		t.Fatal("expected is_online = true")
	}
	if status.LastSeen != nil {
		t.Fatalf("expected nil last_seen, got %v", status.LastSeen)
	}
}

func TestGetUserStatus_PrivacyHidden(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userID := "550e8400-e29b-41d4-a716-446655440002"
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_online", "last_seen_at", "show_status"}).
			AddRow(userID, true, now, false))

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if status.IsOnline {
		t.Fatal("expected is_online = false when privacy hides status")
	}
	if status.LastSeen != nil {
		t.Fatal("expected nil last_seen when privacy hides status")
	}
}

// M1: a private profile must not leak last_seen to an authenticated non-friend.
func TestGetUserStatus_PrivateProfileNonFriend(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userID := "550e8400-e29b-41d4-a716-446655440009"

	// ShouldFilterPrivateProfile → GetPrivacySettings: private_profile=true
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WillReturnRows(sqlmock.NewRows([]string{
			"private_profile", "private_hide_avatar", "private_hide_wall",
			"private_hide_threads", "private_hide_stats", "private_hide_friends",
			"private_hide_gifts", "private_hide_achievements",
		}).AddRow(true, true, true, true, true, true, true, true))

	// IsMutualFriend: viewer is not a friend
	mock.ExpectQuery(`SELECT EXISTS\(`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newStatusGETContext(userID)
	c.Set("claims", &auth.Claims{UserID: "viewer-999", Username: "stranger"})
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if status.IsOnline {
		t.Fatal("expected is_online = false for private profile viewed by non-friend")
	}
	if status.LastSeen != nil {
		t.Fatal("expected nil last_seen for private profile viewed by non-friend")
	}
	if status.UserID != userID {
		t.Fatalf("expected userID %q, got %q", userID, status.UserID)
	}
}

// H-anon: anonymous visitors must also be filtered from private profiles.
func TestGetUserStatus_PrivateProfileAnonymous(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userID := "550e8400-e29b-41d4-a716-446655440010"

	// Anonymous: GetPrivacySettings says private_profile=true → filter without
	// friendship lookup (no viewer identity).
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WillReturnRows(sqlmock.NewRows([]string{
			"private_profile", "private_hide_avatar", "private_hide_wall",
			"private_hide_threads", "private_hide_stats", "private_hide_friends",
			"private_hide_gifts", "private_hide_achievements",
		}).AddRow(true, true, true, true, true, true, true, true))

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if status.IsOnline {
		t.Fatal("expected is_online = false for anonymous viewer of private profile")
	}
	if status.LastSeen != nil {
		t.Fatal("expected nil last_seen for anonymous viewer of private profile")
	}
}

func TestGetUserStatus_NotFound(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userID := "nonexistent"

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = \$1`).
		WithArgs(userID).
		WillReturnError(sql.ErrNoRows)

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetUserStatus_DBError(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = \$1`).
		WithArgs(userID).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── GetBulkUserStatus ───────────────────────────────────────────────────────

func TestGetBulkUserStatus_Success(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userIDs := []string{"u1", "u2"}
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = ANY\(\$1\)`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_online", "last_seen_at", "show_status"}).
			AddRow("u1", true, now, true).
			AddRow("u2", false, nil, true))

	c, w := newBulkStatusContext(map[string]interface{}{
		"user_ids": userIDs,
	})
	h.GetBulkUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	statuses, ok := resp.Data.([]interface{})
	if !ok {
		t.Fatalf("expected array, got %T", resp.Data)
	}
	if len(statuses) != 2 {
		t.Fatalf("expected 2 statuses, got %d", len(statuses))
	}
}

func TestGetBulkUserStatus_EmptyIDs(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	c, w := newBulkStatusContext(map[string]interface{}{
		"user_ids": []string{},
	})
	h.GetBulkUserStatus(c)
	_ = mock

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	statuses, ok := resp.Data.([]interface{})
	if !ok {
		t.Fatalf("expected array, got %T", resp.Data)
	}
	if len(statuses) != 0 {
		t.Fatalf("expected 0 statuses, got %d", len(statuses))
	}
}

func TestGetBulkUserStatus_TooManyIDs(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userIDs := make([]string, 101)
	for i := range userIDs {
		userIDs[i] = "u"
	}

	c, w := newBulkStatusContext(map[string]interface{}{
		"user_ids": userIDs,
	})
	h.GetBulkUserStatus(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetBulkUserStatus_InvalidBody(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	c, w := newBulkStatusContext("not valid json object at all")
	h.GetBulkUserStatus(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetBulkUserStatus_DBError(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userIDs := []string{"u1"}

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = ANY\(\$1\)`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newBulkStatusContext(map[string]interface{}{
		"user_ids": userIDs,
	})
	h.GetBulkUserStatus(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetBulkUserStatus_WithPrivacyHidden(t *testing.T) {
	h, mock := setupUserStatusHandler(t)

	userIDs := []string{"u1", "u2"}
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = ANY\(\$1\)`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_online", "last_seen_at", "show_status"}).
			AddRow("u1", true, now, true).  // visible
			AddRow("u2", true, now, false)) // hidden

	c, w := newBulkStatusContext(map[string]interface{}{
		"user_ids": userIDs,
	})
	h.GetBulkUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data []UserStatusResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}

	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(resp.Data))
	}

	// u1 should be online with last_seen
	if !resp.Data[0].IsOnline {
		t.Fatal("expected u1 to be online")
	}
	if resp.Data[0].LastSeen == nil {
		t.Fatal("expected u1 to have last_seen")
	}

	// u2 should be offline with nil last_seen (privacy hidden)
	if resp.Data[1].IsOnline {
		t.Fatal("expected u2 to be offline (privacy hidden)")
	}
	if resp.Data[1].LastSeen != nil {
		t.Fatal("expected u2 to have nil last_seen")
	}
}

// setupUserStatusHandlerRedis creates a UserStatusHandler with a mock DB and a
// Redis-backed hub (miniredis) for exercising the Redis-first status path.
func setupUserStatusHandlerRedis(t *testing.T) (*UserStatusHandler, sqlmock.Sqlmock, *redis.Client) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })

	hub := websocket.NewHub(client, nil)
	handler := NewUserStatusHandler(db, hub)
	return handler, mock, client
}

// privacyRowPublic is a sqlmock row set describing a fully public profile.
func privacyRowPublic(userID string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"private_profile", "private_hide_avatar", "private_hide_wall",
		"private_hide_threads", "private_hide_stats", "private_hide_friends",
		"private_hide_gifts", "private_hide_achievements",
	}).AddRow(false, false, false, false, false, false, false, false)
}

// ─── GetUserStatus — Redis-first path ────────────────────────────────────────

func TestGetUserStatus_RedisFirst_Online(t *testing.T) {
	h, mock, client := setupUserStatusHandlerRedis(t)

	userID := "550e8400-e29b-41d4-a716-446655440020"
	ctx := context.Background()
	client.ZAdd(ctx, "presence:online", redis.Z{Score: float64(time.Now().Unix()), Member: userID})

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WillReturnRows(privacyRowPublic(userID))
	mock.ExpectQuery(`SELECT COALESCE\(show_online_status, true\)`).
		WillReturnRows(sqlmock.NewRows([]string{"show"}).AddRow(true))

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if status.UserID != userID {
		t.Fatalf("expected userID %q, got %q", userID, status.UserID)
	}
	if !status.IsOnline {
		t.Fatal("expected is_online = true (Redis-first)")
	}
	if status.LastSeen == nil {
		t.Fatal("expected last_seen from the Redis score")
	}
}

func TestGetUserStatus_RedisFirst_OfflineWithLastSeen(t *testing.T) {
	h, mock, client := setupUserStatusHandlerRedis(t)

	userID := "550e8400-e29b-41d4-a716-446655440021"
	// Scores are unix seconds, so the expected time must be second-truncated.
	stale := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	ctx := context.Background()
	client.ZAdd(ctx, "presence:online", redis.Z{Score: float64(stale.Unix()), Member: userID})

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WillReturnRows(privacyRowPublic(userID))
	mock.ExpectQuery(`SELECT COALESCE\(show_online_status, true\)`).
		WillReturnRows(sqlmock.NewRows([]string{"show"}).AddRow(true))

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if status.IsOnline {
		t.Fatal("expected is_online = false for a stale score")
	}
	if status.LastSeen == nil || !status.LastSeen.Equal(stale) {
		t.Fatalf("expected last_seen %v, got %v", stale, status.LastSeen)
	}
}

func TestGetUserStatus_RedisFirst_PrivacyHidden(t *testing.T) {
	h, mock, client := setupUserStatusHandlerRedis(t)

	userID := "550e8400-e29b-41d4-a716-446655440022"
	ctx := context.Background()
	client.ZAdd(ctx, "presence:online", redis.Z{Score: float64(time.Now().Unix()), Member: userID})

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WillReturnRows(privacyRowPublic(userID))
	mock.ExpectQuery(`SELECT COALESCE\(show_online_status, true\)`).
		WillReturnRows(sqlmock.NewRows([]string{"show"}).AddRow(false))

	c, w := newStatusGETContext(userID)
	h.GetUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var status UserStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if status.IsOnline {
		t.Fatal("expected is_online = false when the status is hidden")
	}
	if status.LastSeen != nil {
		t.Fatal("expected nil last_seen when the status is hidden")
	}
}

// ─── GetBulkUserStatus — Redis-first path ────────────────────────────────────

func TestGetBulkUserStatus_RedisFirst(t *testing.T) {
	h, mock, client := setupUserStatusHandlerRedis(t)
	ctx := context.Background()

	client.ZAdd(ctx, "presence:online", redis.Z{Score: float64(time.Now().Unix()), Member: "u1"})
	stale := time.Now().UTC().Add(-time.Hour)
	client.ZAdd(ctx, "presence:online", redis.Z{Score: float64(stale.Unix()), Member: "u2"})

	// Order inside bulkStatusFromRedis: privacy check per user, then the
	// show_online_status check per fetched user.
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WithArgs("u1").WillReturnRows(privacyRowPublic("u1"))
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WithArgs("u2").WillReturnRows(privacyRowPublic("u2"))
	mock.ExpectQuery(`SELECT COALESCE\(show_online_status, true\)`).
		WithArgs("u1").WillReturnRows(sqlmock.NewRows([]string{"show"}).AddRow(true))
	mock.ExpectQuery(`SELECT COALESCE\(show_online_status, true\)`).
		WithArgs("u2").WillReturnRows(sqlmock.NewRows([]string{"show"}).AddRow(true))

	c, w := newBulkStatusContext(map[string]interface{}{
		"user_ids": []string{"u1", "u2"},
	})
	h.GetBulkUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []UserStatusResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 statuses, got %d", len(resp.Data))
	}
	if !resp.Data[0].IsOnline || resp.Data[0].LastSeen == nil {
		t.Error("u1 should be online with last_seen (Redis-first)")
	}
	if resp.Data[1].IsOnline || resp.Data[1].LastSeen == nil {
		t.Error("u2 should be offline but carry last_seen (Redis-first)")
	}
}

// When a requested user is unknown to the presence store, the whole batch must
// fall back to SQL (the Redis path never returns a partial answer).
func TestGetBulkUserStatus_RedisFirst_FallsBackToSQL(t *testing.T) {
	h, mock, _ := setupUserStatusHandlerRedis(t)

	// Redis has no data for "u1" → bulkStatusFromRedis returns nil.
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WithArgs("u1").WillReturnRows(privacyRowPublic("u1"))
	// Fallback SQL query.
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT u\.id, u\.is_online, u\.last_seen_at, COALESCE\(ps\.show_online_status, true\) as show_status FROM users u LEFT JOIN privacy_settings ps ON ps\.user_id = u\.id WHERE u\.id = ANY\(\$1\)`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_online", "last_seen_at", "show_status"}).
			AddRow("u1", true, now, true))
	// The SQL path re-checks privacy per row.
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\),`).
		WithArgs("u1").WillReturnRows(privacyRowPublic("u1"))

	c, w := newBulkStatusContext(map[string]interface{}{
		"user_ids": []string{"u1"},
	})
	h.GetBulkUserStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	statuses, ok := resp.Data.([]interface{})
	if !ok || len(statuses) != 1 {
		t.Fatalf("expected 1 status from the SQL fallback, got %#v", resp.Data)
	}
}
