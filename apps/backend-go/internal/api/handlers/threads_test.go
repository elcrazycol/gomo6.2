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
		"id", "board_id", "channel_id", "user_id", "title", "content", "content_json",
		"image_url", "image_urls", "attachments", "tags", "post_count", "server_domain",
		"created_at", "updated_at", "is_remote", "username", "avatar_url", "is_anonymous",
		"display_name", "nickname_emoji_id",
		"board_slug", "board_name", "board_is_gomosub", "board_is_rules_board",
	}).AddRow(
		"t1", "b1", nil, "u1", "Thread Title", "Thread content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "testuser", nil, false, nil, nil,
		"general", "General", false, false,
	).AddRow(
		"t2", "b2", nil, "u2", "Another Thread", "More content", nil,
		nil, "[]", "[]", "[]", 3, "localhost:8080",
		time.Now(), time.Now(), false, "user2", nil, false, nil, nil,
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
		"id", "board_id", "channel_id", "user_id", "title", "content", "content_json",
		"image_url", "image_urls", "attachments", "tags", "post_count", "server_domain",
		"created_at", "updated_at", "is_remote", "username", "avatar_url", "is_anonymous",
		"display_name", "nickname_emoji_id",
		"board_slug", "board_name", "board_is_gomosub", "board_is_rules_board",
	}).AddRow(
		"t1", "b1", nil, "u1", "Thread Title", "Thread content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "testuser", nil, false, nil, nil,
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

// ──────────────────── GetThreads: private-profile privacy ────────────────────

// threadRowColumns lists the SELECT columns of the GetThreads query in order.
var threadRowColumns = []string{
	"id", "board_id", "channel_id", "user_id", "title", "content", "content_json",
	"image_url", "image_urls", "attachments", "tags", "post_count", "server_domain",
	"created_at", "updated_at", "is_remote", "username", "avatar_url", "is_anonymous",
	"display_name", "nickname_emoji_id",
	"board_slug", "board_name", "board_is_gomosub", "board_is_rules_board",
}

func privacySettingsRow(privateProfile bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"private_profile", "private_hide_avatar", "private_hide_wall",
		"private_hide_threads", "private_hide_stats", "private_hide_friends",
		"private_hide_gifts", "private_hide_achievements",
	}).AddRow(privateProfile, false, false, true, false, true, true, true)
}

// TestGetThreads_PrivateProfile_NonFriend_GetsEmpty guards the privacy gate in
// GetThreads: a stranger asking for the threads of a private-profile user must
// receive an empty list (200, no rows) — not their thread content.
func TestGetThreads_PrivateProfile_NonFriend_GetsEmpty(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContextWithClaims("/api/v1/threads?user_id=eq.privateUser", nil, &auth.Claims{UserID: "stranger"})

	// GetPrivacySettings: private_profile = true.
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\).*FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("privateUser").
		WillReturnRows(privacySettingsRow(true))

	// Not a mutual friend → CanViewUserContent=false → empty response.
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("stranger", "privateUser").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.GetThreads(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	threads, ok := resp.Data.([]interface{})
	if !ok || len(threads) != 0 {
		t.Fatalf("expected an empty thread list, got %#v", resp.Data)
	}
	if resp.Count == nil || *resp.Count != 0 {
		t.Fatalf("expected count 0, got %v", resp.Count)
	}
}

// TestGetThreads_PrivateProfile_MutualFriend_SeesThreads guards against
// over-blocking: a mutual friend of the private-profile user still gets the
// thread list.
func TestGetThreads_PrivateProfile_MutualFriend_SeesThreads(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContextWithClaims("/api/v1/threads?user_id=eq.privateUser", nil, &auth.Claims{UserID: "friend"})

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\).*FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("privateUser").
		WillReturnRows(privacySettingsRow(true))

	// Mutual friend → CanViewUserContent=true → the thread query runs.
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("friend", "privateUser").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	rows := sqlmock.NewRows(threadRowColumns).AddRow(
		"t1", "b1", nil, "privateUser", "Thread Title", "Thread content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "privateuser", nil, false, nil, nil,
		"general", "General", false, false,
	)

	// user_id filter ($1) + private-board filter ($2, $3) + LIMIT/OFFSET ($4, $5).
	mock.ExpectQuery(`SELECT t\.id.*FROM threads t.*WHERE t\.user_id = \$1.*ORDER BY t\.updated_at DESC.*LIMIT \$4 OFFSET \$5`).
		WithArgs("privateUser", "friend", "friend", 50, 0).
		WillReturnRows(rows)

	handler.GetThreads(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	threads, ok := resp.Data.([]interface{})
	if !ok || len(threads) != 1 {
		t.Fatalf("expected 1 thread, got %#v", resp.Data)
	}
}

// TestGetThreads_PublicProfile_AnyViewerSeesThreads guards that a public
// profile's threads remain readable by everyone (the privacy gate must only
// block private profiles).
func TestGetThreads_PublicProfile_AnyViewerSeesThreads(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContextWithClaims("/api/v1/threads?user_id=eq.publicUser", nil, &auth.Claims{UserID: "viewer"})

	// GetPrivacySettings: private_profile = false → no friendship check needed.
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\).*FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("publicUser").
		WillReturnRows(privacySettingsRow(false))

	rows := sqlmock.NewRows(threadRowColumns).AddRow(
		"t1", "b1", nil, "publicUser", "Thread Title", "Thread content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "publicuser", nil, false, nil, nil,
		"general", "General", false, false,
	)

	mock.ExpectQuery(`SELECT t\.id.*FROM threads t.*WHERE t\.user_id = \$1.*ORDER BY t\.updated_at DESC.*LIMIT \$4 OFFSET \$5`).
		WithArgs("publicUser", "viewer", "viewer", 50, 0).
		WillReturnRows(rows)

	handler.GetThreads(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	threads, ok := resp.Data.([]interface{})
	if !ok || len(threads) != 1 {
		t.Fatalf("expected 1 thread, got %#v", resp.Data)
	}
}

// ──────────────────────────── GetThread ────────────────────────────

func TestGetThread_Success(t *testing.T) {
	handler, mock := setupThreadsHandler(t)
	c, w := newGETContext("/api/v1/threads/550e8400-e29b-41d4-a716-446655440000", nil)
	c.Params = []gin.Param{{Key: "id", Value: "550e8400-e29b-41d4-a716-446655440000"}}

	row := sqlmock.NewRows([]string{
		"id", "board_id", "channel_id", "user_id", "title", "content", "content_json",
		"image_url", "image_urls", "attachments", "tags", "post_count", "server_domain",
		"created_at", "updated_at", "is_remote", "username", "avatar_url", "is_anonymous",
		"display_name", "nickname_emoji_id",
		"board_slug", "board_name", "board_is_gomosub", "board_is_rules_board",
	}).AddRow(
		"550e8400-e29b-41d4-a716-446655440000", "b1", nil, "u1", "Thread Title", "Content", nil,
		nil, "[]", "[]", "[]", 5, "localhost:8080",
		time.Now(), time.Now(), false, "testuser", nil, false, nil, nil,
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
