package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"database/sql"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

// Real-looking UUIDs for route parameters. /profiles/:id validates the UUID
// shape (a malformed id answers 404, not a 500 from the uuid cast), so these
// fixtures must not use placeholder strings like "u1" as the route parameter.
const (
	testProfileUUID1       = "550e8400-e29b-41d4-a716-446655440000"
	testProfileUUID2       = "550e8400-e29b-41d4-a716-446655440001"
	testProfileUUIDMissing = "550e8400-e29b-41d4-a716-4466554400ff"
)

// ──────────────────────── privacy batch test helpers ────────────────────────
//
// GetProfiles/GetProfile resolve the whole page's privacy with one batched
// read (privacy.ResolveProfileVisibilityBatch) instead of two queries per row.
// Tests must therefore expect that read, and — only when a signed-in non-owner
// views a private profile or an avatar/stats toggle — the friendships read that
// follows it. ids with no privacy_settings row are public defaults.

const (
	privacyBatchSettingsRe = `SELECT user_id::text, COALESCE\(private_profile, false\),.*FROM privacy_settings WHERE user_id = ANY`
	privacyBatchFriendsRe  = `SELECT user1_id::text, user2_id::text FROM friendships`
)

// privacyBatchRow is one privacy_settings row as the profile list reads it.
type privacyBatchRow struct {
	id         string
	private    bool
	hideAvatar bool
	hideStats  bool
}

// expectPrivacyBatch expects the batched privacy_settings read, returning one
// row per privacyBatchRow. It does not expect the friendships read.
func expectPrivacyBatch(mock sqlmock.Sqlmock, rows ...privacyBatchRow) {
	set := sqlmock.NewRows([]string{"user_id", "private_profile", "private_hide_avatar", "private_hide_stats"})
	for _, r := range rows {
		set.AddRow(r.id, r.private, r.hideAvatar, r.hideStats)
	}
	mock.ExpectQuery(privacyBatchSettingsRe).WithArgs(sqlmock.AnyArg()).WillReturnRows(set)
}

// expectMutualFriends expects the batched friendships read, returning the given
// (viewer, target) pairs. Must follow an expectPrivacyBatch.
func expectMutualFriends(mock sqlmock.Sqlmock, pairs ...[2]string) {
	set := sqlmock.NewRows([]string{"user1_id", "user2_id"})
	for _, p := range pairs {
		set.AddRow(p[0], p[1])
	}
	mock.ExpectQuery(privacyBatchFriendsRe).WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(set)
}

// ──────────────────────────── GetProfiles ────────────────────────────

