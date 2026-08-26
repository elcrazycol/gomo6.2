package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gomo6/backend/internal/profiles"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// setupFriendsHandler creates a FriendsHandler with a mock DB (redis/hub = nil so
// cache invalidation and websocket pushes are skipped).
func setupFriendsHandler(t *testing.T) (*FriendsHandler, sqlmock.Sqlmock) {
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
	return NewFriendsHandler(db), mock
}

// notificationInsertRow builds the RETURNING row expected by CreateNotification.
func notificationInsertRow(id string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "user_id", "type", "title", "message",
		"related_thread_id", "related_post_id", "related_user_id",
		"related_wall_post_id", "related_wall_comment_id", "related_wall_user_id",
		"related_wall_post_ids", "is_read", "created_at", "group_count", "params",
	}).AddRow(id, "u-receiver", "friend_request", "", "", nil, nil, "u-sender", nil, nil, nil, "[]", false, "2024-01-01T00:00:00Z", 1, []byte("{}"))
}

const (
	friendSender   = "550e8400-e29b-41d4-a716-446655440000"
	friendReceiver = "550e8400-e29b-41d4-a716-446655440001"
)

// ── SendRequest ──────────────────────────────────────────────────────────────

func TestSendRequest_Unauthenticated(t *testing.T) {
	handler, _ := setupFriendsHandler(t)

	c, w := newPOSTContext("/api/v1/friends/request", nil, nil, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_InvalidBody(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newPOSTContext("/api/v1/friends/request", nil, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_ReceiverNotFound(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendReceiver}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_ReceiverQueryError(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnError(errors.New("db down"))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendReceiver}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_ToSelf(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendSender}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_AlreadyFriends(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendReceiver}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_PendingAlreadyExists(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendReceiver}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	// Reverse request lookup → none
	mock.ExpectQuery("SELECT id FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnError(sql.ErrNoRows)
	// Rejected request lookup → none
	mock.ExpectQuery("SELECT id FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'rejected'").
		WillReturnError(sql.ErrNoRows)
	// Insert new request
	mock.ExpectQuery("INSERT INTO friend_requests \\(sender_id, receiver_id, status\\)").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("req-new-1"))
	// Notification: sender username + notification insert
	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("alice"))
	mock.ExpectQuery("INSERT INTO notifications \\(user_id, type, title, message").
		WillReturnRows(notificationInsertRow("notif-1"))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendReceiver}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"pending"`) {
		t.Errorf("expected pending status in body, got: %s", body)
	}
}

func TestSendRequest_RejectedReactivated(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT id FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnError(sql.ErrNoRows)
	// Rejected request found → reactivated instead of inserting
	mock.ExpectQuery("SELECT id FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'rejected'").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("req-rej-1"))
	mock.ExpectExec("UPDATE friend_requests SET status = 'pending'").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("alice"))
	mock.ExpectQuery("INSERT INTO notifications \\(user_id, type, title, message").
		WillReturnRows(notificationInsertRow("notif-2"))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendReceiver}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendRequest_AutoAcceptsReverseRequest(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	// Reverse pending request EXISTS
	mock.ExpectQuery("SELECT id FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("req-rev-1"))
	// acceptFriendRequest: tx, update, insert friendship, commit
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE friend_requests SET status = 'accepted'").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO friendships \\(user1_id, user2_id\\) VALUES \\(\\$1, \\$2\\)").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	// Notification: username of sender for the "принял вашу заявку" message + insert
	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("alice"))
	mock.ExpectQuery("INSERT INTO notifications \\(user_id, type, title, message").
		WithArgs(friendReceiver, "friend_accepted", sqlmock.AnyArg(), sqlmock.AnyArg(), nil, nil, friendSender, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnRows(notificationInsertRow("notif-3"))

	c, w := newPOSTContext("/api/v1/friends/request", map[string]string{"receiver_id": friendReceiver}, claims, nil)
	handler.SendRequest(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 (auto-accept), got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"friends"`) {
		t.Errorf("expected friends status in body, got: %s", body)
	}
}

