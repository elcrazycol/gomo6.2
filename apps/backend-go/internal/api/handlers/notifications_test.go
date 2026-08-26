package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/gomo6/backend/internal/notifications"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// notificationColumns is the shared column list for every notification row
// returned by SELECT/RETURNING, including the structured `params` column.
var notificationColumns = []string{
	"id", "user_id", "type", "title", "message",
	"related_thread_id", "related_post_id", "related_user_id",
	"related_wall_post_id", "related_wall_comment_id", "related_wall_user_id",
	"related_wall_post_ids", "is_read", "created_at", "group_count", "params",
}

// ──────────────────────────── GetNotifications ────────────────────────────

func TestGetNotifications_Success(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/notifications", nil)
	c.Set("claims", claims)

	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n1", "u1", "like", "New like", "Someone liked your post", nil, nil, nil, nil, nil, nil, "[]", false, time.Now(), 1, []byte("{}")).
		AddRow("n2", "u1", "reply", "New reply", "Someone replied to your thread", "t1", nil, nil, nil, nil, nil, "[]", true, time.Now(), 1, []byte("{}"))

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("u1", 51, 0).
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
	c, w := newGETContext("/api/v1/notifications", map[string]string{"limit": "10", "offset": "5"})
	c.Set("claims", claims)

	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n1", "u1", "like", "New like", "Someone liked your post", nil, nil, nil, nil, nil, nil, "[]", false, time.Now(), 1, []byte("{}"))

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("u1", 11, 5).
		WillReturnRows(rows)

	handler.GetNotifications(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestGetNotifications_Unauthenticated(t *testing.T) {
	handler, _ := setupNotificationsHandler(t)
	c, w := newGETContext("/api/v1/notifications", nil)

	handler.GetNotifications(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGetNotifications_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/notifications", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*`).
		WithArgs("u1", 51, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetNotifications(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestGetNotifications_ScanError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/notifications", nil)
	c.Set("claims", claims)

	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n1", "u1", "like", "New like", "Message", nil, nil, nil, nil, nil, nil, "[]", "not-a-bool", time.Now(), 1, []byte("{}"))

	mock.ExpectQuery(`SELECT id, user_id, type, title, message.*FROM notifications.*WHERE user_id = \$1.*`).
		WithArgs("u1", 51, 0).
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
	c, w := newPOSTContext("/api/v1/notifications/"+notifID+"/read", nil, claims, map[string]string{"id": notifID})

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
	c, w := newPOSTContext("/api/v1/notifications/bad-id/read", nil, claims, map[string]string{"id": "bad-id"})

	handler.MarkAsRead(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestMarkAsRead_Unauthenticated(t *testing.T) {
	handler, _ := setupNotificationsHandler(t)
	notifID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPOSTContext("/api/v1/notifications/"+notifID+"/read", nil, nil, map[string]string{"id": notifID})

	handler.MarkAsRead(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMarkAsRead_NotFound(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	notifID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/api/v1/notifications/"+notifID+"/read", nil, claims, map[string]string{"id": notifID})

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
	c, w := newPOSTContext("/api/v1/notifications/"+notifID+"/read", nil, claims, map[string]string{"id": notifID})

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
	c, w := newPOSTContext("/api/v1/notifications/read-all", nil, claims, nil)

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
	c, w := newPOSTContext("/api/v1/notifications/read-all", nil, nil, nil)

	handler.MarkAllAsRead(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMarkAllAsRead_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/api/v1/notifications/read-all", nil, claims, nil)

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
	c, w := newGETContext("/api/v1/notifications/unread-count", nil)
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
	c, w := newGETContext("/api/v1/notifications/unread-count", nil)

	handler.GetUnreadCount(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGetUnreadCount_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/notifications/unread-count", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM notifications WHERE user_id = \$1 AND is_read = false`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetUnreadCount(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── CreateNotification ────────────────────────────

func TestCreateNotification_Success(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	now := time.Now()
	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n1", "u1", "like", "", "", "thread1", "post1", nil, nil, nil, nil, "[]", false, now, 1, []byte(`{"actor":"alice"}`))

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*created_at`).
		WithArgs("u1", "like", "", "", "thread1", "post1", nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnRows(rows)

	params := &models.NotificationParams{Actor: "alice"}
	notif, err := notifications.CreateNotification(handler.db, handler.redis, handler.hub, "u1", "like", "", params, strPtr("thread1"), strPtr("post1"), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
	if notif.ID != "n1" {
		t.Fatalf("expected ID n1, got %s", notif.ID)
	}
	if notif.Type != "like" {
		t.Fatalf("expected type 'like', got %s", notif.Type)
	}
}

func TestCreateNotification_SuccessNoRelated(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	now := time.Now()
	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n2", "u1", "reply", "", "Someone replied", nil, nil, nil, nil, nil, nil, "[]", false, now, 1, []byte(`{"actor":"alice"}`))

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "reply", "", "Someone replied", nil, nil, nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnRows(rows)

	params := &models.NotificationParams{Actor: "alice"}
	notif, err := notifications.CreateNotification(handler.db, handler.redis, handler.hub, "u1", "reply", "Someone replied", params, nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
	if notif.Type != "reply" {
		t.Fatalf("expected type 'reply', got %s", notif.Type)
	}
}

func TestCreateWallNotification_Success(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	now := time.Now()
	rows := sqlmock.NewRows(notificationColumns).
		AddRow("nw1", "u1", "wall_post_like", "", "", nil, nil, "actor1", "wp1", "wc1", "wu1", `["wp1"]`, false, now, 1, []byte(`{"actor":"actor1"}`))

	// Grouping lookup: no existing wall_post_like from actor1 yet → fresh insert.
	mock.ExpectQuery(`SELECT id, group_count, related_wall_post_id, related_wall_post_ids.*FROM notifications.*LIMIT 1`).
		WithArgs("u1", "wall_post_like", "actor1", 1).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "wall_post_like", "", "", nil, nil, "actor1", "wp1", "wc1", "wu1", `["wp1"]`, false, sqlmock.AnyArg(), 1, `{"actor":"actor1"}`).
		WillReturnRows(rows)

	params := &models.NotificationParams{Actor: "actor1"}
	notif, err := notifications.CreateWallNotification(handler.db, handler.redis, handler.hub, "u1", "wall_post_like", "", params, strPtr("wp1"), strPtr("wc1"), strPtr("wu1"), strPtr("actor1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
	if notif.RelatedWallPostID == nil || *notif.RelatedWallPostID != "wp1" {
		t.Fatalf("expected related_wall_post_id wp1, got %v", notif.RelatedWallPostID)
	}
	if notif.RelatedWallCommentID == nil || *notif.RelatedWallCommentID != "wc1" {
		t.Fatalf("expected related_wall_comment_id wc1, got %v", notif.RelatedWallCommentID)
	}
	if notif.RelatedWallUserID == nil || *notif.RelatedWallUserID != "wu1" {
		t.Fatalf("expected related_wall_user_id wu1, got %v", notif.RelatedWallUserID)
	}
	if notif.RelatedUserID == nil || *notif.RelatedUserID != "actor1" {
		t.Fatalf("expected related_user_id actor1, got %v", notif.RelatedUserID)
	}
}

func TestCreateWallNotification_MergesIntoGroup(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	now := time.Now()

	// Grouping lookup finds an existing burst of 1 like from actor1.
	mock.ExpectQuery(`SELECT id, group_count, related_wall_post_id, related_wall_post_ids.*FROM notifications.*LIMIT 1`).
		WithArgs("u1", "wall_post_like", "actor1", 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "group_count", "related_wall_post_id", "related_wall_post_ids",
		}).AddRow("nw-existing", 1, "wp-old", `["wp-old"]`))

	// Merge UPDATE increments the count, records the structured params and bumps created_at.
	mock.ExpectQuery(`UPDATE notifications.*SET group_count = \$1, is_read = false.*RETURNING created_at`).
		WithArgs(2, "wp-new", `["wp-old","wp-new"]`, `{"actor":"actor1","count":2}`, "nw-existing").
		WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(now))

	params := &models.NotificationParams{Actor: "actor1"}
	notif, err := notifications.CreateWallNotification(handler.db, handler.redis, handler.hub, "u1", "wall_post_like", "", params, strPtr("wp-new"), nil, strPtr("wu1"), strPtr("actor1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
	if notif.ID != "nw-existing" {
		t.Fatalf("expected merged id nw-existing, got %s", notif.ID)
	}
	if notif.GroupCount != 2 {
		t.Fatalf("expected group_count 2, got %d", notif.GroupCount)
	}
	if notif.Title != "" {
		t.Fatalf("expected empty grouped title, got: %s", notif.Title)
	}
	if notif.RelatedWallPostID == nil || *notif.RelatedWallPostID != "wp-new" {
		t.Fatalf("expected related_wall_post_id wp-new, got %v", notif.RelatedWallPostID)
	}
	if len(notif.RelatedWallPostIDs) != 2 {
		t.Fatalf("expected 2 related wall post ids, got %v", notif.RelatedWallPostIDs)
	}

	var mergedParams models.NotificationParams
	if err := json.Unmarshal(notif.Params, &mergedParams); err != nil {
		t.Fatalf("failed to unmarshal params: %v", err)
	}
	if mergedParams.Actor != "actor1" {
		t.Fatalf("expected params actor actor1, got %s", mergedParams.Actor)
	}
	if mergedParams.Count != 2 {
		t.Fatalf("expected params count 2, got %d", mergedParams.Count)
	}
}

func TestCreateNotification_DBError(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "like", "", "Msg", nil, nil, nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnError(sqlmock.ErrCancelled)

	params := &models.NotificationParams{Actor: "alice"}
	notif, err := notifications.CreateNotification(handler.db, handler.redis, handler.hub, "u1", "like", "Msg", params, nil, nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if notif != nil {
		t.Fatalf("expected nil notification, got %v", notif)
	}
}

// ──────────────────────────── CreateNotification (nil guards) ─────────────────

func TestCreateNotification_NilDB(t *testing.T) {
	notif, err := notifications.CreateNotification(nil, nil, nil, "u1", "like", "Msg", nil, nil, nil, nil)
	if err == nil {
		t.Fatal("expected error for nil db, got nil")
	}
	if notif != nil {
		t.Fatalf("expected nil notification, got %v", notif)
	}
}

func TestCreateNotification_NilRedisHub(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	now := time.Now()
	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n1", "u1", "like", "", "", nil, nil, nil, nil, nil, nil, "[]", false, now, 1, []byte(`{"actor":"alice"}`))

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "like", "", "", nil, nil, nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnRows(rows)

	// redis=nil, hub=nil should work — just skips cache invalidation and WS publish
	params := &models.NotificationParams{Actor: "alice"}
	notif, err := notifications.CreateNotification(handler.db, nil, nil, "u1", "like", "", params, nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
}

func TestCreateNotification_DBErrorPackage(t *testing.T) {
	handler, mock := setupNotificationsHandler(t)

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "like", "", "Msg", nil, nil, nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnError(sqlmock.ErrCancelled)

	params := &models.NotificationParams{Actor: "alice"}
	notif, err := notifications.CreateNotification(handler.db, handler.redis, handler.hub, "u1", "like", "Msg", params, nil, nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if notif != nil {
		t.Fatalf("expected nil notification, got %v", notif)
	}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func strPtr(s string) *string {
	return &s
}
