package privacy

import (
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/crud"
	"github.com/lib/pq"
)

// newMock opens a sqlmock DB with the standard cleanup that verifies all
// expectations were met.
func newMock(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})
	return db, mock
}

// settingsRow builds a row for the privacy_settings SELECT (8 core flags).
func settingsRow(privateProfile, hideAvatar, hideWall, hideThreads, hideStats, hideFriends, hideGifts, hideAchievements bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"private_profile", "private_hide_avatar", "private_hide_wall", "private_hide_threads",
		"private_hide_stats", "private_hide_friends", "private_hide_gifts", "private_hide_achievements",
	}).AddRow(privateProfile, hideAvatar, hideWall, hideThreads, hideStats, hideFriends, hideGifts, hideAchievements)
}

const settingsQuery = `SELECT COALESCE\(private_profile, false\).*FROM privacy_settings WHERE user_id = \$1`

// ──────────────────────────── GetSettings ────────────────────────────

func TestGetSettings_Success(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("u1").
		WillReturnRows(settingsRow(true, false, true, false, false, true, false, true))

	ps, err := GetSettings(db, "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ps.PrivateProfile {
		t.Error("expected PrivateProfile=true")
	}
	if !ps.PrivateHideWall {
		t.Error("expected PrivateHideWall=true")
	}
	if !ps.PrivateHideFriends {
		t.Error("expected PrivateHideFriends=true")
	}
	if !ps.PrivateHideAchievements {
		t.Error("expected PrivateHideAchievements=true")
	}
	if ps.PrivateHideAvatar || ps.PrivateHideThreads || ps.PrivateHideStats || ps.PrivateHideGifts {
		t.Error("expected remaining flags to be false")
	}
}

func TestGetSettings_NoRow_Defaults(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("u1").
		WillReturnError(sql.ErrNoRows)

	ps, err := GetSettings(db, "u1")
	if err != nil {
		t.Fatalf("expected nil error for missing row, got %v", err)
	}
	if *ps != (Settings{}) {
		t.Fatalf("expected zero-value Settings, got %+v", *ps)
	}
}

func TestGetSettings_DBError(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("u1").
		WillReturnError(errors.New("boom"))

	if _, err := GetSettings(db, "u1"); err == nil {
		t.Fatal("expected error, got nil")
	}
}

// ──────────────────────────── IsMutualFriend ────────────────────────────

func TestIsMutualFriend_True(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	ok, err := IsMutualFriend(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected mutual friendship, got false")
	}
}

func TestIsMutualFriend_False(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	ok, err := IsMutualFriend(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected no friendship, got true")
	}
}

// ──────────────────────────── ShouldFilterPrivateProfile ────────────────────────────

func TestShouldFilterPrivateProfile_Public(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(false, false, false, false, false, false, false, false))

	shouldFilter, _, err := ShouldFilterPrivateProfile(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if shouldFilter {
		t.Fatal("expected public profile not to be filtered")
	}
}

func TestShouldFilterPrivateProfile_Owner(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("u1").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))

	shouldFilter, _, err := ShouldFilterPrivateProfile(db, "u1", "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if shouldFilter {
		t.Fatal("expected owner to see own private profile")
	}
}

func TestShouldFilterPrivateProfile_Anonymous(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))

	shouldFilter, _, err := ShouldFilterPrivateProfile(db, "", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !shouldFilter {
		t.Fatal("expected anonymous viewer to be filtered from private profile")
	}
}

func TestShouldFilterPrivateProfile_MutualFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	shouldFilter, _, err := ShouldFilterPrivateProfile(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if shouldFilter {
		t.Fatal("expected mutual friend to see private profile")
	}
}

func TestShouldFilterPrivateProfile_NonFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	shouldFilter, _, err := ShouldFilterPrivateProfile(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !shouldFilter {
		t.Fatal("expected non-friend to be filtered from private profile")
	}
}

// ──────────────────────────── CanViewUserContent ────────────────────────────

func TestCanViewUserContent_Public(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(false, false, false, false, false, false, false, false))

	can, err := CanViewUserContent(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("expected public profile content to be visible")
	}
}

func TestCanViewUserContent_PrivateNonFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	can, err := CanViewUserContent(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("expected private non-friend content to be hidden")
	}
}

// ──────────────────────────── CanViewUserAchievements ────────────────────────────

