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
	"github.com/gomo6/backend/internal/notifications"
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
	h := NewFriendsHandler(db)
	// Wire the notification service with nil redis/hub so the notification
	// INSERT still runs (asserted below) while cache invalidation and WS pushes
	// are skipped.
	h.SetNotifier(notifications.New(db, nil, nil, nil))
	return h, mock
}

// notificationInsertRow builds the RETURNING row expected by CreateNotification.
func notificationInsertRow(id string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "user_id", "type", "title", "message",
		"related_thread_id", "related_post_id", "related_user_id",
		"related_wall_post_id", "related_wall_comment_id", "related_wall_user_id",
		"related_wall_post_ids", "is_read", "created_at", "group_count", "params",
	}).AddRow(id, "u-receiver", "new_subscriber", "", "", nil, nil, "u-sender", nil, nil, nil, "[]", false, "2024-01-01T00:00:00Z", 1, []byte("{}"))
}

const (
	friendSender   = "550e8400-e29b-41d4-a716-446655440000"
	friendReceiver = "550e8400-e29b-41d4-a716-446655440001"
)

// ── Subscribe ────────────────────────────────────────────────────────────────

func TestSubscribe_Unauthenticated(t *testing.T) {
	handler, _ := setupFriendsHandler(t)

	c, w := newPOSTContext("/api/v1/friends/subscribe", nil, nil, nil)
	handler.Subscribe(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSubscribe_InvalidBody(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newPOSTContext("/api/v1/friends/subscribe", nil, claims, nil)
	handler.Subscribe(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSubscribe_TargetNotFound(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/friends/subscribe", map[string]string{"user_id": friendReceiver}, claims, nil)
	handler.Subscribe(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSubscribe_ToSelf(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/friends/subscribe", map[string]string{"user_id": friendSender}, claims, nil)
	handler.Subscribe(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSubscribe_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO subscriptions").
		WillReturnResult(sqlmock.NewResult(1, 1))
	// Not mutual → no friendship materialized.
	mock.ExpectQuery("FROM subscriptions WHERE subscriber_id").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("alice"))
	mock.ExpectQuery("INSERT INTO notifications \\(user_id, type, title, message").
		WillReturnRows(notificationInsertRow("notif-1"))

	c, w := newPOSTContext("/api/v1/friends/subscribe", map[string]string{"user_id": friendReceiver}, claims, nil)
	handler.Subscribe(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"subscribed"`) {
		t.Errorf("expected subscribed status in body, got: %s", body)
	}
}

func TestSubscribe_MutualBecomesFriends(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO subscriptions").
		WillReturnResult(sqlmock.NewResult(1, 1))
	// Target already follows the subscriber → mutual.
	mock.ExpectQuery("FROM subscriptions WHERE subscriber_id").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("INSERT INTO friendships").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("fs-1"))
	mock.ExpectCommit()
	mock.ExpectQuery("SELECT username FROM profiles WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("alice"))
	mock.ExpectQuery("INSERT INTO notifications \\(user_id, type, title, message").
		WillReturnRows(notificationInsertRow("notif-2"))
	mock.ExpectQuery("INSERT INTO notifications \\(user_id, type, title, message").
		WillReturnRows(notificationInsertRow("notif-3"))

	c, w := newPOSTContext("/api/v1/friends/subscribe", map[string]string{"user_id": friendReceiver}, claims, nil)
	handler.Subscribe(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"status":"friends"`) || !strings.Contains(body, `"became_friends":true`) {
		t.Errorf("expected friends/became_friends in body, got: %s", body)
	}
}

func TestSubscribe_AlreadySubscribedIsIdempotent(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM users WHERE id = \\$1\\)").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectBegin()
	// ON CONFLICT DO NOTHING → 0 rows affected.
	mock.ExpectExec("INSERT INTO subscriptions").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM subscriptions WHERE subscriber_id").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/friends/subscribe", map[string]string{"user_id": friendReceiver}, claims, nil)
	handler.Subscribe(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"status":"subscribed"`) {
		t.Errorf("expected subscribed status in body, got: %s", body)
	}
}

// ── Unsubscribe ──────────────────────────────────────────────────────────────

func TestUnsubscribe_InvalidUUID(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newDELETEPContext("/api/v1/friends/subscribe/not-a-uuid", nil, map[string]string{"userId": "not-a-uuid"})
	c.Set("claims", claims)
	handler.Unsubscribe(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUnsubscribe_Self(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newDELETEPContext("/api/v1/friends/subscribe/"+friendSender, nil, map[string]string{"userId": friendSender})
	c.Set("claims", claims)
	handler.Unsubscribe(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUnsubscribe_NotSubscribed(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM subscriptions").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM friendships").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	c, w := newDELETEPContext("/api/v1/friends/subscribe/"+friendReceiver, nil, map[string]string{"userId": friendReceiver})
	c.Set("claims", claims)
	handler.Unsubscribe(c)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUnsubscribe_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM subscriptions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM friendships").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newDELETEPContext("/api/v1/friends/subscribe/"+friendReceiver, nil, map[string]string{"userId": friendReceiver})
	c.Set("claims", claims)
	handler.Unsubscribe(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"status":"unsubscribed"`) || !strings.Contains(body, `"was_friend":true`) {
		t.Errorf("expected unsubscribed/was_friend in body, got: %s", body)
	}
}

func TestUnsubscribe_UnfollowsWithoutFriendship(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM subscriptions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM friendships").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	c, w := newDELETEPContext("/api/v1/friends/subscribe/"+friendReceiver, nil, map[string]string{"userId": friendReceiver})
	c.Set("claims", claims)
	handler.Unsubscribe(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"was_friend":false`) {
		t.Errorf("expected was_friend:false in body, got: %s", body)
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
		sqlmock.NewRows([]string{"friendship_id", "friend_id", "username", "public_id", "display_name", "nickname_emoji_id", "avatar_url", "is_online"}).
			AddRow("fs-1", friendReceiver, "bob", 42, "Bob", nil, "http://a/b.png", true),
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

	mock.ExpectQuery("SELECT COALESCE\\(private_profile, false\\).*FROM privacy_settings").
		WillReturnRows(sqlmock.NewRows([]string{
			"private_profile", "private_hide_avatar", "private_hide_wall",
			"private_hide_threads", "private_hide_stats", "private_hide_friends",
			"private_hide_gifts", "private_hide_achievements",
		}).AddRow(true, false, false, false, false, true, false, false))
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

// ── GetSubscribers / GetSubscriptions ────────────────────────────────────────

func TestGetSubscribers_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendReceiver}

	mock.ExpectQuery("SELECT COALESCE\\(private_profile, false\\).*FROM privacy_settings").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("JOIN profiles p ON p.id = s.subscriber_id").WillReturnRows(
		sqlmock.NewRows([]string{"user_id", "username", "public_id", "display_name", "nickname_emoji_id", "avatar_url", "is_online", "is_friend", "created_at"}).
			AddRow(friendSender, "alice", 10, "Alice", nil, nil, false, true, time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)),
	)

	c, w := newGETContextWithClaims("/api/v1/friends/subscribers", nil, claims)
	handler.GetSubscribers(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"username":"alice"`) || !strings.Contains(body, `"is_friend":true`) {
		t.Errorf("expected subscriber alice with is_friend in body, got: %s", body)
	}
}

func TestGetSubscribers_PrivateProfileHidesList(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT COALESCE\\(private_profile, false\\).*FROM privacy_settings").
		WillReturnRows(sqlmock.NewRows([]string{
			"private_profile", "private_hide_avatar", "private_hide_wall",
			"private_hide_threads", "private_hide_stats", "private_hide_friends",
			"private_hide_gifts", "private_hide_achievements",
		}).AddRow(true, false, false, false, false, true, false, false))
	mock.ExpectQuery("SELECT EXISTS\\(\\s*SELECT 1 FROM friendships").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newGETContextWithClaims("/api/v1/friends/subscribers", map[string]string{"user_id": friendReceiver}, claims)
	handler.GetSubscribers(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"data":[]`) {
		t.Errorf("expected empty subscribers list, got: %s", body)
	}
}

func TestGetSubscribers_InvalidUserIDParam(t *testing.T) {
	handler, _ := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	c, w := newGETContextWithClaims("/api/v1/friends/subscribers", map[string]string{"user_id": "not-a-uuid"}, claims)
	handler.GetSubscribers(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetSubscriptions_Success(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery("SELECT COALESCE\\(private_profile, false\\).*FROM privacy_settings").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("JOIN profiles p ON p.id = s.target_id").WillReturnRows(
		sqlmock.NewRows([]string{"user_id", "username", "public_id", "display_name", "nickname_emoji_id", "avatar_url", "is_online", "is_friend", "created_at"}).
			AddRow(friendReceiver, "bob", 42, "Bob", nil, nil, true, false, time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)),
	)

	c, w := newGETContextWithClaims("/api/v1/friends/subscriptions", nil, claims)
	handler.GetSubscriptions(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"username":"bob"`) || !strings.Contains(body, `"is_friend":false`) {
		t.Errorf("expected subscription bob in body, got: %s", body)
	}
}

// ── GetFriendStatus ──────────────────────────────────────────────────────────

const friendStatusQueryPat = "SELECT\\s+EXISTS\\(\\s+SELECT 1 FROM friendships"

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

	mock.ExpectQuery(friendStatusQueryPat).
		WillReturnRows(sqlmock.NewRows([]string{"is_friend", "i_follow", "they_follow"}).AddRow(true, true, true))

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

func TestGetFriendStatus_Subscribed(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery(friendStatusQueryPat).
		WillReturnRows(sqlmock.NewRows([]string{"is_friend", "i_follow", "they_follow"}).AddRow(false, true, false))

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendReceiver, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendReceiver})
	handler.GetFriendStatus(c)

	body := w.Body.String()
	if !strings.Contains(body, `"status":"subscribed"`) || !strings.Contains(body, `"follows_you":false`) {
		t.Errorf("expected subscribed status, got: %s", body)
	}
}

func TestGetFriendStatus_NoneButFollowsYou(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery(friendStatusQueryPat).
		WillReturnRows(sqlmock.NewRows([]string{"is_friend", "i_follow", "they_follow"}).AddRow(false, false, true))

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendReceiver, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendReceiver})
	handler.GetFriendStatus(c)

	body := w.Body.String()
	if !strings.Contains(body, `"status":"none"`) || !strings.Contains(body, `"follows_you":true`) {
		t.Errorf("expected none/follows_you status, got: %s", body)
	}
}

func TestGetFriendStatus_None(t *testing.T) {
	handler, mock := setupFriendsHandler(t)
	claims := &auth.Claims{UserID: friendSender}

	mock.ExpectQuery(friendStatusQueryPat).
		WillReturnRows(sqlmock.NewRows([]string{"is_friend", "i_follow", "they_follow"}).AddRow(false, false, false))

	c, w := newGETContextWithClaims("/api/v1/friends/status/"+friendReceiver, nil, claims)
	c.Params = append(c.Params, gin.Param{Key: "userId", Value: friendReceiver})
	handler.GetFriendStatus(c)

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
	// Privacy-critical: after unfollowing, cached private wall content keyed by
	// the ex-friend's viewer id must be purged, plus all friend-list cache keys.
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	ctx := context.Background()
	keys := []string{
		"data:/api/v1/friends",
		"data:/api/v1/friends/subscribers?user_id=u1",
		"data:/api/v1/friends/subscriptions",
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

	for _, k := range keys[:5] {
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
