package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"database/sql"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ──────────────────────────── GetPosts ────────────────────────────

func TestGetPosts_Success_NoFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts", nil)

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil,
	).AddRow(
		"p2", "t1", "u2", "World!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"user2", nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*ORDER BY p\.created_at ASC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

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

func TestGetPosts_Success_WithThreadFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts", map[string]string{
		"thread_id": "eq.550e8400-e29b-41d4-a716-446655440000",
	})

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "avatar_url",
	}).AddRow(
		"p1", "550e8400-e29b-41d4-a716-446655440000", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.thread_id = \$1.*ORDER BY p\.created_at ASC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

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

func TestGetPosts_Success_WithIDFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts", map[string]string{
		"id": "eq.p1",
	})

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*ORDER BY p\.created_at ASC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("p1", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetPosts_Success_WithInFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts", map[string]string{
		"id": "in.(p1,p2)",
	})

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id IN \(\$1,\$2\).*ORDER BY p\.created_at ASC.*LIMIT \$3 OFFSET \$4`).
		WithArgs("p1", "p2", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetPosts_DBError(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts", nil)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*`).
		WithArgs(100, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetPosts(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── GetPost ────────────────────────────

func TestGetPost_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	row := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1`).
		WithArgs("p1").
		WillReturnRows(row)

	handler.GetPost(c)

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

func TestGetPost_NotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1`).
		WithArgs("p1").
		WillReturnError(sql.ErrNoRows)

	handler.GetPost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetPost_DBError(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/rest/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1`).
		WithArgs("p1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetPost(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── CreatePost ────────────────────────────

func TestCreatePost_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"thread_id": "550e8400-e29b-41d4-a716-446655440000",
		"content":   "Hello, world!",
	}
	c, w := newPOSTContext("/rest/v1/posts", body, claims, nil)

	// Check thread exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Insert post
	insertRow := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
	}).AddRow(
		"new-p1", "550e8400-e29b-41d4-a716-446655440000", "u1", "Hello, world!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
	)

	mock.ExpectQuery(`INSERT INTO posts.*VALUES.*RETURNING`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", "u1", "Hello, world!", nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), nil, "localhost:8080").
		WillReturnRows(insertRow)

	// Update thread post_count
	mock.ExpectExec(`UPDATE threads SET post_count.*WHERE id = \$1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.CreatePost(c)

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

func TestCreatePost_EmptyContent(t *testing.T) {
	handler, _ := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"thread_id": "550e8400-e29b-41d4-a716-446655440000",
		"content":   "",
	}
	c, w := newPOSTContext("/rest/v1/posts", body, claims, nil)

	handler.CreatePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreatePost_InvalidThreadID(t *testing.T) {
	handler, _ := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"thread_id": "not-a-uuid",
		"content":   "Hello!",
	}
	c, w := newPOSTContext("/rest/v1/posts", body, claims, nil)

	handler.CreatePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreatePost_Unauthenticated(t *testing.T) {
	handler, _ := setupPostsHandler(t)

	body := map[string]interface{}{
		"thread_id": "550e8400-e29b-41d4-a716-446655440000",
		"content":   "Hello!",
	}
	c, w := newPOSTContext("/rest/v1/posts", body, nil, nil)

	handler.CreatePost(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestCreatePost_DBError(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"thread_id": "550e8400-e29b-41d4-a716-446655440000",
		"content":   "Hello!",
	}
	c, w := newPOSTContext("/rest/v1/posts", body, claims, nil)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`INSERT INTO posts.*`).
		WillReturnError(sqlmock.ErrCancelled)

	handler.CreatePost(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── DeletePost ────────────────────────────

func TestDeletePost_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newDELETEPContext("/rest/v1/posts", nil, map[string]string{"id": "p1"})

	// Get author and thread
	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "thread_id"}).AddRow("u1", "t1"))

	// Delete
	mock.ExpectExec(`DELETE FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Update thread post_count
	mock.ExpectExec(`UPDATE threads SET post_count.*WHERE id = \$1`).
		WithArgs("t1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.DeletePost(c)

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

func TestDeletePost_NotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newDELETEPContext("/rest/v1/posts", nil, map[string]string{"id": "p1"})

	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnError(sql.ErrNoRows)

	handler.DeletePost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeletePost_EmptyID(t *testing.T) {
	handler, _ := setupPostsHandler(t)
	// No id in path and no id in query
	c, w := newDELETEPContext("/rest/v1/posts", nil, nil)

	handler.DeletePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ──────────────────────────── UpdatePost ────────────────────────────

func TestUpdatePost_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}

	// UpdatePost reads id from path param and also parses UUID; use a valid UUID.
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/rest/v1/posts/"+postID, body, claims, map[string]string{"id": postID})

	// Check ownership
	mock.ExpectQuery(`SELECT user_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	// Update
	updateRow := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "reply_to", "is_private",
		"private_recipient_id", "server_domain", "created_at", "is_remote",
	}).AddRow(
		postID, "t1", "u1", "Updated content!", nil,
		nil, "[]", nil, false, nil, "localhost:8080", time.Now(), false,
	)

	mock.ExpectQuery(`UPDATE posts SET content.*WHERE id = \$[0-9]+.*RETURNING`).
		WithArgs("Updated content!", nil, postID).
		WillReturnRows(updateRow)

	handler.UpdatePost(c)

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

func TestUpdatePost_NotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/rest/v1/posts/"+postID, body, claims, map[string]string{"id": postID})

	mock.ExpectQuery(`SELECT user_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnError(sql.ErrNoRows)

	handler.UpdatePost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdatePost_Forbidden(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u2", Username: "otheruser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/rest/v1/posts/"+postID, body, claims, map[string]string{"id": postID})

	mock.ExpectQuery(`SELECT user_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	handler.UpdatePost(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestUpdatePost_InvalidID(t *testing.T) {
	handler, _ := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	c, w := newPUTContext("/rest/v1/posts/not-a-uuid", body, claims, map[string]string{"id": "not-a-uuid"})

	handler.UpdatePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