// ── AcceptRequest ────────────────────────────────────────────────────────────

func TestAcceptRequest_InvalidUUID(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}

	c, w := newPUTContext("/api/v1/friends/request/not-a-uuid/accept", nil, claims, map[string]string{"id": "not-a-uuid"})
	handler.AcceptRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestAcceptRequest_NotFound(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT id, sender_id, receiver_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnError(sql.ErrNoRows)

	c, w := newPUTContext("/api/v1/friends/request/"+reqID+"/accept", nil, claims, map[string]string{"id": reqID})
	handler.AcceptRequest(c)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestAcceptRequest_ForbiddenForSender(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT id, sender_id, receiver_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "sender_id", "receiver_id", "status"}).
			AddRow(reqID, friendSender, friendReceiver, "pending"))

	c, w := newPUTContext("/api/v1/friends/request/"+reqID+"/accept", nil, claims, map[string]string{"id": reqID})
	handler.AcceptRequest(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestAcceptRequest_NotPending(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT id, sender_id, receiver_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "sender_id", "receiver_id", "status"}).
			AddRow(reqID, friendSender, friendReceiver, "accepted"))

	c, w := newPUTContext("/api/v1/friends/request/"+reqID+"/accept", nil, claims, map[string]string{"id": reqID})
	handler.AcceptRequest(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestAcceptRequest_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT id, sender_id, receiver_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "sender_id", "receiver_id", "status"}).
			AddRow(reqID, friendSender, friendReceiver, "pending"))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE friend_requests SET status = 'accepted'").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO friendships \\(user1_id, user2_id\\) VALUES \\(\\$1, \\$2\\)").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("bob"))
	mock.ExpectQuery("INSERT INTO notifications \\(user_id, type, title, message").
		WithArgs(friendSender, "friend_accepted", sqlmock.AnyArg(), sqlmock.AnyArg(), nil, nil, friendReceiver, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"bob"}`).
		WillReturnRows(notificationInsertRow("notif-4"))

	c, w := newPUTContext("/api/v1/friends/request/"+reqID+"/accept", nil, claims, map[string]string{"id": reqID})
	handler.AcceptRequest(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"friends"`) {
		t.Errorf("expected friends status in body, got: %s", body)
	}
}

// ── RejectRequest ────────────────────────────────────────────────────────────

func TestRejectRequest_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT receiver_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"receiver_id", "status"}).AddRow(friendReceiver, "pending"))
	mock.ExpectExec("UPDATE friend_requests SET status = 'rejected'").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newPUTContext("/api/v1/friends/request/"+reqID+"/reject", nil, claims, map[string]string{"id": reqID})
	handler.RejectRequest(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"rejected"`) {
		t.Errorf("expected rejected status in body, got: %s", body)
	}
}

func TestRejectRequest_ForbiddenForSender(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT receiver_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"receiver_id", "status"}).AddRow(friendReceiver, "pending"))

	c, w := newPUTContext("/api/v1/friends/request/"+reqID+"/reject", nil, claims, map[string]string{"id": reqID})
	handler.RejectRequest(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d, body: %s", w.Code, w.Body.String())
	}
}

// ── CancelRequest ────────────────────────────────────────────────────────────

func TestCancelRequest_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT sender_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"sender_id", "status"}).AddRow(friendSender, "pending"))
	mock.ExpectExec("UPDATE friend_requests SET status = 'cancelled'").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newDELETEPContext("/api/v1/friends/request/"+reqID, nil, map[string]string{"id": reqID})
	c.Set("claims", claims)
	handler.CancelRequest(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"cancelled"`) {
		t.Errorf("expected cancelled status in body, got: %s", body)
	}
}

