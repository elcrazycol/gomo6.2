package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── GetPostLikesCount ───────────────────────────────────────────────────────

func TestGetPostLikesCount_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM post_likes WHERE post_id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(5))

	c, w := newRPCGETContext(map[string]string{"post_uuid": postID})
	h.GetPostLikesCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.SupabaseResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetPostLikesCount_MissingParam(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(nil)
	h.GetPostLikesCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetPostLikesCount_InvalidUUID(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(map[string]string{"post_uuid": "not-a-uuid"})
	h.GetPostLikesCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetPostLikesCount_DBError(t *testing.T) {
	h, mock := setupRPCHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM post_likes WHERE post_id = \$1`).
		WithArgs(postID).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRPCGETContext(map[string]string{"post_uuid": postID})
	h.GetPostLikesCount(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── GetThreadLikesCount ─────────────────────────────────────────────────────

func TestGetThreadLikesCount_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM thread_likes WHERE thread_id = \$1`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))

	c, w := newRPCGETContext(map[string]string{"thread_uuid": threadID})
	h.GetThreadLikesCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ─── HasUserLikedPost ────────────────────────────────────────────────────────

func TestHasUserLikedPost_True(t *testing.T) {
	h, mock := setupRPCHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM post_likes WHERE post_id = \$1 AND user_id = \$2\)`).
		WithArgs(postID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newRPCGETContext(map[string]string{"post_uuid": postID, "user_uuid": userID})
	h.HasUserLikedPost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestHasUserLikedPost_MissingParam(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(map[string]string{"post_uuid": "550e8400-e29b-41d4-a716-446655440000"})
	h.HasUserLikedPost(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── HasUserLikedThread ──────────────────────────────────────────────────────

func TestHasUserLikedThread_False(t *testing.T) {
	h, mock := setupRPCHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM thread_likes WHERE thread_id = \$1 AND user_id = \$2\)`).
		WithArgs(threadID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newRPCGETContext(map[string]string{"thread_uuid": threadID, "user_uuid": userID})
	h.HasUserLikedThread(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ─── GetUserLikesGivenCount ──────────────────────────────────────────────────

func TestGetUserLikesGivenCount_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM post_likes WHERE user_id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(10))

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	h.GetUserLikesGivenCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ─── GetUserLikesReceivedCount ───────────────────────────────────────────────

func TestGetUserLikesReceivedCount_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT COUNT\(\*\) FROM post_likes pl.*JOIN posts p ON pl.post_id = p.id.*WHERE p.user_id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(7))

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	h.GetUserLikesReceivedCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetUserLikesReceivedCount_MissingParam(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(nil)
	h.GetUserLikesReceivedCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetUserLikesReceivedCount_InvalidUUID(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(map[string]string{"user_uuid": "not-a-uuid"})
	h.GetUserLikesReceivedCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetUserLikesReceivedCount_EqPrefixUUID(t *testing.T) {
	h, mock := setupRPCHandler(t)

	// Regression test: eq. prefix (e.g. "eq.550e8400-...") must be rejected as invalid UUID
	c, w := newRPCGETContext(map[string]string{"user_uuid": "eq.550e8400-e29b-41d4-a716-446655440001"})
	h.GetUserLikesReceivedCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for eq. prefix, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetUserLikesReceivedCount_DBError(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT COUNT\(\*\) FROM post_likes pl.*JOIN posts p ON pl.post_id = p.id.*WHERE p.user_id = \$1`).
		WithArgs(userID).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	h.GetUserLikesReceivedCount(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── GetUserThreadLikesGivenCount ────────────────────────────────────────────

func TestGetUserThreadLikesGivenCount_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM thread_likes WHERE user_id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(4))

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	h.GetUserThreadLikesGivenCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ─── GetUserThreadLikesReceivedCount ─────────────────────────────────────────

func TestGetUserThreadLikesReceivedCount_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT COUNT\(\*\) FROM thread_likes tl.*JOIN threads t ON tl.thread_id = t.id.*WHERE t.user_id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	h.GetUserThreadLikesReceivedCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetUserThreadLikesReceivedCount_MissingParam(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(nil)
	h.GetUserThreadLikesReceivedCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetUserThreadLikesReceivedCount_InvalidUUID(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(map[string]string{"user_uuid": "not-a-uuid"})
	h.GetUserThreadLikesReceivedCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetUserThreadLikesReceivedCount_EqPrefixUUID(t *testing.T) {
	h, mock := setupRPCHandler(t)

	// Regression test: eq. prefix (e.g. "eq.550e8400-...") must be rejected as invalid UUID
	c, w := newRPCGETContext(map[string]string{"user_uuid": "eq.550e8400-e29b-41d4-a716-446655440001"})
	h.GetUserThreadLikesReceivedCount(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for eq. prefix, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetUserThreadLikesReceivedCount_DBError(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT COUNT\(\*\) FROM thread_likes tl.*JOIN threads t ON tl.thread_id = t.id.*WHERE t.user_id = \$1`).
		WithArgs(userID).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	h.GetUserThreadLikesReceivedCount(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── GetRecentPostLikers ─────────────────────────────────────────────────────

func TestGetRecentPostLikers_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`(?s).*SELECT u.username, u.id, u.avatar_url, u.is_anonymous.*FROM post_likes pl.*JOIN users u.*WHERE pl.post_id = \$1.*ORDER BY.*LIMIT \$2`).
		WithArgs(postID, 10).
		WillReturnRows(sqlmock.NewRows([]string{"username", "id", "avatar_url", "is_anonymous"}).
			AddRow("user1", "u1", nil, false).
			AddRow("user2", "u2", nil, true))

	c, w := newRPCGETContext(map[string]string{"post_uuid": postID})
	h.GetRecentPostLikers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetRecentPostLikers_MissingParam(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCGETContext(nil)
	h.GetRecentPostLikers(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── GetRecentThreadLikers ───────────────────────────────────────────────────

func TestGetRecentThreadLikers_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`(?s).*SELECT u.username, u.id, u.avatar_url, u.is_anonymous.*FROM thread_likes tl.*JOIN users u.*WHERE tl.thread_id = \$1.*ORDER BY.*LIMIT \$2`).
		WithArgs(threadID, 10).
		WillReturnRows(sqlmock.NewRows([]string{"username", "id", "avatar_url", "is_anonymous"}).
			AddRow("user1", "u1", nil, false))

	c, w := newRPCGETContext(map[string]string{"thread_uuid": threadID})
	h.GetRecentThreadLikers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ─── GetUserPostLikesReceivedTimestamps ──────────────────────────────────────

func TestGetUserPostLikesReceivedTimestamps_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT pl.created_at.*FROM post_likes pl.*INNER JOIN posts p.*WHERE p.user_id = \$1.*ORDER BY.*ASC`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(time.Now()))

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	c.Set("claims", claims)
	h.GetUserPostLikesReceivedTimestamps(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetUserPostLikesReceivedTimestamps_Unauthenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	h.GetUserPostLikesReceivedTimestamps(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── GetUserThreadLikesReceivedTimestamps ────────────────────────────────────

func TestGetUserThreadLikesReceivedTimestamps_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT tl.created_at.*FROM thread_likes tl.*INNER JOIN threads t.*WHERE t.user_id = \$1.*ORDER BY.*ASC`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(time.Now()))

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	c.Set("claims", claims)
	h.GetUserThreadLikesReceivedTimestamps(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ─── GetUserThreadReplyTimestamps ────────────────────────────────────────────

func TestGetUserThreadReplyTimestamps_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT p.created_at.*FROM posts p.*INNER JOIN threads t.*WHERE t.user_id = \$1 AND p.user_id <> \$1.*ORDER BY.*ASC`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(time.Now()))

	c, w := newRPCGETContext(map[string]string{"user_uuid": userID})
	c.Set("claims", claims)
	h.GetUserThreadReplyTimestamps(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ─── ToggleWallPostPin ───────────────────────────────────────────────────────

func TestToggleWallPostPin_Pin(t *testing.T) {
	h, mock := setupRPCHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	userID := "660e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`SELECT user_id, is_pinned FROM profile_wall_posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "is_pinned"}).AddRow(userID, false))

	mock.ExpectQuery(`SELECT MAX\(pinned_order\) FROM profile_wall_posts WHERE user_id = \$1 AND is_pinned = TRUE`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(nil))

	mock.ExpectExec(`UPDATE profile_wall_posts SET is_pinned = TRUE, pinned_order = \$1, updated_at = NOW\(\) WHERE id = \$2`).
		WithArgs(1, postID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newRPCGETContext(map[string]string{"_post_id": postID, "_user_id": userID})
	h.ToggleWallPostPin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleWallPostPin_Unpin(t *testing.T) {
	h, mock := setupRPCHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	userID := "660e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`SELECT user_id, is_pinned FROM profile_wall_posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "is_pinned"}).AddRow(userID, true))

	mock.ExpectExec(`UPDATE profile_wall_posts SET is_pinned = FALSE, pinned_order = NULL, updated_at = NOW\(\) WHERE id = \$1`).
		WithArgs(postID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newRPCGETContext(map[string]string{"_post_id": postID, "_user_id": userID})
	h.ToggleWallPostPin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleWallPostPin_NotOwner(t *testing.T) {
	h, mock := setupRPCHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT user_id, is_pinned FROM profile_wall_posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "is_pinned"}).AddRow("other_user", false))

	c, w := newRPCGETContext(map[string]string{"_post_id": postID, "_user_id": "660e8400-e29b-41d4-a716-446655440001"})
	h.ToggleWallPostPin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp models.SupabaseResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data != false {
		t.Fatalf("expected false, got %v", resp.Data)
	}
}

// ─── GetOrCreateDirectChat ───────────────────────────────────────────────────

func TestGetOrCreateDirectChat_Unauthenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCPostContext(map[string]string{"target_user_id": "660e8400-e29b-41d4-a716-446655440001"}, nil)
	h.GetOrCreateDirectChat(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGetOrCreateDirectChat_SelfChat(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newRPCPostContext(map[string]string{"target_user_id": "u1"}, claims)
	h.GetOrCreateDirectChat(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetOrCreateDirectChat_Existing(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}
	targetID := "660e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`(?s).*SELECT cm1.conversation_id.*FROM chat_conversation_members cm1.*INNER JOIN chat_conversation_members cm2.*WHERE cm1.user_id = \$1 AND cm2.user_id = \$2.*AND cm1.archived_at IS NULL.*AND cm2.archived_at IS NULL.*LIMIT 1`).
		WithArgs("u1", targetID).
		WillReturnRows(sqlmock.NewRows([]string{"conversation_id"}).AddRow("conv123"))

	c, w := newRPCPostContext(map[string]string{"target_user_id": targetID}, claims)
	h.GetOrCreateDirectChat(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetOrCreateDirectChat_New(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}
	targetID := "660e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`(?s).*SELECT cm1.conversation_id.*FROM chat_conversation_members cm1.*INNER JOIN chat_conversation_members cm2.*WHERE cm1.user_id = \$1 AND cm2.user_id = \$2.*AND cm1.archived_at IS NULL.*AND cm2.archived_at IS NULL.*LIMIT 1`).
		WithArgs("u1", targetID).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO chat_conversations \(id, created_at, updated_at\) VALUES \(\$1, NOW\(\), NOW\(\)\)`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO chat_conversation_members \(conversation_id, user_id, joined_at, updated_at\) VALUES \(\$1, \$2, NOW\(\), NOW\(\)\), \(\$1, \$3, NOW\(\), NOW\(\)\)`).
		WithArgs(sqlmock.AnyArg(), "u1", targetID).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	c, w := newRPCPostContext(map[string]string{"target_user_id": targetID}, claims)
	h.GetOrCreateDirectChat(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── ChatMarkDelivered ───────────────────────────────────────────────────────

func TestChatMarkDelivered_Unauthenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCPostContext(map[string]string{
		"target_conversation_id": "conv1",
		"target_message_id":      "msg1",
	}, nil)
	h.ChatMarkDelivered(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestChatMarkDelivered_MissingParams(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newRPCPostContext(map[string]string{}, claims)
	h.ChatMarkDelivered(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── ChatMarkRead ────────────────────────────────────────────────────────────

func TestChatMarkRead_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	convID := "550e8400-e29b-41d4-a716-446655440000"
	msgID := "660e8400-e29b-41d4-a716-446655440001"
	now := time.Now()

	mock.ExpectQuery(`(?s).*SELECT EXISTS\(.*SELECT 1 FROM chat_conversation_members.*WHERE conversation_id = \$1 AND user_id = \$2 AND archived_at IS NULL.*\)`).
		WithArgs(convID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`(?s).*SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs(msgID, convID).
		WillReturnRows(sqlmock.NewRows([]string{"sent_at"}).AddRow(now))

	mock.ExpectBegin()
	mock.ExpectExec(`(?s).*INSERT INTO chat_receipts \(message_id, user_id, delivered_at, read_at\).*SELECT.*`).
		WithArgs("u1", convID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s).*UPDATE chat_conversation_members.*SET.*last_read_at = \$3.*unread_count_cache = 0.*updated_at = NOW\(\).*WHERE conversation_id = \$1.*AND user_id = \$2`).
		WithArgs(convID, "u1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newRPCPostContext(map[string]string{
		"target_conversation_id": convID,
		"target_message_id":      msgID,
	}, claims)
	h.ChatMarkRead(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestChatMarkRead_NotMember(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	convID := "550e8400-e29b-41d4-a716-446655440000"
	msgID := "660e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`(?s).*SELECT EXISTS\(.*SELECT 1 FROM chat_conversation_members.*WHERE conversation_id = \$1 AND user_id = \$2 AND archived_at IS NULL.*\)`).
		WithArgs(convID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newRPCPostContext(map[string]string{
		"target_conversation_id": convID,
		"target_message_id":      msgID,
	}, claims)
	h.ChatMarkRead(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// ─── GetAvatarHistory ────────────────────────────────────────────────────────

func TestGetAvatarHistory_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440001"
	mock.ExpectQuery(`(?s).*SELECT id, avatar_url, uploaded_at, is_current.*FROM avatar_history.*WHERE user_id = \$1.*ORDER BY uploaded_at DESC`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "avatar_url", "uploaded_at", "is_current"}).
			AddRow("a1", "https://example.com/avatar1.jpg", time.Now(), true).
			AddRow("a2", "https://example.com/avatar2.jpg", time.Now().Add(-24*time.Hour), false))

	c, w := newRPCPostContext(map[string]string{"user_uuid": userID}, nil)
	h.GetAvatarHistory(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── DeleteAvatarFromHistory ─────────────────────────────────────────────────

func TestDeleteAvatarFromHistory_Unauthenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCPostContext(map[string]string{
		"avatar_id":          "a1",
		"requesting_user_id": "u1",
	}, nil)
	h.DeleteAvatarFromHistory(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── ToggleAchievementPin ────────────────────────────────────────────────────

func TestToggleAchievementPin_Pin(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440000"
	achievementID := "550e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`(?s).*SELECT is_pinned.*FROM user_achievements.*WHERE user_id = \$1 AND achievement_id = \$2`).
		WithArgs(userID, achievementID).
		WillReturnRows(sqlmock.NewRows([]string{"is_pinned"}).AddRow(false))

	mock.ExpectQuery(`(?s).*SELECT COUNT\(\*\).*FROM user_achievements.*WHERE user_id = \$1 AND is_pinned = TRUE`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery(`(?s).*SELECT MAX\(pinned_order\).*FROM user_achievements.*WHERE user_id = \$1 AND is_pinned = TRUE`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(nil))

	mock.ExpectExec(`(?s).*UPDATE user_achievements.*SET is_pinned = TRUE, pinned_order = \$1.*WHERE user_id = \$2 AND achievement_id = \$3`).
		WithArgs(1, userID, achievementID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newRPCPostContext(map[string]string{
		"_user_id":        userID,
		"_achievement_id": achievementID,
	}, nil)
	h.ToggleAchievementPin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleAchievementPin_Unpin(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440000"
	achievementID := "550e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`(?s).*SELECT is_pinned.*FROM user_achievements.*WHERE user_id = \$1 AND achievement_id = \$2`).
		WithArgs(userID, achievementID).
		WillReturnRows(sqlmock.NewRows([]string{"is_pinned"}).AddRow(true))

	mock.ExpectExec(`(?s).*UPDATE user_achievements.*SET is_pinned = FALSE, pinned_order = NULL.*WHERE user_id = \$1 AND achievement_id = \$2`).
		WithArgs(userID, achievementID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newRPCPostContext(map[string]string{
		"_user_id":        userID,
		"_achievement_id": achievementID,
	}, nil)
	h.ToggleAchievementPin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleAchievementPin_MaxPinned(t *testing.T) {
	h, mock := setupRPCHandler(t)

	userID := "660e8400-e29b-41d4-a716-446655440000"
	achievementID := "550e8400-e29b-41d4-a716-446655440001"

	mock.ExpectQuery(`(?s).*SELECT is_pinned.*FROM user_achievements.*WHERE user_id = \$1 AND achievement_id = \$2`).
		WithArgs(userID, achievementID).
		WillReturnRows(sqlmock.NewRows([]string{"is_pinned"}).AddRow(false))

	mock.ExpectQuery(`(?s).*SELECT COUNT\(\*\).*FROM user_achievements.*WHERE user_id = \$1 AND is_pinned = TRUE`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(4))

	c, w := newRPCPostContext(map[string]string{
		"_user_id":        userID,
		"_achievement_id": achievementID,
	}, nil)
	h.ToggleAchievementPin(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── CreateGomoSub ───────────────────────────────────────────────────────────

func TestCreateGomoSub_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// Slug uniqueness check — no existing row
	mock.ExpectQuery(`(?s).*SELECT id FROM boards WHERE slug = \$1`).
		WithArgs("my-test").
		WillReturnError(sql.ErrNoRows)

	// INSERT + RETURNING
	now := time.Now()
	mock.ExpectQuery(`(?s).*INSERT INTO boards.*RETURNING.*`).
		WithArgs("my-test", "My Test", "A test gomosub",
			"u1", nil, nil, "[]", nil).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "name", "description", "is_gomosub", "is_rules_board", "owner_id",
			"gomosub_avatar_url", "cover_image_url", "gomosub_tags", "rules_markdown", "rules_updated_at", "created_at",
		}).AddRow("board-1", "my-test", "My Test", "A test gomosub", true, false,
			"u1", nil, nil, "[]", nil, nil, now))

	c, w := newRPCPostContext(map[string]interface{}{
		"slug":        "my-test",
		"name":        "My Test",
		"description": "A test gomosub",
	}, claims)
	h.CreateGomoSub(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.SupabaseResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success, got error: %v", resp.Error)
	}

	// Verify the response contains expected fields
	data, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("failed to marshal response data: %v", err)
	}
	var board models.Board
	if err := json.Unmarshal(data, &board); err != nil {
		t.Fatalf("response data is not a valid Board: %v", err)
	}
	if board.Slug != "my-test" {
		t.Fatalf("expected slug 'my-test', got %q", board.Slug)
	}
	if board.Name != "My Test" {
		t.Fatalf("expected name 'My Test', got %q", board.Name)
	}
	if !board.IsGomosub {
		t.Fatal("expected is_gomosub = true")
	}
	if board.OwnerID == nil || *board.OwnerID != "u1" {
		t.Fatalf("expected owner_id 'u1', got %v", board.OwnerID)
	}
}

func TestCreateGomoSub_Unauthenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCPostContext(map[string]interface{}{
		"slug":        "my-test",
		"name":        "My Test",
		"description": "A test gomosub",
	}, nil)
	h.CreateGomoSub(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateGomoSub_MissingFields(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	tests := []struct {
		name string
		body map[string]interface{}
	}{
		{"empty slug", map[string]interface{}{"slug": "", "name": "Name", "description": "Desc"}},
		{"empty name", map[string]interface{}{"slug": "my-test", "name": "", "description": "Desc"}},
		{"empty description", map[string]interface{}{"slug": "my-test", "name": "Name", "description": ""}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, w := newRPCPostContext(tt.body, claims)
			h.CreateGomoSub(c)
			_ = mock

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestCreateGomoSub_InvalidSlug(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	tests := []struct {
		name string
		slug string
	}{
		{"starts with hyphen", "-test"},
		{"starts with underscore", "_test"},
		{"too short (single char)", "a"},
		{"has spaces", "my test"},
		{"cyrillic", "тест"},
		{"contains dot", "test.slug"},
		{"too long (26 chars)", "abcdefghijklmnopqrstuvwxyz"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, w := newRPCPostContext(map[string]interface{}{
				"slug":        tt.slug,
				"name":        "Name",
				"description": "Desc",
			}, claims)
			h.CreateGomoSub(c)
			_ = mock

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for slug=%q, got %d: %s", tt.slug, w.Code, w.Body.String())
			}
		})
	}
}

func TestCreateGomoSub_ReservedSlug(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	reserved := []string{"rules", "g", "admin", "a", "tech", "news"}

	for _, slug := range reserved {
		t.Run(slug, func(t *testing.T) {
			c, w := newRPCPostContext(map[string]interface{}{
				"slug":        slug,
				"name":        "Name",
				"description": "Desc",
			}, claims)
			h.CreateGomoSub(c)
			_ = mock

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for reserved slug=%q, got %d: %s", slug, w.Code, w.Body.String())
			}
		})
	}
}

func TestCreateGomoSub_SlugTaken(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// Slug uniqueness check — existing row found
	mock.ExpectQuery(`(?s).*SELECT id FROM boards WHERE slug = \$1`).
		WithArgs("taken-slug").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("existing-board-id"))

	c, w := newRPCPostContext(map[string]interface{}{
		"slug":        "taken-slug",
		"name":        "Name",
		"description": "Desc",
	}, claims)
	h.CreateGomoSub(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateGomoSub_DBErrorOnSelect(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT id FROM boards WHERE slug = \$1`).
		WithArgs("my-test").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRPCPostContext(map[string]interface{}{
		"slug":        "my-test",
		"name":        "My Test",
		"description": "A test gomosub",
	}, claims)
	h.CreateGomoSub(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateGomoSub_DBErrorOnInsert(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT id FROM boards WHERE slug = \$1`).
		WithArgs("my-test").
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(`(?s).*INSERT INTO boards.*RETURNING.*`).
		WithArgs("my-test", "My Test", "A test gomosub",
			"u1", nil, nil, "[]", nil).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRPCPostContext(map[string]interface{}{
		"slug":        "my-test",
		"name":        "My Test",
		"description": "A test gomosub",
	}, claims)
	h.CreateGomoSub(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateGomoSub_DuplicateKeyOnInsert(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT id FROM boards WHERE slug = \$1`).
		WithArgs("my-test").
		WillReturnError(sql.ErrNoRows)

	// INSERT returns duplicate key error (race condition — was created between SELECT and INSERT)
	mock.ExpectQuery(`(?s).*INSERT INTO boards.*RETURNING.*`).
		WithArgs("my-test", "My Test", "A test gomosub",
			"u1", nil, nil, "[]", nil).
		WillReturnError(errors.New("duplicate key value violates unique constraint"))

	c, w := newRPCPostContext(map[string]interface{}{
		"slug":        "my-test",
		"name":        "My Test",
		"description": "A test gomosub",
	}, claims)
	h.CreateGomoSub(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}