func TestCanViewUserAchievements_OwnerSeesHidden(t *testing.T) {
	db, mock := newMock(t)
	// The owner always sees their own achievements, even when hidden.
	mock.ExpectQuery(settingsQuery).
		WithArgs("u1").
		WillReturnRows(settingsRow(false, false, false, false, false, false, false, true))

	can, err := CanViewUserAchievements(db, "u1", "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("expected owner to see own achievements")
	}
}

func TestCanViewUserAchievements_HiddenAchievements(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(false, false, false, false, false, false, false, true))

	can, err := CanViewUserAchievements(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("expected achievements to be hidden when private_hide_achievements is set")
	}
}

func TestCanViewUserAchievements_PublicProfile(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(false, false, false, false, false, false, false, false))

	can, err := CanViewUserAchievements(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("expected achievements of public profile to be visible")
	}
}

func TestCanViewUserAchievements_PrivateAnonymous(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))

	can, err := CanViewUserAchievements(db, "", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("expected anonymous viewer to be denied achievements of private profile")
	}
}

func TestCanViewUserAchievements_PrivateFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	can, err := CanViewUserAchievements(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("expected mutual friend to see achievements of private profile")
	}
}

func TestCanViewUserAchievements_PrivateNonFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	can, err := CanViewUserAchievements(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("expected non-friend to be denied achievements of private profile")
	}
}

// ──────────────────────────── CanViewUserGifts ────────────────────────────

func TestCanViewUserGifts_HiddenGifts(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(false, false, false, false, false, false, true, false))

	can, err := CanViewUserGifts(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("expected gifts to be hidden when private_hide_gifts is set")
	}
}

func TestCanViewUserGifts_PublicProfile(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(false, false, false, false, false, false, false, false))

	can, err := CanViewUserGifts(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("expected gifts of public profile to be visible")
	}
}

func TestCanViewUserGifts_PrivateNonFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(settingsQuery).
		WithArgs("target").
		WillReturnRows(settingsRow(true, false, false, false, false, false, false, false))
	mock.ExpectQuery(`SELECT EXISTS.*FROM friendships.*`).
		WithArgs("viewer", "target").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	can, err := CanViewUserGifts(db, "viewer", "target")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("expected gifts of private non-friend to be hidden")
	}
}

// ──────────────────────────── CanViewWall ────────────────────────────

// wallSettingsQuery matches the two-flag privacy_settings SELECT that
// CanViewWall runs (the historical wall gate query shape, kept so the sqlmock
// contracts in crudengine/routes/hub tests stay valid).
const wallSettingsQuery = `SELECT COALESCE\(private_profile, false\), COALESCE\(private_hide_wall, false\) FROM privacy_settings WHERE user_id = \$1`

// wallSettingsRow builds a row for the two-flag privacy_settings SELECT that
// CanViewWall runs.
func wallSettingsRow(privateProfile, hideWall bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}).AddRow(privateProfile, hideWall)
}

const friendshipExistsQuery = `SELECT EXISTS.*FROM friendships.*`

func TestCanViewWall_SameUser(t *testing.T) {
	db, _ := newMock(t)

	can, err := CanViewWall(db, "u1", "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("a user must always be able to view their own wall")
	}
}

func TestCanViewWall_NoPrivacyRow_PublicByDefault(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(wallSettingsQuery).
		WithArgs("owner").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}))

	can, err := CanViewWall(db, "viewer", "owner")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("missing privacy row must default to public")
	}
}

func TestCanViewWall_PublicProfile(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(wallSettingsQuery).
		WithArgs("owner").
		WillReturnRows(wallSettingsRow(false, false))

	can, err := CanViewWall(db, "viewer", "owner")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("a public profile must be viewable")
	}
}

func TestCanViewWall_HiddenWallNonFriend(t *testing.T) {
	db, mock := newMock(t)
	// Public profile that hid the wall — non-friends are locked out.
	mock.ExpectQuery(wallSettingsQuery).
		WithArgs("owner").
		WillReturnRows(wallSettingsRow(false, true))
	mock.ExpectQuery(friendshipExistsQuery).
		WithArgs("viewer", "owner").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	can, err := CanViewWall(db, "viewer", "owner")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("a hidden wall must not be viewable by a stranger")
	}
}

func TestCanViewWall_PrivateAndNotFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(wallSettingsQuery).
		WithArgs("owner").
		WillReturnRows(wallSettingsRow(true, true))
	mock.ExpectQuery(friendshipExistsQuery).
		WithArgs("viewer", "owner").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	can, err := CanViewWall(db, "viewer", "owner")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("a stranger must not view a private wall")
	}
}

