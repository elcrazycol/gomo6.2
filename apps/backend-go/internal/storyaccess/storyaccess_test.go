package storyaccess

import (
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const (
	viewer = "20000000-0000-0000-0000-0000000000bb"
	owner  = "30000000-0000-0000-0000-0000000000cc"
	board  = "40000000-0000-0000-0000-0000000000dd"
	story  = "50000000-0000-0000-0000-0000000000ee"
)

func newMock(t *testing.T) (sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	closer := func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled expectations: %v", err)
		}
		_ = db.Close()
	}
	return mock, closer
}

var (
	userProfilePattern = regexp.MustCompile(`SELECT EXISTS \(\s*SELECT 1 FROM users u`)
	boardPattern       = regexp.MustCompile(`SELECT EXISTS \(\s*SELECT 1 FROM boards b`)
	storyPattern       = regexp.MustCompile(`SELECT EXISTS \(\s*SELECT 1 FROM stories s`)
	mediaPattern       = regexp.MustCompile(`SELECT s.id::text\s*FROM stories s\s*WHERE s.deleted_at IS NULL`)
)

// The author must be able to open their own stories without any database
// round-trip — the profile-privacy query is only about *other* viewers.
func TestCanViewUserStories_OwnProfileNeedsNoQuery(t *testing.T) {
	mock, done := newMock(t)
	defer done()
	_ = mock

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	ok, err := CanViewUserStories(db, owner, owner)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("the owner must always see their own stories")
	}
}

func TestCanViewUserStories_EmptyInputsFailClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	_ = mock

	if ok, _ := CanViewUserStories(nil, viewer, owner); ok {
		t.Error("nil db must deny")
	}
	if ok, _ := CanViewUserStories(db, "", owner); ok {
		t.Error("anonymous viewer must deny")
	}
	if ok, _ := CanViewUserStories(db, viewer, ""); ok {
		t.Error("empty owner must deny")
	}
}

func TestCanViewUserStories_PrivateProfileDeniesStranger(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(userProfilePattern.String()).
		WithArgs(viewer, owner).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	ok, err := CanViewUserStories(db, viewer, owner)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("a stranger must not see a private profile's stories")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestCanViewUserStories_AllowsMutualFriend(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(userProfilePattern.String()).
		WithArgs(viewer, owner).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	ok, err := CanViewUserStories(db, viewer, owner)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("a mutual friend must see the stories")
	}
}

func TestCanViewUserStories_ErrorPropagates(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	boom := errors.New("db down")
	mock.ExpectQuery(userProfilePattern.String()).WillReturnError(boom)

	ok, err := CanViewUserStories(db, viewer, owner)
	if !errors.Is(err, boom) {
		t.Fatalf("expected the db error to surface, got %v", err)
	}
	if ok {
		t.Fatal("an error must never grant access")
	}
}

func TestCanViewBoardStories(t *testing.T) {
	t.Run("public board", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock: %v", err)
		}
		defer db.Close()
		mock.ExpectQuery(boardPattern.String()).
			WithArgs(viewer, board).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

		ok, err := CanViewBoardStories(db, viewer, board)
		if err != nil || !ok {
			t.Fatalf("expected access, got ok=%v err=%v", ok, err)
		}
	})

	t.Run("private board stranger", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock: %v", err)
		}
		defer db.Close()
		mock.ExpectQuery(boardPattern.String()).
			WithArgs(viewer, board).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

		ok, err := CanViewBoardStories(db, viewer, board)
		if err != nil || ok {
			t.Fatalf("expected denial, got ok=%v err=%v", ok, err)
		}
	})
}

// expectServerGrant mocks checkBoardServerPerm's chain: owner lookup (not
// the owner), no ban, no timeout, then the shared kernel union.
func expectServerGrant(mock sqlmock.Sqlmock, perms string, pos int) {
	mock.ExpectQuery(`SELECT owner_id::text FROM boards WHERE id::text = \$1::text`).
		WithArgs(board).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(owner))
	mock.ExpectQuery(`FROM gomosub_bans WHERE board_id`).
		WithArgs(viewer, board).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`timed_out_until IS NOT NULL AND timed_out_until`).
		WithArgs(viewer, board).
		WillReturnRows(sqlmock.NewRows([]string{"timed_out"}).AddRow(false))
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(board, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(board, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}).
			AddRow("r-1", "role", []byte(perms), pos, false))
}

func TestCanPostBoardStories(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	expectServerGrant(mock, `{"can_post_stories": true}`, 5)

	ok, err := CanPostBoardStories(db, viewer, board)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected posting rights")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestCanModerateBoardStories_UsesDeletePermission(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	expectServerGrant(mock, `{"can_delete_threads": true}`, 5)

	ok, err := CanModerateBoardStories(db, viewer, board)
	if err != nil || !ok {
		t.Fatalf("expected moderation rights, got ok=%v err=%v", ok, err)
	}
}

func TestCanViewStory(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(storyPattern.String()).
		WithArgs(viewer, story).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	ok, err := CanViewStory(db, viewer, story)
	if err != nil || !ok {
		t.Fatalf("expected access, got ok=%v err=%v", ok, err)
	}
}

func TestCanViewStory_AnonymousNeverQueries(t *testing.T) {
	if ok, _ := CanViewStory(nil, "", story); ok {
		t.Fatal("anonymous viewers must be denied without a query")
	}
}

// StoryMediaAccess resolves a raw object key to its story and applies that
// story's audience rule. An unattached key reports found=false so the caller
// can fall back to the uploader-prefix gate.
func TestStoryMediaAccess(t *testing.T) {
	const key = "30000000-0000-0000-0000-0000000000cc/abc.jpg"

	t.Run("attached and visible", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock: %v", err)
		}
		defer db.Close()

		mock.ExpectQuery(mediaPattern.String()).
			WithArgs(key).
			WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(story))
		mock.ExpectQuery(storyPattern.String()).
			WithArgs(viewer, story).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

		found, allowed := StoryMediaAccess(db, viewer, key)
		if !found || !allowed {
			t.Fatalf("expected found+allowed, got found=%v allowed=%v", found, allowed)
		}
	})

	t.Run("attached but audience excludes the viewer", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock: %v", err)
		}
		defer db.Close()

		mock.ExpectQuery(mediaPattern.String()).
			WithArgs(key).
			WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(story))
		mock.ExpectQuery(storyPattern.String()).
			WithArgs(viewer, story).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

		found, allowed := StoryMediaAccess(db, viewer, key)
		if !found || allowed {
			t.Fatalf("expected found+denied, got found=%v allowed=%v", found, allowed)
		}
	})

	t.Run("unattached key", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock: %v", err)
		}
		defer db.Close()

		mock.ExpectQuery(mediaPattern.String()).
			WithArgs(key, key).
			WillReturnRows(sqlmock.NewRows([]string{"id"}))

		found, allowed := StoryMediaAccess(db, viewer, key)
		if found || allowed {
			t.Fatalf("an orphan key must report found=false, got found=%v allowed=%v", found, allowed)
		}
	})
}
