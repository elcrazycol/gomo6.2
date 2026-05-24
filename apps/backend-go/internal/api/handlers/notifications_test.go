package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ──────────────────────────── GetNotifications ────────────────────────────

func TestGetNotifications_Success(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/rest/v1/notifications", nil)
	c.Set("claims", claims)

	rows := sqlmock.NewRows([]string{"id", "user_id", "type", "title", "message", "related_thread_id", "related_post_id", "is_read", "created_at"}).
		AddRow("n1", "u1", "like", "New like", "Someone liked your post", nil, nil, false, time.Now()).
		AddRow("n2", "u1", "reply", "New reply", "Someone replied to your thread", "t1", nil, true, time.Now())

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("u1", 50, 0).
		WillReturnRows(rows)

	handler.GetNotifications(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
	if resp.Count == nil || *resp.Count != 2 {
		t.Fatalf("expected count 2, got %v", resp.Count)
	}
}

func TestGetNotifications_WithPagination(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/rest/v1/notifications", map[string]string{"limit": "10", "offset": "5"})
	c.Set("claims", claims)

	rows := sqlmock.NewRows([]string{"id", "user_id", "type", "title", "message", "related_thread_id", "related_post_id", "is_read", "created_at"}).
		AddRow("n1", "u1", "like", "New like", "Someone liked your post", nil, nil, false, time.Now())

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("u1", 10, 5).
		WillReturnRows(rows)

	handler.GetNotifications(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestGetNotifications_Unauthenticated(t *testing.T) {
	handler, _ := setupNotificationsHandler(t)
	c, w := newGETContext("/rest/v1/notifications", nil)

	handler.GetNotifications(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGetNotifications_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/rest/v1/notifications", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*`).
		WithArgs("u1", 50, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetNotifications(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestGetNotifications_ScanError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/rest/v1/notifications", nil)
	c.Set("claims", claims)

	rows := sqlmock.NewRows([]string{"id", "user_id", "type", "title", "message", "related_thread_id", "related_post_id", "is_read", "created_at"}).
		AddRow("n1", "u1", "like", "New like", "Message", nil, nil, "not-a-bool", time.Now())

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*`).
		WithArgs("u1", 50, 0).
		WillReturnRows(rows)

	handler.GetNotifications(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── MarkAsRead ────────────────────────────

func TestMarkAsRead_Success(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	notifID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/notifications/"+notifID+"/read", nil, claims, map[string]string{"id": notifID})

	// Multi-line query: "UPDATE notifications \n SET is_read = true \n WHERE id = $1 AND user_id = $2"
	mock.ExpectExec(`UPDATE notifications.*SET is_read = true.*WHERE id = \$1 AND user_id = \$2`).
		WithArgs(notifID, "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.MarkAsRead(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkAsRead_InvalidUUID(t *testing.T) {
	handler, _ := setupNotificationsHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/notifications/bad-id/read", nil, claims, map[string]string{"id": "bad-id"})

	handler.MarkAsRead(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestMarkAsRead_Unauthenticated(t *testing.T) {
	handler, _ := setupNotificationsHandler(t)
	notifID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPOSTContext("/rest/v1/notifications/"+notifID+"/read", nil, nil, map[string]string{"id": notifID})

	handler.MarkAsRead(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMarkAsRead_NotFound(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	notifID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/notifications/"+notifID+"/read", nil, claims, map[string]string{"id": notifID})

	mock.ExpectExec(`UPDATE notifications.*SET is_read = true.*WHERE id = \$1 AND user_id = \$2`).
		WithArgs(notifID, "u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.MarkAsRead(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestMarkAsRead_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	notifID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/notifications/"+notifID+"/read", nil, claims, map[string]string{"id": notifID})

	mock.ExpectExec(`UPDATE notifications.*SET is_read = true.*WHERE id = \$1 AND user_id = \$2`).
		WithArgs(notifID, "u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.MarkAsRead(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── MarkAllAsRead ────────────────────────────

func TestMarkAllAsRead_Success(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/notifications/read-all", nil, claims, nil)

	mock.ExpectExec(`UPDATE notifications SET is_read = true WHERE user_id = \$1 AND is_read = false`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(5, 5))

	handler.MarkAllAsRead(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkAllAsRead_Unauthenticated(t *testing.T) {
	handler, _ := setupNotificationsHandler(t)
	c, w := newPOSTContext("/rest/v1/notifications/read-all", nil, nil, nil)

	handler.MarkAllAsRead(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMarkAllAsRead_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/notifications/read-all", nil, claims, nil)

	mock.ExpectExec(`UPDATE notifications SET is_read = true WHERE user_id = \$1 AND is_read = false`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.MarkAllAsRead(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── GetUnreadCount ────────────────────────────

func TestGetUnreadCount_Success(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/rest/v1/notifications/unread-count", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM notifications WHERE user_id = \$1 AND is_read = false`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))

	handler.GetUnreadCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetUnreadCount_Unauthenticated(t *testing.T) {
	handler, _ := setupNotificationsHandler(t)
	c, w := newGETContext("/rest/v1/notifications/unread-count", nil)

	handler.GetUnreadCount(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGetUnreadCount_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/rest/v1/notifications/unread-count", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM notifications WHERE user_id = \$1 AND is_read = false`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetUnreadCount(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