func TestCanViewWall_PrivateMutualFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(wallSettingsQuery).
		WithArgs("owner").
		WillReturnRows(wallSettingsRow(true, true))
	mock.ExpectQuery(friendshipExistsQuery).
		WithArgs("viewer", "owner").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	can, err := CanViewWall(db, "viewer", "owner")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("a mutual friend must be able to view the wall")
	}
}

func TestCanViewWall_AnonymousOnPrivateWall(t *testing.T) {
	db, mock := newMock(t)
	// Anonymous viewer: only the settings query runs — the friendship EXISTS is
	// never reached (an empty viewer cannot be a friend).
	mock.ExpectQuery(wallSettingsQuery).
		WithArgs("owner").
		WillReturnRows(wallSettingsRow(true, true))

	can, err := CanViewWall(db, "", "owner")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if can {
		t.Fatal("an anonymous caller must not view a private wall")
	}
}

func TestCanViewWall_AnonymousOnPublicWall(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(wallSettingsQuery).
		WithArgs("owner").
		WillReturnRows(wallSettingsRow(false, false))

	can, err := CanViewWall(db, "", "owner")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !can {
		t.Fatal("an anonymous caller must still see public non-hidden walls")
	}
}

func TestCanViewWall_DBErrorFailsClosed(t *testing.T) {
	db, _ := newMock(t)
	// No expectation → the settings query errors → must fail closed.

	can, err := CanViewWall(db, "viewer", "owner")
	if err == nil {
		t.Fatal("expected an error from the DB")
	}
	if can {
		t.Fatal("DB errors must deny wall access")
	}
}

// ──────────────────────────── WallVisibilityClause ────────────────────────────

func TestWallVisibilityClause(t *testing.T) {
	clause := WallVisibilityClause("p.user_id", "ps", "$2")
	for _, want := range []string{
		"p.user_id = $2",
		"COALESCE(ps.private_profile, false) = false AND COALESCE(ps.private_hide_wall, false) = false",
		"SELECT 1 FROM friendships f",
		"f.user1_id = p.user_id AND f.user2_id = $2",
		"f.user1_id = $2 AND f.user2_id = p.user_id",
	} {
		if !strings.Contains(clause, want) {
			t.Errorf("WallVisibilityClause missing %q in: %s", want, clause)
		}
	}
}

// ──────────────────────────── WallAttachmentAccess ────────────────────────────