func TestGetProfiles_Success_NoFilter(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", nil)

	rows := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow("u1", 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080", nil, false, nil, nil,
		100, 10, 2, 3, 7, 25, 5, 777, true, time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	).AddRow("u1", 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080", nil, false, nil, nil,
		100, 10, 2, 3, 7, 25, 5, 777, true, time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	).AddRow("u2", 42, "user2", "user2", nil, "user2@example.com", "localhost:8080", nil, false, nil, nil,
		50, 5, 1, 0, 0, 0, 0, 0, false, nil, time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*ORDER BY created_at DESC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(50, 0).
		WillReturnRows(rows)

	expectPrivacyBatch(mock)

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
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow("550e8400-e29b-41d4-a716-446655440000", 42, "testuser", "testuser", nil, "test@example.com",
		"localhost:8080", nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", 50, 0).
		WillReturnRows(rows)

	expectPrivacyBatch(mock)

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

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id IN \(\$1,\$2\).*ORDER BY created_at DESC.*LIMIT \$3 OFFSET \$4`).
		WithArgs("u1", "u2", 50, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "username", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
			"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
			"is_online", "last_seen_at",
			"created_at", "is_remote", "is_anonymous",
			"background_url", "background_variant", "theme_enabled", "theme_tokens",
			"background_url", "background_variant", "theme_enabled", "theme_tokens",
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
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow("u1", 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.username = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs("testuser", 50, 0).
		WillReturnRows(rows)

	expectPrivacyBatch(mock)

	handler.GetProfiles(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetProfiles_DBError(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", nil)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*`).
		WithArgs(50, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetProfiles(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// TestGetProfiles_BatchPrivacy_NoPerRowQueries is the regression guard for the
// N+1 fix: a page with many profiles must resolve visibility with the single
// batched privacy_settings read, so any extra per-row query would fail the
// mock and turn the request into a 500.
func TestGetProfiles_BatchPrivacy_NoPerRowQueries(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", nil)

	const n = 40
	rows := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	})
	for i := 0; i < n; i++ {
		rows.AddRow(fmt.Sprintf("u%02d", i), 42, "user", "user", nil, "e@example.com", "localhost:8080", nil, false, nil, nil,
			0, 0, 0, 0, 0, 0, 0, 0, false, nil, time.Now(), false, false, nil, "banner", false, nil)
	}

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*ORDER BY created_at DESC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(50, 0).
		WillReturnRows(rows)

	// One batched settings read for all 40 ids — and, the viewer being
	// anonymous, no friendships read at all.
	expectPrivacyBatch(mock)

	handler.GetProfiles(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Count == nil || *resp.Count != n {
		t.Fatalf("expected %d profiles, got %v", n, resp.Count)
	}
}

// ──────────────────────────── GetProfile ────────────────────────────

func TestGetProfile_Success(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	// RecomputeUserProfileStats runs in a goroutine (async, errors ignored),
	// but id=testProfileUUID1 is not a valid UUID, so it won't call RecomputeUserProfileStats.
	// Only the SELECT query is expected.

	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

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
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUIDMissing}}

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUIDMissing).
		WillReturnError(sql.ErrNoRows)

	handler.GetProfile(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetProfile_DBError(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetProfile(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUpdateProfile_InvalidatesAuthorContentCache(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	handler.SetRedis(client)

	// Seed the data cache with keys that embed the author's profile fields
	// (nickname emoji / display name / avatar via a users JOIN).
	seeded := []string{
		"data:/api/v1/threads?id=eq.thread1",                    // author's thread page
		"data:/api/v1/threads?board_id=eq.board1",               // board thread list
		"data:/api/v1/threads?board_id=in.(board1,board2)",      // main-page aggregate feed
		"data:/api/v1/posts?thread_id=eq.thread1",               // thread's post list
		"data:/api/v1/posts?id=eq.post1",                        // author's post page
		"data:/api/v1/profiles?id=eq.u1",                        // profile itself
		"data:/api/v1/profile_wall_posts?user_id=eq.u1",         // own wall
		"data:/api/v1/profile_wall_posts?user_id=eq.wallOwner1", // OTHER user's wall with u1's post
		"data:/api/v1/threads?id=eq.other-thread",               // UNRELATED — must survive
		"data:/api/v1/posts?thread_id=eq.other-thread",          // UNRELATED — must survive
	}
	for _, k := range seeded {
		mr.Set(k, `{"data":[]}`)
	}

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), bio = \$1 WHERE id = \$2`).
		WithArgs("Updated bio!", testProfileUUID1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// invalidateAuthorContentCache: threads + posts authored by u1.
	mock.ExpectQuery(`SELECT id::text.*FROM threads WHERE user_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id"}).AddRow("thread1", "board1"))
	mock.ExpectQuery(`SELECT id::text.*FROM posts WHERE user_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "thread_id"}).AddRow("post1", "thread1"))
	// Wall posts authored by u1 on OTHER users' walls (wallOwner1, wallOwner2).
	mock.ExpectQuery(`SELECT DISTINCT user_id::text.*FROM profile_wall_posts WHERE author_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("wallOwner1").AddRow("wallOwner2"))
	// Wall comments by u1 resolve the wall owner through the commented post.
	mock.ExpectQuery(`(?s).*SELECT DISTINCT wp\.user_id.*FROM profile_wall_post_comments c.*JOIN profile_wall_posts wp.*WHERE c\.user_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("wallOwner1"))

	// GetProfile tail call.
	selectRow := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, "Updated bio!", nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)
	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(selectRow)

	expectPrivacyBatch(mock)

	handler.UpdateProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	// Author-embedded keys must be gone.
	mustBeGone := []string{
		"data:/api/v1/threads?id=eq.thread1",
		"data:/api/v1/threads?board_id=eq.board1",
		"data:/api/v1/threads?board_id=in.(board1,board2)",
		"data:/api/v1/posts?thread_id=eq.thread1",
		"data:/api/v1/posts?id=eq.post1",
		"data:/api/v1/profiles?id=eq." + testProfileUUID1,
		"data:/api/v1/profile_wall_posts?user_id=eq." + testProfileUUID1,
		"data:/api/v1/profile_wall_posts?user_id=eq.wallOwner1", // u1 posted on wallOwner1's wall
	}
	for _, k := range mustBeGone {
		if mr.Exists(k) {
			t.Errorf("cache key %q should have been invalidated after profile update", k)
		}
	}

	// Unrelated keys must survive.
	mustSurvive := []string{
		"data:/api/v1/threads?id=eq.other-thread",
		"data:/api/v1/posts?thread_id=eq.other-thread",
	}
	for _, k := range mustSurvive {
		if !mr.Exists(k) {
			t.Errorf("unrelated cache key %q must survive a profile update", k)
		}
	}
}

func TestUpdateProfile_NoAuthorContent_NothingToInvalidate(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	handler.SetRedis(client)

	mr.Set("data:/api/v1/threads?id=eq.other-thread", `{"data":[]}`)

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), bio = \$1 WHERE id = \$2`).
		WithArgs("Updated bio!", testProfileUUID1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Author has no threads and no posts — both queries return empty rows.
	mock.ExpectQuery(`SELECT id::text.*FROM threads WHERE user_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id"}))
	mock.ExpectQuery(`SELECT id::text.*FROM posts WHERE user_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "thread_id"}))
	mock.ExpectQuery(`SELECT DISTINCT user_id::text.*FROM profile_wall_posts WHERE author_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}))
	mock.ExpectQuery(`(?s).*SELECT DISTINCT wp\.user_id.*FROM profile_wall_post_comments c.*JOIN profile_wall_posts wp.*WHERE c\.user_id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}))

	selectRow := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, "Updated bio!", nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)
	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(selectRow)

	expectPrivacyBatch(mock)

	handler.UpdateProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if !mr.Exists("data:/api/v1/threads?id=eq.other-thread") {
		t.Errorf("unrelated thread cache must survive when the author has no content")
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
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

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
	c, w := newGETContextWithClaims("/api/v1/profiles/u2", nil, &auth.Claims{UserID: testProfileUUID1, Username: "viewer"})
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID2}}

	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID2, 42, "user2", "user2", nil, "user2@example.com", "localhost:8080",
		nil, false, nil, nil, 50, 5, 1, 0, 0, 0, 0, 0, false,
		nil, time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID2).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

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
	c, w := newGETContextWithClaims("/api/v1/profiles/u1", nil, &auth.Claims{UserID: testProfileUUID1, Username: "testuser"})
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

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

