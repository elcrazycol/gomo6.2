package privacy

import (
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
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
