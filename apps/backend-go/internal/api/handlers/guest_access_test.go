package handlers

import (
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── Guest access: profile walls ────────────────────────────────────────────

// Anonymous visitors must be able to read walls of public profiles. The
// visibility predicate is applied with SQL NULL for the viewer reference (an
// empty string would fail the uuid cast in the count subqueries), so the query
// itself still enforces private walls.
func TestHandleProfileWallPostsGet_Anonymous_ReadsPublicWall(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*` +
		`COALESCE\(ps\.private_profile, false\) = false AND COALESCE\(ps\.private_hide_wall, false\) = false.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "Hello", "World", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?user_id=eq.u1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	data, ok := resp.Data.([]interface{})
	if !ok || len(data) != 1 {
		t.Fatalf("expected 1 wall post for anonymous visitor, got %v", resp.Data)
	}
}

// The anonymous predicate must reference the viewer as SQL NULL, not as an
// empty-string parameter — an empty value cannot be cast to uuid in the count
// subqueries (that produced a 500 on production). Guards the SQL from breaking
// when the caller has no session.
func TestHandleProfileWallPostsGet_Anonymous_PredicateUsesNullViewer(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*FROM profile_wall_posts p.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}))

	// No user_id filter: no args at all — the viewer reference is literal NULL.
	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// Regression for the production 500: a guest fetching a public profile's wall
// with a real UUID filter and the profile page's sort order must not break on
// the viewer reference (empty string cannot cast to uuid). The count subqueries
// must use literal NULL for the viewer so the whole statement stays valid.
func TestHandleProfileWallPostsGet_Anonymous_UUIDFilterWithOrder_No500(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Real UUIDs + the exact profile-page order from ProfileWall.tsx. The
	// {viewer} placeholders in the count subqueries are replaced with NULL
	// (never an empty $n), so only the uuid filter is bound as a parameter.
	// The {viewer} placeholders live in the SELECT list (before FROM) — check
	// them separately from the FROM/WHERE/ORDER parts. `\.` is the escaped-dot
	// regex for the quoted identifier "p"."is_pinned".
	mock.ExpectQuery(`(?s)SELECT p\.id.*liked_by_viewer.*NULL.*my_repost_record_id.*NULL.*FROM profile_wall_posts p.*` +
		`ORDER BY "p"\."is_pinned" DESC, "p"\."pinned_order" ASC, "p"\."created_at" DESC`).
		WithArgs("457e56d5-4f7b-43ee-b506-09299332541a").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "457e56d5-4f7b-43ee-b506-09299332541a", "457e56d5-4f7b-43ee-b506-09299332541a", "Hello", "World", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET",
		"/api/v1/profile_wall_posts?user_id=eq.457e56d5-4f7b-43ee-b506-09299332541a&order=is_pinned.desc,pinned_order.asc,created_at.desc",
		nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	data, ok := resp.Data.([]interface{})
	if !ok || len(data) != 1 {
		t.Fatalf("expected 1 wall post, got %v", resp.Data)
	}
}

// ─── Guest access: achievements ─────────────────────────────────────────────

// Anonymous caller without a user_id filter must get an empty result instead of
// enumerating every user's achievements (no DB query, no 401).
func TestHandleUserAchievementsGet_Anonymous_WithoutUserID_ReturnsEmpty(t *testing.T) {
	h, _ := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/user_achievements", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Data == nil || len(resp.Data) != 0 {
		t.Fatalf("expected empty achievements for anonymous without filter, got %v", resp.Data)
	}
}

// Anonymous visitor reading the achievements of a PUBLIC profile: privacy check
// passes, achievements are returned.
func TestHandleUserAchievementsGet_Anonymous_ReadsPublicProfile(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// Privacy settings lookup — public profile, achievements not hidden.
	mock.ExpectQuery(`(?s).*FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"private_profile", "private_hide_avatar", "private_hide_wall", "private_hide_threads",
			"private_hide_stats", "private_hide_friends", "private_hide_gifts", "private_hide_achievements",
		}).AddRow(false, false, false, false, false, false, false, false))

	mock.ExpectQuery(`(?s).*FROM user_achievements ua.*LEFT JOIN achievements a.*WHERE user_id = \$1.*ua\.user_id = \$2.*`).
		WithArgs("u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "achievement_id", "unlocked_at", "level", "is_pinned", "pinned_order", "progress_current", "achievements"}).
			AddRow("a1", "u1", "ach-1", "2025-01-01T00:00:00Z", 1, false, nil, 0, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_achievements?user_id=eq.u1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	data, ok := resp.Data.([]interface{})
	if !ok || len(data) != 1 {
		t.Fatalf("expected 1 achievement, got %v", resp.Data)
	}
}

// Achievements of a profile with private_hide_achievements stay hidden from
// anonymous visitors.
func TestHandleUserAchievementsGet_Anonymous_PrivateHiddenAchievements_Empty(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"private_profile", "private_hide_avatar", "private_hide_wall", "private_hide_threads",
			"private_hide_stats", "private_hide_friends", "private_hide_gifts", "private_hide_achievements",
		}).AddRow(true, false, false, false, false, false, false, true))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_achievements?user_id=eq.u1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	data, ok := resp.Data.([]interface{})
	if !ok || len(data) != 0 {
		t.Fatalf("expected empty achievements for hidden private profile, got %v", resp.Data)
	}
}

// ─── Guest access: gomosub structure ────────────────────────────────────────

// Anonymous visitors may list channels of PUBLIC boards only — the SQL must
// carry the board-visibility predicate with no owner/membership fallback args.
func TestHandleGet_Channels_Anonymous_OnlyPublicBoards(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*FROM channels.*WHERE board_id = \$1.*` +
		`b\.visibility IS DISTINCT FROM 'private'.*ORDER BY "sort_order" ASC`).
		WithArgs("board-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "slug", "name", "description", "category", "sort_order", "is_private"}).
			AddRow("ch-1", "board-1", "general", "Общий", nil, nil, 0, false))

	c, w := newUniversalRequestContext("GET", "/api/v1/channels?board_id=eq.board-1&order=sort_order.asc", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// A member/owner of a PRIVATE board may still read its channels: the predicate
// gains the owner_id + membership branches bound to the viewer.
func TestHandleGet_Channels_Member_SeesPrivateBoard(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*FROM channels.*WHERE board_id = \$1.*`+
		`b\.visibility IS DISTINCT FROM 'private' OR b\.owner_id = \$2 OR b\.id IN \(SELECT gm\.board_id FROM gomosub_memberships gm WHERE gm\.user_id = \$3\).*`).
		WithArgs("board-1", "member-1", "member-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "board_id", "slug", "name", "description", "category", "sort_order", "is_private"}).
			AddRow("ch-1", "board-1", "private-channel", "Секрет", nil, nil, 0, true))

	c, w := newUniversalRequestContext("GET", "/api/v1/channels?board_id=eq.board-1&order=sort_order.asc", nil,
		&auth.Claims{UserID: "member-1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
