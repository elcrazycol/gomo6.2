package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ──────────────────────────── LikeThread ────────────────────────────

func TestLikeThread_Success(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/threads/"+threadID+"/like", nil, claims, map[string]string{"id": threadID})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM thread_likes WHERE thread_id = \$1 AND user_id = \$2\)`).
		WithArgs(threadID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	likeRow := sqlmock.NewRows([]string{"id", "thread_id", "user_id", "created_at"}).
		AddRow("l1", threadID, "u1", time.Now())

	mock.ExpectQuery(`INSERT INTO thread_likes.*VALUES.*RETURNING`).
		WithArgs(threadID, "u1").
		WillReturnRows(likeRow)

	mock.ExpectQuery(`SELECT user_id FROM threads WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	handler.LikeThread(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestLikeThread_InvalidUUID(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/threads/bad-id/like", nil, claims, map[string]string{"id": "bad-id"})

	handler.LikeThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLikeThread_Unauthenticated(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	threadID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPOSTContext("/rest/v1/threads/"+threadID+"/like", nil, nil, map[string]string{"id": threadID})

	handler.LikeThread(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestLikeThread_ThreadNotFound(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/threads/"+threadID+"/like", nil, claims, map[string]string{"id": threadID})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.LikeThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLikeThread_AlreadyLiked(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/threads/"+threadID+"/like", nil, claims, map[string]string{"id": threadID})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM thread_likes WHERE thread_id = \$1 AND user_id = \$2\)`).
		WithArgs(threadID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	handler.LikeThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLikeThread_DBError(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/threads/"+threadID+"/like", nil, claims, map[string]string{"id": threadID})

	// First SELECT EXISTS error -> handler treats as "thread not found" (400)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnError(sqlmock.ErrCancelled)

	handler.LikeThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (handler treats DB error as not found), got %d", w.Code)
	}
}

// ──────────────────────────── UnlikeThread ────────────────────────────

func TestUnlikeThread_Success(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/threads/"+threadID+"/like", nil, map[string]string{"id": threadID})
	c.Set("claims", claims)

	mock.ExpectExec(`DELETE FROM thread_likes WHERE thread_id = \$1 AND user_id = \$2`).
		WithArgs(threadID, "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(`SELECT user_id FROM threads WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	handler.UnlikeThread(c)

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

func TestUnlikeThread_InvalidUUID(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/threads/bad-id/like", nil, map[string]string{"id": "bad-id"})
	c.Set("claims", claims)

	handler.UnlikeThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUnlikeThread_Unauthenticated(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	threadID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newDELETEPContext("/rest/v1/threads/"+threadID+"/like", nil, map[string]string{"id": threadID})

	handler.UnlikeThread(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestUnlikeThread_NotFound(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/threads/"+threadID+"/like", nil, map[string]string{"id": threadID})
	c.Set("claims", claims)

	mock.ExpectExec(`DELETE FROM thread_likes WHERE thread_id = \$1 AND user_id = \$2`).
		WithArgs(threadID, "u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.UnlikeThread(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUnlikeThread_DBError(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/threads/"+threadID+"/like", nil, map[string]string{"id": threadID})
	c.Set("claims", claims)

	mock.ExpectExec(`DELETE FROM thread_likes WHERE thread_id = \$1 AND user_id = \$2`).
		WithArgs(threadID, "u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.UnlikeThread(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── LikePost ────────────────────────────

func TestLikePost_Success(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/posts/"+postID+"/like", nil, claims, map[string]string{"id": postID})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM posts WHERE id = \$1\)`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM post_likes WHERE post_id = \$1 AND user_id = \$2\)`).
		WithArgs(postID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	likeRow := sqlmock.NewRows([]string{"id", "post_id", "user_id", "created_at"}).
		AddRow("l1", postID, "u1", time.Now())

	mock.ExpectQuery(`INSERT INTO post_likes.*VALUES.*RETURNING`).
		WithArgs(postID, "u1").
		WillReturnRows(likeRow)

	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "thread_id"}).AddRow("u1", "t1"))

	handler.LikePost(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestLikePost_InvalidUUID(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/posts/bad-id/like", nil, claims, map[string]string{"id": "bad-id"})

	handler.LikePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLikePost_Unauthenticated(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPOSTContext("/rest/v1/posts/"+postID+"/like", nil, nil, map[string]string{"id": postID})

	handler.LikePost(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestLikePost_PostNotFound(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/posts/"+postID+"/like", nil, claims, map[string]string{"id": postID})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM posts WHERE id = \$1\)`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.LikePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLikePost_AlreadyLiked(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/posts/"+postID+"/like", nil, claims, map[string]string{"id": postID})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM posts WHERE id = \$1\)`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM post_likes WHERE post_id = \$1 AND user_id = \$2\)`).
		WithArgs(postID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	handler.LikePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLikePost_DBError(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newPOSTContext("/rest/v1/posts/"+postID+"/like", nil, claims, map[string]string{"id": postID})

	// First SELECT EXISTS error -> handler treats as "post not found" (400)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM posts WHERE id = \$1\)`).
		WithArgs(postID).
		WillReturnError(sqlmock.ErrCancelled)

	handler.LikePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (handler treats DB error as not found), got %d", w.Code)
	}
}

// ──────────────────────────── UnlikePost ────────────────────────────

func TestUnlikePost_Success(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/posts/"+postID+"/like", nil, map[string]string{"id": postID})
	c.Set("claims", claims)

	mock.ExpectExec(`DELETE FROM post_likes WHERE post_id = \$1 AND user_id = \$2`).
		WithArgs(postID, "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "thread_id"}).AddRow("u1", "t1"))

	handler.UnlikePost(c)

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

func TestUnlikePost_InvalidUUID(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/posts/bad-id/like", nil, map[string]string{"id": "bad-id"})
	c.Set("claims", claims)

	handler.UnlikePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUnlikePost_Unauthenticated(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newDELETEPContext("/rest/v1/posts/"+postID+"/like", nil, map[string]string{"id": postID})

	handler.UnlikePost(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestUnlikePost_NotFound(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/posts/"+postID+"/like", nil, map[string]string{"id": postID})
	c.Set("claims", claims)

	mock.ExpectExec(`DELETE FROM post_likes WHERE post_id = \$1 AND user_id = \$2`).
		WithArgs(postID, "u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.UnlikePost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUnlikePost_DBError(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	postID := "550e8400-e29b-41d4-a716-446655440000"
	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/rest/v1/posts/"+postID+"/like", nil, map[string]string{"id": postID})
	c.Set("claims", claims)

	mock.ExpectExec(`DELETE FROM post_likes WHERE post_id = \$1 AND user_id = \$2`).
		WithArgs(postID, "u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.UnlikePost(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── GetThreadLikes ────────────────────────────

func TestGetThreadLikes_Success(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newGETContext("/rest/v1/threads/"+threadID+"/likes", nil)
	c.Params = []gin.Param{{Key: "id", Value: threadID}}

	rows := sqlmock.NewRows([]string{"id", "thread_id", "user_id", "created_at", "username", "avatar_url"}).
		AddRow("l1", threadID, "u1", time.Now(), "user1", nil).
		AddRow("l2", threadID, "u2", time.Now(), "user2", nil)

	mock.ExpectQuery(`SELECT tl\.id, tl\.thread_id.*FROM thread_likes tl.*WHERE tl\.thread_id = \$1.*ORDER BY tl\.created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs(threadID, 10, 0).
		WillReturnRows(rows)

	handler.GetThreadLikes(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetThreadLikes_InvalidUUID(t *testing.T) {
	handler, _ := setupLikesHandler(t)
	c, w := newGETContext("/rest/v1/threads/bad-id/likes", nil)
	c.Params = []gin.Param{{Key: "id", Value: "bad-id"}}

	handler.GetThreadLikes(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetThreadLikes_DBError(t *testing.T) {
	handler, mock := setupLikesHandler(t)

	threadID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newGETContext("/rest/v1/threads/"+threadID+"/likes", nil)
	c.Params = []gin.Param{{Key: "id", Value: threadID}}

	mock.ExpectQuery(`SELECT tl\.id, tl\.thread_id.*FROM thread_likes tl.*`).
		WithArgs(threadID, 10, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetThreadLikes(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
