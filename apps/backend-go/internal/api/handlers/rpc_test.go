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
	var resp models.APIResponse
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
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data != false {
		t.Fatalf("expected false, got %v", resp.Data)
	}
}

// ─── GetOrCreateDirectChat ───────────────────────────────────────────────────

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
			"u1", "public", nil, nil, "[]", nil).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "name", "description", "is_gomosub", "is_rules_board", "owner_id", "visibility",
			"gomosub_avatar_url", "cover_image_url", "gomosub_tags", "rules_markdown", "rules_updated_at", "created_at",
		}).AddRow("board-1", "my-test", "My Test", "A test gomosub", true, false,
			"u1", "public", nil, nil, "[]", nil, nil, now))

	c, w := newRPCPostContext(map[string]interface{}{
		"slug":        "my-test",
		"name":        "My Test",
		"description": "A test gomosub",
	}, claims)
	h.CreateGomoSub(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
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
			"u1", "public", nil, nil, "[]", sqlmock.AnyArg()).
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
			"u1", "public", nil, nil, "[]", nil).
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

// setupRPCHandlerWithSyncStats creates an RPCHandler where recomputeStatsFn runs synchronously.
// This avoids flaky time.Sleep calls in tests that need mock expectations for RecomputeUserProfileStats.
func setupRPCHandlerWithSyncStats(t *testing.T) (*RPCHandler, sqlmock.Sqlmock) {
	h, mock := setupRPCHandler(t)
	h.recomputeStatsFn = func(db *sql.DB, userID string) {
		db.Exec(`UPDATE users u SET post_count = s.pc, thread_count = s.tc, garma = s.g, updated_at = NOW() FROM (SELECT $1 AS id) s WHERE u.id = $1`, userID)
	}
	return h, mock
}

// ─── CreatePostRPC ────────────────────────────────────────────────────────────

func TestCreatePostRPC_Success(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	now := time.Now()

	// Check thread exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// INSERT post + RETURNING
	mock.ExpectQuery(`(?s).*INSERT INTO posts.*RETURNING.*`).
		WithArgs(threadID, "u1", "Test post content",
			nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), nil, false, nil, "localhost:8080").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "thread_id", "user_id", "content", "content_json",
			"image_url", "image_urls", "attachments", "reply_to", "is_private",
			"private_recipient_id", "server_domain", "created_at", "is_remote",
		}).AddRow(
			"post-1", threadID, "u1", "Test post content", nil,
			nil, nil, nil, nil, false,
			nil, "localhost:8080", now, false,
		))

	// Update thread post_count
	mock.ExpectExec(`UPDATE threads SET post_count = post_count \+ 1, updated_at = NOW\(\) WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// RecomputeUserProfileStats — runs synchronously via recomputeStatsFn
	mock.ExpectExec(`(?s).*UPDATE users.*SET.*post_count.*FROM.*WHERE u.id = \$1`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": threadID,
		"content":   "Test post content",
	}, claims)
	h.CreatePostRPC(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success, got error: %v", resp.Error)
	}

	data, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("failed to marshal response data: %v", err)
	}
	var post models.Post
	if err := json.Unmarshal(data, &post); err != nil {
		t.Fatalf("response data is not a valid Post: %v", err)
	}
	if post.ID != "post-1" {
		t.Fatalf("expected post ID 'post-1', got %q", post.ID)
	}
	if post.ThreadID != threadID {
		t.Fatalf("expected thread_id %q, got %q", threadID, post.ThreadID)
	}
	if post.Content != "Test post content" {
		t.Fatalf("expected content 'Test post content', got %q", post.Content)
	}
}

func TestCreatePostRPC_Unauthenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": "550e8400-e29b-41d4-a716-446655440000",
		"content":   "Test",
	}, nil)
	h.CreatePostRPC(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreatePostRPC_EmptyContent(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": "550e8400-e29b-41d4-a716-446655440000",
		"content":   "",
	}, claims)
	h.CreatePostRPC(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreatePostRPC_WhitespaceOnly(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	tests := []struct {
		name    string
		content string
	}{
		{"spaces only", "     "},
		{"newlines only", "\n\n\n"},
		{"tabs only", "\t\t\t"},
		{"mixed whitespace", " \n\t \n "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, w := newRPCPostContext(map[string]interface{}{
				"thread_id": "550e8400-e29b-41d4-a716-446655440000",
				"content":   tt.content,
			}, claims)
			h.CreatePostRPC(c)
			_ = mock

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for content=%q, got %d: %s", tt.content, w.Code, w.Body.String())
			}
		})
	}
}

func TestCreatePostRPC_AttachmentsOnly(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	now := time.Now()

	// Check thread exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// INSERT post + RETURNING — content empty, attachments present
	mock.ExpectQuery(`(?s).*INSERT INTO posts.*RETURNING.*`).
		WithArgs(threadID, "u1", "",
			nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), nil, false, nil, "localhost:8080").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "thread_id", "user_id", "content", "content_json",
			"image_url", "image_urls", "attachments", "reply_to", "is_private",
			"private_recipient_id", "server_domain", "created_at", "is_remote",
		}).AddRow(
			"post-attach", threadID, "u1", "", nil,
			nil, nil, nil, nil, false,
			nil, "localhost:8080", now, false,
		))

	// Update thread post_count
	mock.ExpectExec(`UPDATE threads SET post_count = post_count \+ 1, updated_at = NOW\(\) WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// RecomputeUserProfileStats — runs synchronously via recomputeStatsFn
	mock.ExpectExec(`(?s).*UPDATE users.*SET.*post_count.*FROM.*WHERE u.id = \$1`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": threadID,
		"content":   "",
		"attachments": []map[string]interface{}{
			{"type": "image", "url": "https://example.com/image.jpg"},
		},
	}, claims)
	h.CreatePostRPC(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success, got error: %v", resp.Error)
	}

	data, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("failed to marshal response data: %v", err)
	}
	var post models.Post
	if err := json.Unmarshal(data, &post); err != nil {
		t.Fatalf("response data is not a valid Post: %v", err)
	}
	if post.ID != "post-attach" {
		t.Fatalf("expected post ID 'post-attach', got %q", post.ID)
	}
	if post.Content != "" {
		t.Fatalf("expected empty content, got %q", post.Content)
	}
}