// TestWallAttachmentAccess_PublishedOnPublicWall is the exact regression case
// from the bug report: a private user posts with an image on a PUBLIC user's
// wall. The object key is namespaced by the private uploader, but the photo is
// published on the public wall, so a stranger must be allowed to fetch it.
// The lookup is scoped to posts authored by the uploader (author_id = key
// prefix), which this post satisfies.
func TestWallAttachmentAccess_PublishedOnPublicWall(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + crud.EscapeLikePattern(key) + "%"
	// Visible branch of the EXISTS query (public wall) short-circuits to allow.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := WallAttachmentAccess(db, "viewer", "uPrivate", key)
	if !found || !allowed {
		t.Fatalf("expected found+allowed for a photo published on a public wall, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWallAttachmentAccess_PublishedOnPrivateWallStrangerDenied(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + crud.EscapeLikePattern(key) + "%"
	// Not visible to the viewer, but referenced by an uploader-authored post →
	// deny (found, not allowed).
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s).*FROM profile_wall_posts p\s+WHERE p\.author_id.*`).
		WithArgs(pattern, "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := WallAttachmentAccess(db, "viewer", "uPrivate", key)
	if !found || allowed {
		t.Fatalf("expected found but not allowed for a stranger on a private wall, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Anonymous viewers (the /og/wall crawler proxy passes viewerID = "") must
// still be able to fetch images from PUBLIC walls. Regression: the uuid
// columns were compared to the empty string directly, Postgres raised
// "invalid input syntax for type uuid" and every anonymous wall-image
// request 404ed even for public walls.
func TestWallAttachmentAccess_AnonymousViewerPublicWallAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPublic/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + crud.EscapeLikePattern(key) + "%"
	// The public-wall branch of the EXISTS query short-circuits to allow — an
	// anonymous viewer is bound as SQL NULL (never matching ownership or
	// friendship), so the query must not fail or break the uuid cast.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "uPublic").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := WallAttachmentAccess(db, "", "uPublic", key)
	if !found || !allowed {
		t.Fatalf("expected an anonymous viewer to fetch a public-wall image, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A derivative key (video poster / image preview) must authorize against its
// BASE object: the suffix is stripped before the LIKE pattern is built, so a
// poster referenced only by the base video URL still resolves. Regression for
// og:video previews, which point og:image at <key>.poster.jpg through /og/wall.
func TestWallAttachmentAccess_VideoPosterKeyAuthorizesAgainstBase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPublic/1786303495874_clip.mp4.poster.jpg"
	// The suffix is stripped, so the query pattern is the base video key.
	pattern := "%" + crud.EscapeLikePattern("uPublic/1786303495874_clip.mp4") + "%"
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "uPublic").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := WallAttachmentAccess(db, "", "uPublic", key)
	if !found || !allowed {
		t.Fatalf("expected a public-wall video poster to be served, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWallAttachmentAccess_MutualFriendOnPrivateWallAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + crud.EscapeLikePattern(key) + "%"
	// The friendships branch of the SQL predicate matches → visible.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "friend", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := WallAttachmentAccess(db, "friend", "uPrivate", key)
	if !found || !allowed {
		t.Fatalf("expected a mutual friend of the wall owner to be allowed, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestWallAttachmentAccess_NoPostReferencesKey guards the security boundary: a
// guessed key with no post referencing it must NOT be counted as found, so the
// caller falls back to the uploader gate (which denies for a private uploader).
func TestWallAttachmentAccess_NoPostReferencesKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + crud.EscapeLikePattern(key) + "%"
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s).*FROM profile_wall_posts p\s+WHERE p\.author_id.*`).
		WithArgs(pattern, "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	found, allowed := WallAttachmentAccess(db, "viewer", "uPrivate", key)
	if found || allowed {
		t.Fatalf("expected not-found for a key no uploader-authored post references, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestWallAttachmentAccess_AttackerReferenceDoesNotUnlock covers the bypass that
// author-scoping prevents: an ATTACKER references a private user's key from a
// post on their own public wall. The reference is not authored by the uploader,
// so the lookup must not find it (found=false) — the caller then falls back to
// the uploader gate, which denies for the private uploader.
func TestWallAttachmentAccess_AttackerReferenceDoesNotUnlock(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + crud.EscapeLikePattern(key) + "%"
	// Both queries are scoped to p.author_id = uPrivate; the attacker's post
	// (author = attacker) matches neither → found=false.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s).*FROM profile_wall_posts p\s+WHERE p\.author_id.*`).
		WithArgs(pattern, "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	found, allowed := WallAttachmentAccess(db, "viewer", "uPrivate", key)
	if found || allowed {
		t.Fatalf("an attacker's own post must not unlock another user's file, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWallAttachmentAccess_DBErrorFailsClosed(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	// No expectation → query error → fail closed (caller falls back to the
	// uploader gate, which also denies on DB errors).

	found, allowed := WallAttachmentAccess(db, "viewer", "u1", "u1/photo.jpg")
	if found || allowed {
		t.Fatalf("expected DB errors to deny access, got found=%v allowed=%v", found, allowed)
	}
}

// ─────────────────── ResolveProfileVisibilityBatch ───────────────────

const (
	batchSettingsRe = `SELECT user_id::text, COALESCE\(private_profile, false\).*FROM privacy_settings WHERE user_id = ANY`
	batchFriendsRe  = `SELECT user1_id::text, user2_id::text FROM friendships`
)

// batchSettingsRows builds the 4-column result set of the batched
// privacy_settings read.
func batchSettingsRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"user_id", "private_profile", "private_hide_avatar", "private_hide_stats"})
}

func TestResolveProfileVisibilityBatch_AnonymousPublic(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows())

	vis, err := ResolveProfileVisibilityBatch(db, "", []string{"a", "b"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Public profiles with no toggles resolve to the zero value, and no
	// friendships read is issued.
	if vis["a"] != (ProfileVisibility{}) || vis["b"] != (ProfileVisibility{}) {
		t.Fatalf("expected public defaults, got %+v", vis)
	}
}

func TestResolveProfileVisibilityBatch_PrivateNonFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows().AddRow("target", true, true, false))
	mock.ExpectQuery(batchFriendsRe).
		WithArgs("viewer", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"user1_id", "user2_id"}))

	vis, err := ResolveProfileVisibilityBatch(db, "viewer", []string{"target"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !vis["target"].Filter {
		t.Fatal("expected a private non-friend profile to be filtered")
	}
	if !vis["target"].HideAvatar {
		t.Fatal("expected private_hide_avatar to hide the avatar")
	}
}

func TestResolveProfileVisibilityBatch_PrivateFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows().AddRow("target", true, true, true))
	mock.ExpectQuery(batchFriendsRe).
		WithArgs("viewer", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"user1_id", "user2_id"}).AddRow("target", "viewer"))

	vis, err := ResolveProfileVisibilityBatch(db, "viewer", []string{"target"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vis["target"] != (ProfileVisibility{}) {
		t.Fatalf("expected a mutual friend to see a private profile in full, got %+v", vis["target"])
	}
}

func TestResolveProfileVisibilityBatch_AnonymousPrivateHidesAvatar(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows().AddRow("target", true, true, false))
	// An anonymous viewer is never a friend → no friendships read expected.

	vis, err := ResolveProfileVisibilityBatch(db, "", []string{"target"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !vis["target"].Filter || !vis["target"].HideAvatar {
		t.Fatalf("expected anonymous private profile filtered with avatar hidden, got %+v", vis["target"])
	}
}

func TestResolveProfileVisibilityBatch_PublicHideStats(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows().AddRow("t", false, false, true))
	mock.ExpectQuery(batchFriendsRe).
		WithArgs("viewer", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"user1_id", "user2_id"}))

	vis, err := ResolveProfileVisibilityBatch(db, "viewer", []string{"t"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vis["t"].Filter {
		t.Fatal("a public profile must not be fully filtered")
	}
	if !vis["t"].HideStats || vis["t"].HideAvatar {
		t.Fatalf("expected only hide_stats, got %+v", vis["t"])
	}
}

func TestResolveProfileVisibilityBatch_PublicToggleExemptsFriend(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows().AddRow("t", false, false, true))
	mock.ExpectQuery(batchFriendsRe).
		WithArgs("viewer", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"user1_id", "user2_id"}).AddRow("t", "viewer"))

	vis, err := ResolveProfileVisibilityBatch(db, "viewer", []string{"t"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vis["t"] != (ProfileVisibility{}) {
		t.Fatalf("expected a mutual friend to bypass the public toggle, got %+v", vis["t"])
	}
}

func TestResolveProfileVisibilityBatch_OwnerSkipsFriendQuery(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows().AddRow("u1", true, true, true))
	// Owner → no friendships read expected.

	vis, err := ResolveProfileVisibilityBatch(db, "u1", []string{"u1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vis["u1"] != (ProfileVisibility{}) {
		t.Fatalf("expected the owner to see their own private profile in full, got %+v", vis["u1"])
	}
}

// TestResolveProfileVisibilityBatch_DedupesAndBatches is the regression guard
// for the N+1: many targets (with duplicates) must still issue exactly one
// privacy_settings read, carrying the deduplicated id set.
func TestResolveProfileVisibilityBatch_DedupesAndBatches(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(pq.Array([]string{"a", "b"})).
		WillReturnRows(batchSettingsRows())

	vis, err := ResolveProfileVisibilityBatch(db, "", []string{"a", "b", "a", "b", ""})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vis) != 2 {
		t.Fatalf("expected 2 resolved targets, got %d", len(vis))
	}
}

