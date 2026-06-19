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

// ──────────────────────────── GetProfiles ────────────────────────────

func TestGetProfiles_Success_NoFilter(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", nil)

	rows := sqlmock.NewRows([]string{
		"id", "username", "display_name", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"u1", "testuser", "testuser", "test@example.com", "localhost:8080", nil, nil, nil,
		100, 10, 2, true, time.Now(), time.Now(), false, false,
	).AddRow(
		"u1", "testuser", "testuser", "test@example.com", "localhost:8080", nil, nil, nil,
		100, 10, 2, true, time.Now(), time.Now(), false, false,
	).AddRow(
		"u2", "user2", "user2", "user2@example.com", "localhost:8080", nil, nil, nil,
		50, 5, 1, false, nil, time.Now(), false, false,
	)

	mock.ExpectQuery(`SELECT id, username.*FROM users.*ORDER BY created_at DESC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(50, 0).
		WillReturnRows(rows)

	handler.GetProfiles(c)

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

func TestGetProfiles_Success_IDFilter(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", map[string]string{
		"id": "eq.550e8400-e29b-41d4-a716-446655440000",
	})

	rows := sqlmock.NewRows([]string{
		"id", "username", "display_name", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"550e8400-e29b-41d4-a716-446655440000", "testuser", "testuser", "test@example.com",
		"localhost:8080", nil, nil, nil, 100, 10, 2, true,
		time.Now(), time.Now(), false, false,
	)

	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", 50, 0).
		WillReturnRows(rows)

	handler.GetProfiles(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetProfiles_Success_IDInFilter(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", map[string]string{
		"id": "in.(u1,u2)",
	})

	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id IN \(\$1,\$2\).*ORDER BY created_at DESC.*LIMIT \$3 OFFSET \$4`).
		WithArgs("u1", "u2", 50, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "email", "domain", "avatar_url", "bio", "bio_json",
			"garma", "post_count", "thread_count", "is_online", "last_seen_at",
			"created_at", "is_remote", "is_anonymous",
		}))

	handler.GetProfiles(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetProfiles_Success_UsernameFilter(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", map[string]string{
		"username": "eq.testuser",
	})

	rows := sqlmock.NewRows([]string{
		"id", "username", "display_name", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"u1", "testuser", "testuser", "test@example.com", "localhost:8080",
		nil, nil, nil, 100, 10, 2, true,
		time.Now(), time.Now(), false, false,
	)

	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE username = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("testuser", 50, 0).
		WillReturnRows(rows)

	handler.GetProfiles(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetProfiles_DBError(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", nil)

	mock.ExpectQuery(`SELECT id, username.*FROM users.*`).
		WithArgs(50, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetProfiles(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── GetProfile ────────────────────────────

func TestGetProfile_Success(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "u1"}}

	// RecomputeUserProfileStats runs in a goroutine (async, errors ignored),
	// but id="u1" is not a valid UUID, so it won't call RecomputeUserProfileStats.
	// Only the SELECT query is expected.

	row := sqlmock.NewRows([]string{
		"id", "username", "display_name", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"u1", "testuser", "testuser", "test@example.com", "localhost:8080",
		nil, nil, nil, 100, 10, 2, true,
		time.Now(), time.Now(), false, false,
	)

	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1`).
		WithArgs("u1").
		WillReturnRows(row)

	handler.GetProfile(c)

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

func TestGetProfile_NotFound(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/unknown", nil)
	c.Params = []gin.Param{{Key: "id", Value: "unknown"}}

	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1`).
		WithArgs("unknown").
		WillReturnError(sql.ErrNoRows)

	handler.GetProfile(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetProfile_DBError(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "u1"}}

	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetProfile(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── UpdateProfile ────────────────────────────

func TestUpdateProfile_Success_UpdateBio(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	// UPDATE: set updated_at = NOW(), bio = $1 WHERE id = $2
	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), bio = \$1 WHERE id = \$2`).
		WithArgs("Updated bio!", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	// GetProfile is called at the end — id "u1" is not a UUID, so RecomputeUserProfileStats won't fire
	selectRow := sqlmock.NewRows([]string{
		"id", "username", "display_name", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"u1", "testuser", "testuser", "test@example.com", "localhost:8080",
		nil, "Updated bio!", nil, 100, 10, 2, true,
		time.Now(), time.Now(), false, false,
	)
	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1`).
		WithArgs("u1").
		WillReturnRows(selectRow)

	handler.UpdateProfile(c)

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

func TestUpdateProfile_Unauthenticated(t *testing.T) {
	handler, _ := setupProfilesHandler(t)

	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, nil, map[string]string{"id": "u1"})

	handler.UpdateProfile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestUpdateProfile_Forbidden(t *testing.T) {
	handler, _ := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u2", Username: "other"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	handler.UpdateProfile(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestUpdateProfile_Success_UpdateAvatar(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	avatarURL := "https://example.com/avatar.png"
	body := map[string]interface{}{
		"avatar_url": avatarURL,
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), avatar_url = \$1 WHERE id = \$2`).
		WithArgs(avatarURL, "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	selectRow := sqlmock.NewRows([]string{
		"id", "username", "display_name", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"u1", "testuser", "testuser", "test@example.com", "localhost:8080",
		&avatarURL, nil, nil, 100, 10, 2, true,
		time.Now(), time.Now(), false, false,
	)
	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1`).
		WithArgs("u1").
		WillReturnRows(selectRow)

	handler.UpdateProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateProfile_DBError(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), bio = \$1 WHERE id = \$2`).
		WithArgs("Updated bio!", "u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.UpdateProfile(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
