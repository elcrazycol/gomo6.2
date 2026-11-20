package privacy

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// expectVisibilitySettings expects the batched privacy_settings read used by
// HiddenAvatarIDs, returning one row per given (id, private, hideAvatar,
// hideStats) tuple.
func expectVisibilitySettings(mock sqlmock.Sqlmock, rows ...[4]interface{}) {
	set := sqlmock.NewRows([]string{"user_id", "private_profile", "private_hide_avatar", "private_hide_stats", "blocked", "blocked_by_me"})
	for _, r := range rows {
		set.AddRow(r[0], r[1], r[2], r[3], false, false)
	}
	mock.ExpectQuery(`SELECT u.id::text, COALESCE\(ps.private_profile, false\),.*FROM users u`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(set)
}

func expectVisibilityFriends(mock sqlmock.Sqlmock, pairs ...[2]string) {
	set := sqlmock.NewRows([]string{"user1_id", "user2_id"})
	for _, p := range pairs {
		set.AddRow(p[0], p[1])
	}
	mock.ExpectQuery(`SELECT user1_id::text, user2_id::text FROM friendships`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(set)
}

// A guest viewing a PUBLIC profile with private_hide_avatar must not receive
// the avatar — this is the exact production case (admin hid avatar + stats).
func TestHiddenAvatarIDs_PublicHideAvatarGuestHidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	expectVisibilitySettings(mock, [4]interface{}{"author-1", false, true, false})

	hidden, err := HiddenAvatarIDs(db, "", []string{"author-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !hidden["author-1"] {
		t.Fatal("expected avatar hidden from guest on public+hide_avatar profile")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A non-friend signed-in viewer is treated like a guest for the toggle.
func TestHiddenAvatarIDs_PublicHideAvatarStrangerHidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	expectVisibilitySettings(mock, [4]interface{}{"author-1", false, true, false})
	expectVisibilityFriends(mock) // no friendship

	hidden, err := HiddenAvatarIDs(db, "viewer-1", []string{"author-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !hidden["author-1"] {
		t.Fatal("expected avatar hidden from non-friend on public+hide_avatar profile")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Mutual friends and the author always see the avatar, even with the toggle.
func TestHiddenAvatarIDs_FriendAndOwnerExempt(t *testing.T) {
	cases := []struct {
		name   string
		viewer string
		friend bool
	}{
		{"owner sees own avatar", "author-1", false},
		{"mutual friend sees avatar", "viewer-1", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock: %v", err)
			}
			defer db.Close()

			expectVisibilitySettings(mock, [4]interface{}{"author-1", false, true, false})
			if tc.viewer != "author-1" {
				if tc.friend {
					expectVisibilityFriends(mock, [2]string{"viewer-1", "author-1"})
				} else {
					expectVisibilityFriends(mock)
				}
			}

			hidden, err := HiddenAvatarIDs(db, tc.viewer, []string{"author-1"})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if hidden["author-1"] {
				t.Fatalf("expected avatar visible to %s", tc.viewer)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Without the toggle nothing is hidden, and no friendships read is needed.
func TestHiddenAvatarIDs_NoToggleNoQueries(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	expectVisibilitySettings(mock, [4]interface{}{"author-1", false, false, false})

	hidden, err := HiddenAvatarIDs(db, "viewer-1", []string{"author-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(hidden) != 0 {
		t.Fatalf("expected nothing hidden, got %v", hidden)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// StripHiddenAvatars nils parallel avatar entries for hidden authors only.
func TestStripHiddenAvatars_ParallelSlices(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	expectVisibilitySettings(mock,
		[4]interface{}{"a-hidden", false, true, false},
		[4]interface{}{"a-open", false, false, false},
	)

	ids := []string{"a-hidden", "a-open", "a-noavatar"}
	hidden := "H"
	open := "O"
	avatars := []*string{&hidden, &open, nil}

	if err := StripHiddenAvatars(db, "", ids, avatars); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if avatars[0] != nil {
		t.Fatal("expected hidden author's avatar to be nilled")
	}
	if avatars[1] == nil || *avatars[1] != "O" {
		t.Fatal("expected open author's avatar to survive")
	}
	if avatars[2] != nil {
		t.Fatal("expected nil avatar to stay nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
