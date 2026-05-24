package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
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