func TestCreatePostRPC_MissingThreadID(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newRPCPostContext(map[string]interface{}{
		"content": "Test",
	}, claims)
	h.CreatePostRPC(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreatePostRPC_InvalidThreadID(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": "not-a-uuid",
		"content":   "Test",
	}, claims)
	h.CreatePostRPC(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreatePostRPC_ThreadNotFound(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	threadID := "550e8400-e29b-41d4-a716-446655440000"

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": threadID,
		"content":   "Test",
	}, claims)
	h.CreatePostRPC(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreatePostRPC_DBErrorOnInsert(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	threadID := "550e8400-e29b-41d4-a716-446655440000"

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Note: JSONB fields (image_urls, attachments) pass []byte("null") not nil
	mock.ExpectQuery(`(?s).*INSERT INTO posts.*RETURNING.*`).
		WithArgs(threadID, "u1", "Test",
			nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), nil, false, nil, "localhost:8080").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": threadID,
		"content":   "Test",
	}, claims)
	h.CreatePostRPC(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── CreateThreadRPC ──────────────────────────────────────────────────────────

func TestCreateThreadRPC_Success(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	now := time.Now()

	// Check board exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM boards WHERE id = \$1\)`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// BEGIN transaction
	mock.ExpectBegin()

	// INSERT thread + RETURNING
	mock.ExpectQuery(`(?s).*INSERT INTO threads.*RETURNING.*`).
		WithArgs(boardID, nil, "u1", "Test Title", "Test Content",
			nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), "localhost:8080").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "board_id", "channel_id", "user_id", "title", "content", "content_json",
			"image_url", "image_urls", "attachments", "post_count", "server_domain",
			"created_at", "updated_at", "is_remote",
		}).AddRow(
			"thread-1", boardID, nil, "u1", "Test Title", "Test Content", nil,
			nil, nil, nil, 0, "localhost:8080",
			now, now, false,
		))

	// COMMIT transaction
	mock.ExpectCommit()

	// RecomputeUserProfileStats — runs synchronously via recomputeStatsFn
	mock.ExpectExec(`(?s).*UPDATE users.*SET.*post_count.*FROM.*WHERE u.id = \$1`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newRPCPostContext(map[string]interface{}{
		"board_id": boardID,
		"title":    "Test Title",
		"content":  "Test Content",
	}, claims)
	h.CreateThreadRPC(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success, got error: %v", resp.Error)
	}

	data, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("failed to marshal response data: %v", err)
	}
	var thread models.Thread
	if err := json.Unmarshal(data, &thread); err != nil {
		t.Fatalf("response data is not a valid Thread: %v", err)
	}
	if thread.ID != "thread-1" {
		t.Fatalf("expected thread ID 'thread-1', got %q", thread.ID)
	}
	if thread.BoardID != boardID {
		t.Fatalf("expected board_id %q, got %q", boardID, thread.BoardID)
	}
	if thread.Title != "Test Title" {
		t.Fatalf("expected title 'Test Title', got %q", thread.Title)
	}
}

