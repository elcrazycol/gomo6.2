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

// ──────────────────────────── GetThreads ────────────────────────────

func TestGetThreads_Success_NoFilter(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContext("/api/v1/threads", nil)

	rows := sqlmock.NewRows([]string{
		"id", "board_id", "user_id", "title", "content", "content_json",
		"image_url", "image_urls", "attachments", "tags", "post_count", "server_domain",
		"created_at", "updated_at", "is_remote", "username", "avatar_url",
		"board_slug", "board_name", "board_is_gomosub", "board_is_rules_board",
	}).AddRow(
		"t1", "b1", "u1", "Thread Title", "Thread content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "testuser", nil,
		"general", "General", false, false,
	).AddRow(
		"t2", "b2", "u2", "Another Thread", "More content", nil,
		nil, "[]", "[]", "[]", 3, "localhost:8080",
		time.Now(), time.Now(), false, "user2", nil,
		"random", "Random", true, false,
	)

	mock.ExpectQuery(`SELECT t\.id.*FROM threads t.*ORDER BY t\.updated_at DESC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(50, 0).
		WillReturnRows(rows)

	handler.GetThreads(c)

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

func TestGetThreads_Success_WithBoardFilter(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContext("/api/v1/threads", map[string]string{
		"board_id": "eq.b1",
	})

	rows := sqlmock.NewRows([]string{
		"id", "board_id", "user_id", "title", "content", "content_json",
		"image_url", "image_urls", "attachments", "tags", "post_count", "server_domain",
		"created_at", "updated_at", "is_remote", "username", "avatar_url",
		"board_slug", "board_name", "board_is_gomosub", "board_is_rules_board",
	}).AddRow(
		"t1", "b1", "u1", "Thread Title", "Thread content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "testuser", nil,
		"general", "General", false, false,
	)

	mock.ExpectQuery(`SELECT t\.id.*FROM threads t.*WHERE t\.board_id = \$1.*ORDER BY t\.updated_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("b1", 50, 0).
		WillReturnRows(rows)

	handler.GetThreads(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetThreads_DBError(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContext("/api/v1/threads", nil)

	mock.ExpectQuery(`SELECT t\.id.*FROM threads t.*`).
		WithArgs(50, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetThreads(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── GetThread ────────────────────────────

func TestGetThread_Success(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContext("/api/v1/threads/550e8400-e29b-41d4-a716-446655440000", nil)
	c.Params = []gin.Param{{Key: "id", Value: "550e8400-e29b-41d4-a716-446655440000"}}

	row := sqlmock.NewRows([]string{
		"id", "board_id", "user_id", "title", "content", "content_json",
		"image_url", "image_urls", "attachments", "tags", "post_count", "server_domain",
		"created_at", "updated_at", "is_remote", "username", "avatar_url",
		"board_slug", "board_name", "board_is_gomosub", "board_is_rules_board",
	}).AddRow(
		"550e8400-e29b-41d4-a716-446655440000", "b1", "u1", "Thread Title", "Content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "testuser", nil,
		"general", "General", false, false,
	)

	mock.ExpectQuery(`SELECT t\.id.*FROM threads t.*WHERE t\.id = \$1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").
		WillReturnRows(row)

	handler.GetThread(c)

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

func TestGetThread_NotFound(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContext("/api/v1/threads/550e8400-e29b-41d4-a716-446655440000", nil)
	c.Params = []gin.Param{{Key: "id", Value: "550e8400-e29b-41d4-a716-446655440000"}}

	mock.ExpectQuery(`SELECT t\.id.*FROM threads t.*WHERE t\.id = \$1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").
		WillReturnError(sql.ErrNoRows)

	handler.GetThread(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetThread_InvalidUUID(t *testing.T) {
	handler, _ := setupThreadsHandler(t)
	c, w := newGETContext("/api/v1/threads/not-a-uuid", nil)
	c.Params = []gin.Param{{Key: "id", Value: "not-a-uuid"}}

	handler.GetThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ──────────────────────────── DeleteThread ────────────────────────────

func TestDeleteThread_Success(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newDELETEPContext("/api/v1/threads/t1", nil, nil)
	c.Params = []gin.Param{{Key: "id", Value: "t1"}}

	// Get owner
	mock.ExpectQuery(`SELECT user_id FROM threads WHERE id = \$1`).
		WithArgs("t1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	// Delete thread
	mock.ExpectExec(`DELETE FROM threads WHERE id = \$1`).
		WithArgs("t1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.DeleteThread(c)

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

func TestDeleteThread_NotFound(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newDELETEPContext("/api/v1/threads/t1", nil, nil)
	c.Params = []gin.Param{{Key: "id", Value: "t1"}}

	mock.ExpectQuery(`SELECT user_id FROM threads WHERE id = \$1`).
		WithArgs("t1").
		WillReturnError(sql.ErrNoRows)

	handler.DeleteThread(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeleteThread_EmptyID(t *testing.T) {
	handler, _ := setupThreadsHandler(t)
	// No id in path and no id in query
	c, w := newDELETEPContext("/api/v1/threads", nil, nil)

	handler.DeleteThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ──────────────────────────── UpdateThread ────────────────────────────

func TestUpdateThread_Success(t *testing.T) {
	handler, mock := setupThreadsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	threadID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/api/v1/threads/"+threadID, body, claims, map[string]string{"id": threadID})

	// Check ownership
	mock.ExpectQuery(`SELECT user_id FROM threads WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	// Update
	updateRow := sqlmock.NewRows([]string{
		"id", "board_id", "user_id", "title", "content", "content_json",
		"image_url", "image_urls", "post_count", "server_domain",
		"created_at", "updated_at", "is_remote",
	}).AddRow(
		threadID, "b1", "u1", "Thread Title", "Updated content!", nil,
		nil, "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false,
	)

	mock.ExpectQuery(`UPDATE threads SET content.*updated_at = NOW\(\).*WHERE id = \$[0-9]+.*RETURNING`).
		WithArgs("Updated content!", nil, threadID).
		WillReturnRows(updateRow)

	handler.UpdateThread(c)

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

func TestUpdateThread_NotFound(t *testing.T) {
	handler, mock := setupThreadsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	threadID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/api/v1/threads/"+threadID, body, claims, map[string]string{"id": threadID})

	mock.ExpectQuery(`SELECT user_id FROM threads WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnError(sql.ErrNoRows)

	handler.UpdateThread(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdateThread_Forbidden(t *testing.T) {
	handler, mock := setupThreadsHandler(t)

	claims := &auth.Claims{UserID: "u2", Username: "otheruser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	threadID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/api/v1/threads/"+threadID, body, claims, map[string]string{"id": threadID})

	mock.ExpectQuery(`SELECT user_id FROM threads WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	handler.UpdateThread(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestUpdateThread_InvalidID(t *testing.T) {
	handler, _ := setupThreadsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	c, w := newPUTContext("/api/v1/threads/not-a-uuid", body, claims, map[string]string{"id": "not-a-uuid"})

	handler.UpdateThread(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