func TestCancelRequest_ForbiddenForReceiver(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}
	reqID := "550e8400-e29b-41d4-a716-446655449999"

	mock.ExpectQuery("SELECT sender_id, status FROM friend_requests WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"sender_id", "status"}).AddRow(friendSender, "pending"))

	c, w := newDELETEPContext("/api/v1/friends/request/"+reqID, nil, map[string]string{"id": reqID})
	c.Set("claims", claims)
	handler.CancelRequest(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d, body: %s", w.Code, w.Body.String())
	}
}

// ── RemoveFriend ─────────────────────────────────────────────────────────────

func TestRemoveFriend_InvalidUUID(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newDELETEPContext("/api/v1/friends/not-a-uuid", nil, map[string]string{"userId": "not-a-uuid"})
	c.Set("claims", claims)
	handler.RemoveFriend(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestRemoveFriend_Self(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newDELETEPContext("/api/v1/friends/"+friendSender, nil, map[string]string{"userId": friendSender})
	c.Set("claims", claims)
	handler.RemoveFriend(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestRemoveFriend_NotFriends(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectExec("DELETE FROM friendships").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newDELETEPContext("/api/v1/friends/"+friendReceiver, nil, map[string]string{"userId": friendReceiver})
	c.Set("claims", claims)
	handler.RemoveFriend(c)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestRemoveFriend_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectExec("DELETE FROM friendships").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE friend_requests \\s*SET status = 'rejected'").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newDELETEPContext("/api/v1/friends/"+friendReceiver, nil, map[string]string{"userId": friendReceiver})
	c.Set("claims", claims)
	handler.RemoveFriend(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"removed"`) {
		t.Errorf("expected removed status in body, got: %s", body)
	}
}

// ── GetFriends ───────────────────────────────────────────────────────────────

func TestGetFriends_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	// GetPrivacySettings returns no row → defaults (public profile, no filtering)
	mock.ExpectQuery("SELECT COALESCE\\(private_profile, false\\).*FROM privacy_settings").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT \\s*f\\.id AS friendship_id").WillReturnRows(
		sqlmock.NewRows([]string{"friendship_id", "friend_id", "username", "display_name", "nickname_emoji_id", "avatar_url", "is_online"}).
			AddRow("fs-1", friendReceiver, "bob", "Bob", nil, "http://a/b.png", true),
	)

	c, w := newGETContextWithClaims("/api/v1/friends", nil, claims)
	handler.GetFriends(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"username":"bob"`) {
		t.Errorf("expected friend bob in body, got: %s", body)
	}
}

func TestGetFriends_PrivateProfileHidesList(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	// Viewing ANOTHER user's friends: private profile with private_hide_friends=true
	// and the viewer is not a friend → empty list, no friend query.
	mock.ExpectQuery("SELECT COALESCE\\(private_profile, false\\).*FROM privacy_settings").
		WillReturnRows(sqlmock.NewRows([]string{
			"private_profile", "private_hide_avatar", "private_hide_wall",
			"private_hide_threads", "private_hide_stats", "private_hide_friends",
			"private_hide_gifts", "private_hide_achievements",
		}).AddRow(true, false, false, false, false, true, false, false))
	// Not a mutual friend → filter applies
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newGETContextWithClaims("/api/v1/friends", map[string]string{"user_id": friendReceiver}, claims)
	handler.GetFriends(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"data":[]`) {
		t.Errorf("expected empty friends list, got: %s", body)
	}
}

func TestGetFriends_InvalidUserIDParam(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newGETContextWithClaims("/api/v1/friends", map[string]string{"user_id": "not-a-uuid"}, claims)
	handler.GetFriends(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

// ── GetRequests ──────────────────────────────────────────────────────────────

func TestGetRequests_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}

	mock.ExpectQuery("SELECT \\s*fr\\.id,\\s*fr\\.sender_id").WillReturnRows(
		sqlmock.NewRows([]string{"id", "sender_id", "receiver_id", "status", "created_at",
			"username", "avatar_url", "display_name", "nickname_emoji_id"}).
			AddRow("req-1", friendSender, friendReceiver, "pending", time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), "alice", nil, "Alice", nil),
	)

	c, w := newGETContextWithClaims("/api/v1/friends/requests", nil, claims)
	handler.GetRequests(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"sender_username":"alice"`) {
		t.Errorf("expected sender alice in body, got: %s", body)
	}
}

// ── GetFriendStatus ──────────────────────────────────────────────────────────

func TestGetFriendStatus_Self(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendSender, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendSender})
	handler.GetFriendStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"self"`) {
		t.Errorf("expected self status, got: %s", body)
	}
}

func TestGetFriendStatus_InvalidUUID(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newGETContextWithClaims("/api/v1/friends/status/not-a-uuid", nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: "not-a-uuid"})
	handler.GetFriendStatus(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetFriendStatus_Friends(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendReceiver, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendReceiver})
	handler.GetFriendStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"friends"`) {
		t.Errorf("expected friends status, got: %s", body)
	}
}

func TestGetFriendStatus_PendingSent(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendReceiver, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendReceiver})
	handler.GetFriendStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"pending_sent"`) {
		t.Errorf("expected pending_sent status, got: %s", body)
	}
}

func TestGetFriendStatus_PendingReceived(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}

	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT id FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("req-in-1"))

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendSender, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendSender})
	handler.GetFriendStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"pending_received"`) || !strings.Contains(body, `"request_id":"req-in-1"`) {
		t.Errorf("expected pending_received with request_id, got: %s", body)
	}
}

