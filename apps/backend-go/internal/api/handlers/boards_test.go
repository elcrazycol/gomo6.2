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

// ──────────────────────────── GetBoards ────────────────────────────

func TestGetBoards_Success_NoFilter(t *testing.T) {
	handler, mock := setupBoardsHandler(t)
	c, w := newGETContext("/rest/v1/boards", nil)

	rows := sqlmock.NewRows([]string{
		"id", "slug", "name", "description", "is_gomosub", "is_rules_board",
		"owner_id", "gomosub_avatar_url", "cover_image_url", "gomosub_tags",
		"rules_markdown", "rules_updated_at", "created_at",
	}).AddRow(
		"b1", "general", "General", "General discussion", false, false,
		"u1", nil, nil, "[]", nil, nil, time.Now(),
	).AddRow(
		"b2", "random", "Random", "Random stuff", true, false,
		"u2", nil, nil, `["tag1"]`, nil, nil, time.Now(),
	)

	mock.ExpectQuery(`SELECT id, slug.*FROM boards.*ORDER BY created_at DESC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(50, 0).
		WillReturnRows(rows)

	handler.GetBoards(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.SupabaseResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetBoards_Success_SlugFilter(t *testing.T) {
	handler, mock := setupBoardsHandler(t)
	c, w := newGETContext("/rest/v1/boards", map[string]string{
		"slug": "eq.general",
	})

	rows := sqlmock.NewRows([]string{
		"id", "slug", "name", "description", "is_gomosub", "is_rules_board",
		"owner_id", "gomosub_avatar_url", "cover_image_url", "gomosub_tags",
		"rules_markdown", "rules_updated_at", "created_at",
	}).AddRow(
		"b1", "general", "General", nil, false, false,
		nil, nil, nil, "[]", nil, nil, time.Now(),
	)

	mock.ExpectQuery(`SELECT id, slug.*FROM boards.*WHERE slug = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("general", 50, 0).
		WillReturnRows(rows)

	handler.GetBoards(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetBoards_Success_IsGomosubFilter(t *testing.T) {
	handler, mock := setupBoardsHandler(t)
	c, w := newGETContext("/rest/v1/boards", map[string]string{
		"is_gomosub": "eq.true",
	})

	mock.ExpectQuery(`SELECT id, slug.*FROM boards.*WHERE is_gomosub = \$1.*`).
		WithArgs(true, 50, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "name", "description", "is_gomosub", "is_rules_board",
			"owner_id", "gomosub_avatar_url", "cover_image_url", "gomosub_tags",
			"rules_markdown", "rules_updated_at", "created_at",
		}))

	handler.GetBoards(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetBoards_DBError(t *testing.T) {
	handler, mock := setupBoardsHandler(t)
	c, w := newGETContext("/rest/v1/boards", nil)

	mock.ExpectQuery(`SELECT id, slug.*FROM boards.*`).
		WithArgs(50, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetBoards(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── GetBoard ────────────────────────────

func TestGetBoard_Success(t *testing.T) {
	handler, mock := setupBoardsHandler(t)
	c, w := newGETContext("/rest/v1/boards/general", nil)
	c.Params = []gin.Param{{Key: "slug", Value: "general"}}

	row := sqlmock.NewRows([]string{
		"id", "slug", "name", "description", "is_gomosub", "is_rules_board",
		"owner_id", "gomosub_avatar_url", "cover_image_url", "gomosub_tags",
		"rules_markdown", "rules_updated_at", "created_at",
	}).AddRow(
		"b1", "general", "General", "Discussion", false, false,
		"u1", nil, nil, "[]", nil, nil, time.Now(),
	)

	mock.ExpectQuery(`SELECT id, slug.*FROM boards.*WHERE slug = \$1`).
		WithArgs("general").
		WillReturnRows(row)

	handler.GetBoard(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.SupabaseResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetBoard_NotFound(t *testing.T) {
	handler, mock := setupBoardsHandler(t)
	c, w := newGETContext("/rest/v1/boards/unknown", nil)
	c.Params = []gin.Param{{Key: "slug", Value: "unknown"}}

	mock.ExpectQuery(`SELECT id, slug.*FROM boards.*WHERE slug = \$1`).
		WithArgs("unknown").
		WillReturnError(sql.ErrNoRows)

	handler.GetBoard(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetBoard_DBError(t *testing.T) {
	handler, mock := setupBoardsHandler(t)
	c, w := newGETContext("/rest/v1/boards/general", nil)
	c.Params = []gin.Param{{Key: "slug", Value: "general"}}

	mock.ExpectQuery(`SELECT id, slug.*FROM boards.*WHERE slug = \$1`).
		WithArgs("general").
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetBoard(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── CreateBoard ────────────────────────────

func TestCreateBoard_Success(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "admin"}
	body := map[string]interface{}{
		"slug":        "new-board",
		"name":        "New Board",
		"description": "A brand new board",
		"is_gomosub":  false,
	}
	c, w := newPOSTContext("/rest/v1/boards", body, claims, nil)

	insertRow := sqlmock.NewRows([]string{
		"id", "slug", "name", "description", "is_gomosub", "is_rules_board",
		"owner_id", "gomosub_avatar_url", "cover_image_url", "gomosub_tags", "created_at",
	}).AddRow(
		"b-new", "new-board", "New Board", "A brand new board", false, false,
		"u1", nil, nil, "[]", time.Now(),
	)

	mock.ExpectQuery(`INSERT INTO boards.*VALUES.*RETURNING`).
		WithArgs("new-board", "New Board", "A brand new board", false, false,
			"u1", nil, nil, sqlmock.AnyArg()).
		WillReturnRows(insertRow)

	handler.CreateBoard(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.SupabaseResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestCreateBoard_Unauthenticated(t *testing.T) {
	handler, _ := setupBoardsHandler(t)

	body := map[string]interface{}{
		"slug": "new-board",
		"name": "New Board",
	}
	c, w := newPOSTContext("/rest/v1/boards", body, nil, nil)

	handler.CreateBoard(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestCreateBoard_DBError(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "admin"}
	body := map[string]interface{}{
		"slug": "new-board",
		"name": "New Board",
	}
	c, w := newPOSTContext("/rest/v1/boards", body, claims, nil)

	mock.ExpectQuery(`INSERT INTO boards.*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnError(sqlmock.ErrCancelled)

	handler.CreateBoard(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── UpdateBoard ────────────────────────────

func TestUpdateBoard_Success_UpdateName(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "admin"}
	body := map[string]interface{}{
		"name": "Updated Name",
	}
	boardID := "b1"
	c, w := newPUTContext("/rest/v1/boards/"+boardID, body, claims, map[string]string{"id": boardID})

	// Check ownership
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	// Dynamic UPDATE: SET name = $1 WHERE id = $2
	mock.ExpectExec(`UPDATE boards SET name = \$1 WHERE id = \$2`).
		WithArgs("Updated Name", boardID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Re-fetch after update
	fetchRow := sqlmock.NewRows([]string{
		"id", "slug", "name", "description", "is_gomosub", "is_rules_board",
		"owner_id", "gomosub_avatar_url", "cover_image_url", "gomosub_tags",
		"rules_markdown", "rules_updated_at", "created_at",
	}).AddRow(
		boardID, "test", "Updated Name", nil, false, false,
		"u1", nil, nil, "[]", nil, nil, time.Now(),
	)
	mock.ExpectQuery(`SELECT id, slug.*FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(fetchRow)

	handler.UpdateBoard(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.SupabaseResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestUpdateBoard_NotFound(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "admin"}
	body := map[string]interface{}{
		"name": "Updated Name",
	}
	boardID := "b1"
	c, w := newPUTContext("/rest/v1/boards/"+boardID, body, claims, map[string]string{"id": boardID})

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnError(sql.ErrNoRows)

	handler.UpdateBoard(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdateBoard_Forbidden(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	claims := &auth.Claims{UserID: "u2", Username: "other"}
	body := map[string]interface{}{
		"name": "Updated Name",
	}
	boardID := "b1"
	c, w := newPUTContext("/rest/v1/boards/"+boardID, body, claims, map[string]string{"id": boardID})

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	handler.UpdateBoard(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestUpdateBoard_NoFields(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "admin"}
	body := map[string]interface{}{}
	boardID := "b1"
	c, w := newPUTContext("/rest/v1/boards/"+boardID, body, claims, map[string]string{"id": boardID})

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	handler.UpdateBoard(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateBoard_Unauthenticated(t *testing.T) {
	handler, _ := setupBoardsHandler(t)

	body := map[string]interface{}{
		"name": "Updated",
	}
	boardID := "b1"
	c, w := newPUTContext("/rest/v1/boards/"+boardID, body, nil, map[string]string{"id": boardID})

	handler.UpdateBoard(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestUpdateBoard_DBErrorUpdate(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "admin"}
	body := map[string]interface{}{
		"name": "Updated Name",
	}
	boardID := "b1"
	c, w := newPUTContext("/rest/v1/boards/"+boardID, body, claims, map[string]string{"id": boardID})

	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("u1"))

	mock.ExpectExec(`UPDATE boards SET name = \$1 WHERE id = \$2`).
		WithArgs("Updated Name", boardID).
		WillReturnError(sqlmock.ErrCancelled)

	handler.UpdateBoard(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