func TestGetProfile_ViewsReceivedCountReturned(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

	handler.GetProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	profile := profileFromAPIResponse(t, resp)
	if profile.ViewsReceivedCount == nil || *profile.ViewsReceivedCount != 777 {
		t.Fatalf("expected views_received_count 777, got %v", profile.ViewsReceivedCount)
	}
}

func TestGetProfile_ViewsReceivedCountStrippedForNonFriendOnPrivate(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContextWithClaims("/api/v1/profiles/u1", nil, &auth.Claims{UserID: "viewer-2", Username: "stranger"})
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(row)

	// Private profile with hide_avatar: the batched read returns it, and the
	// viewer is not a friend → profile gets filtered.
	expectPrivacyBatch(mock, privacyBatchRow{id: testProfileUUID1, private: true, hideAvatar: true, hideStats: true})
	expectMutualFriends(mock)

	handler.GetProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	profile := profileFromAPIResponse(t, resp)
	if profile.ViewsReceivedCount != nil {
		t.Fatalf("views_received_count must be stripped for a non-friend on a private profile, got %v", *profile.ViewsReceivedCount)
	}
	if profile.LikesReceivedCount != nil {
		t.Fatalf("likes_received_count must be stripped too, got %v", *profile.LikesReceivedCount)
	}
}