func TestGetFriendStatus_None(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friend_requests\\s*WHERE sender_id = \\$1 AND receiver_id = \\$2 AND status = 'pending'").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendReceiver, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendReceiver})
	handler.GetFriendStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"none"`) {
		t.Errorf("expected none status, got: %s", body)
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

func TestGetUsernameFromDB_Found(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("carol"))

	got := profiles.UsernameByID(db, "user-1")
	if got != "carol" {
		t.Errorf("expected carol, got %q", got)
	}
}

func TestGetUsernameFromDB_ErrorReturnsUnknown(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnError(errors.New("db down"))

	got := profiles.UsernameByID(db, "user-1")
	if got != "unknown" {
		t.Errorf("expected unknown, got %q", got)
	}
}

func TestInvalidateFriendCaches_NilRedisNoop(t *testing.T) {
	// Must not panic and must not block when redis is nil
	invalidateFriendCaches(nil, friendSender, friendReceiver)
}

func TestInvalidateFriendCaches_DeletesMatchingKeys(t *testing.T) {
	// Privacy-critical: after unfriending, cached private wall content keyed by
	// the ex-friend's viewer id must be purged, plus all friend-list cache keys.
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	ctx := context.Background()
	keys := []string{
		"data:/api/v1/friends",
		"data:/api/v1/friends?limit=50",
		"data:/api/v1/profile_wall_posts?user_id=u1&viewer=" + friendSender,
		"data:/api/v1/profile_wall_posts?user_id=u2&viewer=" + friendReceiver,
		"data:/api/v1/threads", // unrelated — must survive
	}
	for _, k := range keys {
		if err := client.Set(ctx, k, "cached", 0).Err(); err != nil {
			t.Fatalf("seed key %s: %v", k, err)
		}
	}

	invalidateFriendCaches(client, friendSender, friendReceiver)

	for _, k := range keys[:4] {
		if exists := mr.Exists(k); exists {
			t.Errorf("expected key %q to be deleted", k)
		}
	}
	if !mr.Exists("data:/api/v1/threads") {
		t.Error("unrelated key must not be deleted")
	}
}

func TestInvalidateFriendCaches_ScanErrorIsNonFatal(t *testing.T) {
	// A broken redis client must not hang or crash the caller.
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"}) // closed port
	invalidateFriendCaches(client, friendSender, friendReceiver)
}
