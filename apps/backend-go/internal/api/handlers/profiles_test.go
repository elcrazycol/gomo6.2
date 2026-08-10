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
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080", nil, nil, nil,
		100, 10, 2, true, time.Now(), time.Now(), false, false,
	).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080", nil, nil, nil,
		100, 10, 2, true, time.Now(), time.Now(), false, false,
	).AddRow("u2", "user2", "user2", nil, "user2@example.com", "localhost:8080", nil, nil, nil,
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
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("550e8400-e29b-41d4-a716-446655440000", "testuser", "testuser", nil, "test@example.com",
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
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080",
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
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080",
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

// helper to extract the profile object from an API response.
func profileFromAPIResponse(t *testing.T, resp models.APIResponse) models.User {
	t.Helper()
	raw, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("marshal profile data: %v", err)
	}
	var p models.User
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("unmarshal profile: %v", err)
	}
	return p
}

// ─── Email privacy ──────────────────────────────────────────────────────

func TestGetProfile_EmailHiddenFromAnonymous(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "u1"}}

	row := sqlmock.NewRows([]string{
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080",
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
	profile := profileFromAPIResponse(t, resp)
	if profile.Email != nil {
		t.Fatalf("email must be hidden from anonymous visitors, got %q", *profile.Email)
	}
	if profile.Username != "testuser" {
		t.Fatalf("non-sensitive fields should stay visible, got username %q", profile.Username)
	}
}

func TestGetProfile_OtherUserSeesNoEmail(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContextWithClaims("/api/v1/profiles/u2", nil, &auth.Claims{UserID: "u1", Username: "viewer"})
	c.Params = []gin.Param{{Key: "id", Value: "u2"}}

	row := sqlmock.NewRows([]string{
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u2", "user2", "user2", nil, "user2@example.com", "localhost:8080",
		nil, nil, nil, 50, 5, 1, false,
		nil, time.Now(), false, false,
	)

	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1`).
		WithArgs("u2").
		WillReturnRows(row)

	handler.GetProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	profile := profileFromAPIResponse(t, resp)
	if profile.Email != nil {
		t.Fatalf("other users must not see the email, got %q", *profile.Email)
	}
}

func TestGetProfile_OwnerSeesEmail(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContextWithClaims("/api/v1/profiles/u1", nil, &auth.Claims{UserID: "u1", Username: "testuser"})
	c.Params = []gin.Param{{Key: "id", Value: "u1"}}

	row := sqlmock.NewRows([]string{
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080",
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
	profile := profileFromAPIResponse(t, resp)
	if profile.Email == nil || *profile.Email != "test@example.com" {
		t.Fatalf("profile owner should see their own email, got %v", profile.Email)
	}
}

func TestGetProfiles_EmailsHiddenFromAnonymous(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", nil)

	rows := sqlmock.NewRows([]string{
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080", nil, nil, nil,
		100, 10, 2, true, time.Now(), time.Now(), false, false,
	).AddRow("u2", "user2", "user2", nil, "user2@example.com", "localhost:8080", nil, nil, nil,
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
	raw, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("marshal profiles data: %v", err)
	}
	var profiles []models.User
	if err := json.Unmarshal(raw, &profiles); err != nil {
		t.Fatalf("unmarshal profiles: %v", err)
	}
	for _, p := range profiles {
		if p.Email != nil {
			t.Fatalf("email must be hidden from anonymous visitors, got %q for %s", *p.Email, p.ID)
		}
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
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080",
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
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow("u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080",
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

// ──────────────────────── UpdateProfile nickname emoji ──────────────────────

func TestUpdateProfile_Success_SetNicknameEmoji(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "11111111-1111-1111-1111-111111111111",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	// The emoji must exist in custom_emojis before it is persisted.
	mock.ExpectQuery(`(?s).*SELECT EXISTS.*custom_emojis ce.*JOIN emoji_packs ep.*user_emoji_subscriptions.*WHERE ce.id = \$1.*ep.is_public`).
		WithArgs("11111111-1111-1111-1111-111111111111", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), nickname_emoji_id = \$1 WHERE id = \$2`).
		WithArgs("11111111-1111-1111-1111-111111111111", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	selectRow := sqlmock.NewRows([]string{
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"u1", "testuser", "testuser", "11111111-1111-1111-1111-111111111111", "test@example.com", "localhost:8080",
		nil, nil, nil, 100, 10, 2, true,
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
	profile := profileFromAPIResponse(t, resp)
	if profile.NicknameEmojiID == nil || *profile.NicknameEmojiID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("expected nickname_emoji_id to be set, got %v", profile.NicknameEmojiID)
	}
}

func TestUpdateProfile_Success_ClearNicknameEmoji(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	// An empty string clears the emoji without touching custom_emojis.
	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), nickname_emoji_id = NULL WHERE id = \$1`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	selectRow := sqlmock.NewRows([]string{
		"id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "bio", "bio_json",
		"garma", "post_count", "thread_count", "is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
	}).AddRow(
		"u1", "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, nil, nil, 100, 10, 2, true,
		time.Now(), time.Now(), false, false,
	)
	mock.ExpectQuery(`SELECT id, username.*FROM users.*WHERE id = \$1`).
		WithArgs("u1").
		WillReturnRows(selectRow)

	handler.UpdateProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUpdateProfile_RejectsUnknownNicknameEmoji(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "22222222-2222-2222-2222-222222222222",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	mock.ExpectQuery(`(?s).*SELECT EXISTS.*custom_emojis ce.*JOIN emoji_packs ep.*user_emoji_subscriptions.*WHERE ce.id = \$1.*ep.is_public`).
		WithArgs("22222222-2222-2222-2222-222222222222", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.UpdateProfile(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateProfile_RejectsMalformedNicknameEmoji(t *testing.T) {
	handler, _ := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "not-a-uuid",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": "u1"})

	// Malformed ids are rejected before any SQL runs.
	handler.UpdateProfile(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
