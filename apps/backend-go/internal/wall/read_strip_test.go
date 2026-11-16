package wall

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// A guest reading a public wall must not receive the avatar of an author
// with private_hide_avatar — on a public profile — while other authors and
// avatarless rows pass through untouched.
func TestStripHiddenAuthorAvatars_GuestHidesPublicToggle(t *testing.T) {
	srv, mock := setupService(t)

	mock.ExpectQuery(`SELECT user_id::text, COALESCE\(private_profile, false\),.*FROM privacy_settings WHERE user_id = ANY`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "private_profile", "private_hide_avatar", "private_hide_stats"}).
			AddRow("author-1", false, true, false))

	rows := []map[string]interface{}{
		{
			"author_id": "author-1",
			"author":    map[string]interface{}{"username": "alice", "avatar_url": "a.png"},
		},
		{
			// Comment rows key the author by user_id instead.
			"user_id": "author-2",
			"author":  map[string]interface{}{"username": "bob", "avatar_url": "b.png"},
		},
		{
			// No avatar — needs no lookup and must not allocate one.
			"author_id": "author-3",
			"author":    map[string]interface{}{"username": "carol"},
		},
	}

	if err := stripHiddenAuthorAvatars(srv.db, "", rows); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if av := rows[0]["author"].(map[string]interface{})["avatar_url"]; av != nil {
		t.Fatalf("expected hidden author avatar stripped, got %v", av)
	}
	if av := rows[1]["author"].(map[string]interface{})["avatar_url"]; av != "b.png" {
		t.Fatalf("expected visible comment author avatar kept, got %v", av)
	}
	if _, ok := rows[2]["author"].(map[string]interface{})["avatar_url"]; ok {
		t.Fatal("expected avatarless row to stay avatarless")
	}
}
