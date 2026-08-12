package handlers

import (
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

// privacySettingsRowColumns mirrors the SELECT column order used by
// GetUserPrivacy (see privacy.go): the 8 private flags plus the display and
// stats toggles.
var privacySettingsRowColumns = []string{
	"private_profile", "private_hide_avatar", "private_hide_wall",
	"private_hide_threads", "private_hide_stats", "private_hide_friends",
	"private_hide_gifts", "private_hide_achievements",
	"show_profile_wall", "allow_wall_posts_from_others",
	"show_profile_stats", "show_detailed_stats", "show_last_seen",
	"stats_visibility",
} // fullPrivacyRow builds a 16-column row for the GetUserPrivacy SQL. Values
// default to the same COALESCE defaults the query applies.
func fullPrivacyRow(mut func(*[]driver.Value)) []driver.Value {
	row := []driver.Value{
		true,         // private_profile
		false,        // private_hide_avatar
		false,        // private_hide_wall
		true,         // private_hide_threads
		false,        // private_hide_stats
		true,         // private_hide_friends
		true,         // private_hide_gifts
		true,         // private_hide_achievements
		true,         // show_profile_wall
		true,         // allow_wall_posts_from_others
		false,        // show_profile_stats
		false,        // show_detailed_stats
		true,         // show_last_seen
		[]byte("{}"), // stats_visibility (jsonb arrives as []byte from the driver)
	}
	if mut != nil {
		mut(&row)
	}
	return row
}

// setupPrivacyHandler creates a PrivacyHandler with a mock DB.
func setupPrivacyHandler(t *testing.T) (*PrivacyHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)
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
	return NewPrivacyHandler(db), mock
}

// expectPrivacySettingsQuery registers the GetUserPrivacy SQL expectation and
// returns the sqlmock.Sqlmock for chaining WillReturnRows.
func expectPrivacySettingsQuery(mock sqlmock.Sqlmock, userID string) *sqlmock.Rows {
	r := sqlmock.NewRows(privacySettingsRowColumns)
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\).*FROM privacy_settings WHERE user_id = \$1`).
		WithArgs(userID).
		WillReturnRows(r)
	return r
}

// testPrivacyTargetID is a valid UUID used as the target user across the
// GetUserPrivacy tests (the handler rejects non-UUID ids).
const testPrivacyTargetID = "11111111-2222-3333-4444-555555555555"

// TestGetUserPrivacy_PrivateProfile returns every hide flag for a private
// profile — the profile page needs them to hide tabs and render the wall
// notice for non-friends.
func TestGetUserPrivacy_PrivateProfile(t *testing.T) {
	h, mock := setupPrivacyHandler(t)

	expectPrivacySettingsQuery(mock, testPrivacyTargetID).
		AddRow(fullPrivacyRow(func(row *[]driver.Value) {
			(*row)[10] = true // show_profile_stats
			(*row)[11] = true // show_detailed_stats
		})...)

	c, w := newGETContextWithParams("/api/v1/users/"+testPrivacyTargetID+"/privacy", nil, map[string]string{"id": testPrivacyTargetID})
	h.GetUserPrivacy(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data UserPrivacyResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if !resp.Data.PrivateProfile {
		t.Error("expected private_profile=true")
	}
	if resp.Data.PrivateHideAvatar {
		t.Error("expected private_hide_avatar=false")
	}
	if resp.Data.PrivateHideWall {
		t.Error("expected private_hide_wall=false")
	}
	if !resp.Data.PrivateHideThreads {
		t.Error("expected private_hide_threads=true")
	}
	if resp.Data.PrivateHideStats {
		t.Error("expected private_hide_stats=false")
	}
	if !resp.Data.PrivateHideFriends {
		t.Error("expected private_hide_friends=true")
	}
	if !resp.Data.PrivateHideGifts {
		t.Error("expected private_hide_gifts=true")
	}
	if !resp.Data.PrivateHideAchievements {
		t.Error("expected private_hide_achievements=true")
	}
	// The stats page needs the display toggles too.
	if !resp.Data.ShowProfileStats || !resp.Data.ShowDetailedStats {
		t.Error("expected stats toggles to be surfaced")
	}
	if !resp.Data.ShowProfileWall || !resp.Data.AllowWallPostsFromOthers || !resp.Data.ShowLastSeen {
		t.Error("expected display toggles to be surfaced")
	}
}

// TestGetUserPrivacy_NoRow_PublicDefaults: a user without a privacy_settings
// row is public by default — all flags false and display toggles on.
func TestGetUserPrivacy_NoRow_PublicDefaults(t *testing.T) {
	h, mock := setupPrivacyHandler(t)

	expectPrivacySettingsQuery(mock, testPrivacyTargetID)

	c, w := newGETContextWithParams("/api/v1/users/"+testPrivacyTargetID+"/privacy", nil, map[string]string{"id": testPrivacyTargetID})
	h.GetUserPrivacy(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data UserPrivacyResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Data.PrivateProfile {
		t.Error("expected private_profile=false for a user without a settings row")
	}
	if resp.Data.PrivateHideFriends || resp.Data.PrivateHideGifts || resp.Data.PrivateHideAchievements || resp.Data.PrivateHideThreads {
		t.Error("expected all hide flags false for a public default profile")
	}
	if !resp.Data.ShowProfileWall || !resp.Data.ShowLastSeen || !resp.Data.AllowWallPostsFromOthers {
		t.Error("expected display toggles on for a public default profile")
	}
}

// TestGetUserPrivacy_InvalidID rejects non-UUID user IDs.
func TestGetUserPrivacy_InvalidID(t *testing.T) {
	h, _ := setupPrivacyHandler(t)

	c, w := newGETContextWithParams("/api/v1/users/not-a-uuid/privacy", nil, map[string]string{"id": "not-a-uuid"})
	h.GetUserPrivacy(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a non-UUID user id, got %d (body: %s)", w.Code, w.Body.String())
	}
}

// TestGetUserPrivacy_DBErrorFailsClosed: a DB error must not leak a
// permissive default — the endpoint fails with 500.
func TestGetUserPrivacy_DBErrorFailsClosed(t *testing.T) {
	h, _ := setupPrivacyHandler(t)
	// No expectation → query errors → 500.

	c, w := newGETContextWithParams("/api/v1/users/"+testPrivacyTargetID+"/privacy", nil, map[string]string{"id": testPrivacyTargetID})
	h.GetUserPrivacy(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on DB error, got %d (body: %s)", w.Code, w.Body.String())
	}
}