func TestResolveProfileVisibilityBatch_EmptyTargetsIssuesNoQuery(t *testing.T) {
	db, _ := newMock(t)

	vis, err := ResolveProfileVisibilityBatch(db, "viewer", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vis) != 0 {
		t.Fatalf("expected no visibility entries, got %+v", vis)
	}
}

func TestResolveProfileVisibilityBatch_NilDB(t *testing.T) {
	if _, err := ResolveProfileVisibilityBatch(nil, "viewer", []string{"t"}); err == nil {
		t.Fatal("expected an error for a nil db")
	}
}

func TestResolveProfileVisibilityBatch_SettingsError(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnError(errors.New("boom"))

	if _, err := ResolveProfileVisibilityBatch(db, "viewer", []string{"t"}); err == nil {
		t.Fatal("expected the settings read error to propagate")
	}
}

func TestResolveProfileVisibilityBatch_FriendsError(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(batchSettingsRe).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(batchSettingsRows().AddRow("t", true, false, false))
	mock.ExpectQuery(batchFriendsRe).
		WithArgs("viewer", sqlmock.AnyArg()).
		WillReturnError(errors.New("boom"))

	if _, err := ResolveProfileVisibilityBatch(db, "viewer", []string{"t"}); err == nil {
		t.Fatal("expected the friendships read error to propagate")
	}
}