func TestCreateThreadRPC_SuccessWithPoll(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	now := time.Now()

	// Check board exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM boards WHERE id = \$1\)`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// BEGIN transaction
	mock.ExpectBegin()

	// INSERT thread + RETURNING
	mock.ExpectQuery(`(?s).*INSERT INTO threads.*RETURNING.*`).
		WithArgs(boardID, nil, "u1", "Poll Thread", "Poll content",
			nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), "localhost:8080").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "board_id", "channel_id", "user_id", "title", "content", "content_json",
			"image_url", "image_urls", "attachments", "post_count", "server_domain",
			"created_at", "updated_at", "is_remote",
		}).AddRow(
			"thread-poll", boardID, nil, "u1", "Poll Thread", "Poll content", nil,
			nil, nil, nil, 0, "localhost:8080",
			now, now, false,
		))

	// INSERT poll
	mock.ExpectExec(`(?s).*INSERT INTO polls.*VALUES.*`).
		WithArgs("thread-poll", "Best option?", sqlmock.AnyArg(), false, true, true).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// COMMIT transaction
	mock.ExpectCommit()

	// RecomputeUserProfileStats — runs synchronously via recomputeStatsFn
	mock.ExpectExec(`(?s).*UPDATE users.*SET.*post_count.*FROM.*WHERE u.id = \$1`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newRPCPostContext(map[string]interface{}{
		"board_id": boardID,
		"title":    "Poll Thread",
		"content":  "Poll content",
		"poll": map[string]interface{}{
			"question":          "Best option?",
			"options":           []map[string]interface{}{{"id": "opt1", "text": "Option A"}, {"id": "opt2", "text": "Option B"}},
			"show_results":      true,
			"allow_change_vote": true,
		},
	}, claims)
	h.CreateThreadRPC(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateThreadRPC_Unauthenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)

	c, w := newRPCPostContext(map[string]interface{}{
		"board_id": "550e8400-e29b-41d4-a716-446655440000",
		"title":    "Test",
		"content":  "Test",
	}, nil)
	h.CreateThreadRPC(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateThreadRPC_WhitespaceFields(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	boardID := "550e8400-e29b-41d4-a716-446655440000"

	tests := []struct {
		name    string
		title   string
		content string
	}{
		{"title has spaces only", "   ", "Content"},
		{"title has newlines only", "\n\n\n", "Content"},
		{"content has spaces only", "Title", "   "},
		{"content has newlines only", "Title", "\n\n\n"},
		{"both whitespace only", " \n ", "\t\t"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, w := newRPCPostContext(map[string]interface{}{
				"board_id": boardID,
				"title":    tt.title,
				"content":  tt.content,
			}, claims)
			h.CreateThreadRPC(c)
			_ = mock

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for title=%q content=%q, got %d: %s", tt.title, tt.content, w.Code, w.Body.String())
			}
		})
	}
}

func TestCreateThreadRPC_MissingFields(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	tests := []struct {
		name string
		body map[string]interface{}
	}{
		{"missing board_id", map[string]interface{}{"title": "T", "content": "C"}},
		{"missing title", map[string]interface{}{"board_id": "550e8400-e29b-41d4-a716-446655440000", "content": "C"}},
		{"missing content", map[string]interface{}{"board_id": "550e8400-e29b-41d4-a716-446655440000", "title": "T"}},
		{"empty board_id", map[string]interface{}{"board_id": "", "title": "T", "content": "C"}},
		{"empty title", map[string]interface{}{"board_id": "550e8400-e29b-41d4-a716-446655440000", "title": "", "content": "C"}},
		{"empty content", map[string]interface{}{"board_id": "550e8400-e29b-41d4-a716-446655440000", "title": "T", "content": ""}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, w := newRPCPostContext(tt.body, claims)
			h.CreateThreadRPC(c)
			_ = mock

			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestCreateThreadRPC_InvalidBoardID(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newRPCPostContext(map[string]interface{}{
		"board_id": "not-a-uuid",
		"title":    "Test",
		"content":  "Test",
	}, claims)
	h.CreateThreadRPC(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateThreadRPC_BoardNotFound(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	boardID := "550e8400-e29b-41d4-a716-446655440000"

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM boards WHERE id = \$1\)`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newRPCPostContext(map[string]interface{}{
		"board_id": boardID,
		"title":    "Test",
		"content":  "Test",
	}, claims)
	h.CreateThreadRPC(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateThreadRPC_DBErrorOnInsert(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	boardID := "550e8400-e29b-41d4-a716-446655440000"

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM boards WHERE id = \$1\)`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectBegin()

	mock.ExpectQuery(`(?s).*INSERT INTO threads.*RETURNING.*`).
		WithArgs(boardID, nil, "u1", "Test", "Test",
			nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), "localhost:8080").
		WillReturnError(sqlmock.ErrCancelled)

	// No COMMIT, no recomputeStats (error before commit)

	c, w := newRPCPostContext(map[string]interface{}{
		"board_id": boardID,
		"title":    "Test",
		"content":  "Test",
	}, claims)
	h.CreateThreadRPC(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}