func TestGetProfiles_EmailsHiddenFromAnonymous(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", nil)

	rows := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow("u1", 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080", nil, false, nil, nil,
		100, 10, 2, 3, 7, 25, 5, 777, true, time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	).AddRow("u2", 42, "user2", "user2", nil, "user2@example.com", "localhost:8080", nil, false, nil, nil,
		50, 5, 1, 0, 0, 0, 0, 0, false, nil, time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*ORDER BY created_at DESC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(50, 0).
		WillReturnRows(rows)

	expectPrivacyBatch(mock)

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

// ──────────────────────── background_url via profiles ──────────────────────

func TestGetProfile_ReturnsSanitizedBackgroundURL(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	// The row carries a valid storage key in background_url.
	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, "u1/background_1.webp", "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*LEFT JOIN profile_customization.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

	handler.GetProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	profile := profileFromAPIResponse(t, resp)
	if profile.BackgroundURL == nil || *profile.BackgroundURL != "u1/background_1.webp" {
		t.Fatalf("expected background_url, got %v", profile.BackgroundURL)
	}
}

func TestGetProfile_StripsMaliciousBackgroundURL(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/u1", nil)
	c.Params = []gin.Param{{Key: "id", Value: testProfileUUID1}}

	// A forged row with an absolute URL must never reach the client.
	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, "https://evil.example/tracker.png", "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*LEFT JOIN profile_customization.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

	handler.GetProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	profile := profileFromAPIResponse(t, resp)
	if profile.BackgroundURL != nil {
		t.Fatalf("malicious background_url must be stripped, got %q", *profile.BackgroundURL)
	}
}

// ──────────────────────────── UpdateProfile ────────────────────────────

func TestUpdateProfile_Success_UpdateBio(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	// UPDATE: set updated_at = NOW(), bio = $1 WHERE id = $2
	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), bio = \$1 WHERE id = \$2`).
		WithArgs("Updated bio!", testProfileUUID1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// GetProfile is called at the end — id testProfileUUID1 is not a UUID, so RecomputeUserProfileStats won't fire
	selectRow := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, "Updated bio!", nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)
	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(selectRow)

	expectPrivacyBatch(mock)

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
	c, w := newPUTContext("/api/v1/profiles/u1", body, nil, map[string]string{"id": testProfileUUID1})

	handler.UpdateProfile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestUpdateProfile_Forbidden(t *testing.T) {
	handler, _ := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: testProfileUUID2, Username: "other"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	handler.UpdateProfile(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestUpdateProfile_Success_UpdateAvatar(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	avatarURL := "https://example.com/avatar.png"
	body := map[string]interface{}{
		"avatar_url": avatarURL,
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), avatar_url = \$1 WHERE id = \$2`).
		WithArgs(avatarURL, testProfileUUID1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	selectRow := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		&avatarURL, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)
	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(selectRow)

	expectPrivacyBatch(mock)

	handler.UpdateProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateProfile_DBError(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"bio": "Updated bio!",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), bio = \$1 WHERE id = \$2`).
		WithArgs("Updated bio!", testProfileUUID1).
		WillReturnError(sqlmock.ErrCancelled)

	handler.UpdateProfile(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────── UpdateProfile nickname emoji ──────────────────────

func TestUpdateProfile_Success_SetNicknameEmoji(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "11111111-1111-1111-1111-111111111111",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	// The emoji must exist in custom_emojis before it is persisted.
	mock.ExpectQuery(`(?s).*SELECT EXISTS.*custom_emojis ce.*JOIN emoji_packs ep.*user_emoji_subscriptions.*WHERE ce.id = \$1.*ep.is_public`).
		WithArgs("11111111-1111-1111-1111-111111111111", testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), nickname_emoji_id = \$1 WHERE id = \$2`).
		WithArgs("11111111-1111-1111-1111-111111111111", testProfileUUID1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	selectRow := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(
		testProfileUUID1, 42, "testuser", "testuser", "11111111-1111-1111-1111-111111111111", "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)
	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(selectRow)

	expectPrivacyBatch(mock)

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

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	// An empty string clears the emoji without touching custom_emojis.
	mock.ExpectExec(`UPDATE users SET updated_at = NOW\(\), nickname_emoji_id = NULL WHERE id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	selectRow := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow(
		testProfileUUID1, 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)
	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.id = \$1`).
		WithArgs(testProfileUUID1).
		WillReturnRows(selectRow)

	expectPrivacyBatch(mock)

	handler.UpdateProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUpdateProfile_RejectsUnknownNicknameEmoji(t *testing.T) {
	handler, mock := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "22222222-2222-2222-2222-222222222222",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	mock.ExpectQuery(`(?s).*SELECT EXISTS.*custom_emojis ce.*JOIN emoji_packs ep.*user_emoji_subscriptions.*WHERE ce.id = \$1.*ep.is_public`).
		WithArgs("22222222-2222-2222-2222-222222222222", testProfileUUID1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.UpdateProfile(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateProfile_RejectsMalformedNicknameEmoji(t *testing.T) {
	handler, _ := setupProfilesHandler(t)

	claims := &auth.Claims{UserID: testProfileUUID1, Username: "testuser"}
	body := map[string]interface{}{
		"nickname_emoji_id": "not-a-uuid",
	}
	c, w := newPUTContext("/api/v1/profiles/u1", body, claims, map[string]string{"id": testProfileUUID1})

	// Malformed ids are rejected before any SQL runs.
	handler.UpdateProfile(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── public_id resolution (numeric URL parameters) ───────────────────────────

// TestGetProfile_ByPublicID proves /profiles/42 resolves against users.public_id
// and still returns the payload the frontend needs to build links (public_id).
func TestGetProfile_ByPublicID(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles/42", nil)
	c.Params = []gin.Param{{Key: "id", Value: "42"}}

	row := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow("550e8400-e29b-41d4-a716-446655440000", 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.public_id = \$1`).
		WithArgs(int64(42)).
		WillReturnRows(row)

	expectPrivacyBatch(mock)

	handler.GetProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	profile := profileFromAPIResponse(t, resp)
	if profile.PublicID == nil || *profile.PublicID != 42 {
		t.Fatalf("public_id must round-trip so the client can build links, got %v", profile.PublicID)
	}
}

// TestGetProfiles_PublicIDFilter proves the list endpoint accepts
// ?public_id=eq.42 (the form the frontend uses to resolve a numeric profile URL).
func TestGetProfiles_PublicIDFilter(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", map[string]string{
		"public_id": "eq.42",
	})

	rows := sqlmock.NewRows([]string{
		"id", "public_id", "username", "display_name", "nickname_emoji_id", "email", "domain", "avatar_url", "avatar_animated", "bio", "bio_json",
		"garma", "post_count", "thread_count", "wall_post_count", "comment_count", "likes_received_count", "likes_given_count", "views_received_count",
		"is_online", "last_seen_at",
		"created_at", "is_remote", "is_anonymous",
		"background_url", "background_variant", "theme_enabled", "theme_tokens",
	}).AddRow("550e8400-e29b-41d4-a716-446655440000", 42, "testuser", "testuser", nil, "test@example.com", "localhost:8080",
		nil, false, nil, nil, 100, 10, 2, 3, 7, 25, 5, 777, true,
		time.Now(), time.Now(), false, false, nil, "banner", false, nil,
	)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username.*FROM users.*WHERE u\.public_id = \$1.*ORDER BY created_at DESC.*LIMIT \$2 OFFSET \$3`).
		WithArgs(int64(42), 50, 0).
		WillReturnRows(rows)

	expectPrivacyBatch(mock)

	handler.GetProfiles(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	profiles, ok := resp.Data.([]interface{})
	if !ok || len(profiles) != 1 {
		t.Fatalf("expected 1 profile, got %#v", resp.Data)
	}
}

// TestGetProfiles_PublicIDFilterInvalid is the "typo must not 500" guard: a
// non-numeric public_id is answered with an empty 404, not a bigint cast error.
func TestGetProfiles_PublicIDFilterInvalid(t *testing.T) {
	handler, _ := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/profiles", map[string]string{
		"public_id": "eq.abc",
	})

	handler.GetProfiles(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
