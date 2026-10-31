package channelaccess

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const testChannel = "10000000-0000-0000-0000-0000000000aa"
const testUser = "20000000-0000-0000-0000-0000000000bb"
const testBoard = "30000000-0000-0000-0000-0000000000cc"
const testOwner = "40000000-0000-0000-0000-0000000000dd"

func newAccessDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db, mock
}

func expectScope(mock sqlmock.Sqlmock, isPrivate bool, visibility string) {
	mock.ExpectQuery(`SELECT ch\.board_id.*FROM channels ch JOIN boards b`).
		WithArgs(testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"board_id", "is_private", "owner_id", "visibility"}).
			AddRow(testBoard, isPrivate, testOwner, visibility))
}

func expectNotBanned(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`FROM gomosub_bans`).
		WithArgs(testBoard, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
}

func expectMembership(mock sqlmock.Sqlmock, isMember bool) {
	rows := sqlmock.NewRows([]string{"timed_out_until"})
	if isMember {
		rows.AddRow(nil)
	}
	mock.ExpectQuery(`timed_out_until FROM gomosub_memberships`).
		WithArgs(testBoard, testUser).
		WillReturnRows(rows)
}

func expectRoles(mock sqlmock.Sqlmock, perms ...string) {
	rows := sqlmock.NewRows([]string{"permissions", "is_everyone"})
	for _, p := range perms {
		// []byte mirrors what pgx returns for JSONB in production (sqlmock
		// strings do not scan into json.RawMessage).
		rows.AddRow([]byte(`{"`+p+`": true}`), false)
	}
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(testBoard, testUser).
		WillReturnRows(rows)
}

func expectDenyOverwrite(mock sqlmock.Sqlmock, user string) {
	mock.ExpectQuery(`(?s)FROM channel_permissions cp.*`).
		WithArgs(testChannel, testBoard, user).
		WillReturnRows(sqlmock.NewRows([]string{"allow", "deny", "can_read", "can_write", "is_everyone"}).
			AddRow([]byte(`{}`), []byte(`{"view_channel": true}`), true, true, false))
}

func expectEveryoneGrant(mock sqlmock.Sqlmock, perms string) {
	rows := sqlmock.NewRows([]string{"permissions", "is_everyone"})
	rows.AddRow([]byte(perms), true)
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(testBoard, testUser).
		WillReturnRows(rows)
}

func expectNoOverwrites(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)FROM channel_permissions cp.*`).
		WithArgs(testChannel, testBoard, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"allow", "deny", "can_read", "can_write", "is_everyone"}))
}

func TestCanReadChannel_Allowed(t *testing.T) {
	db, mock := newAccessDB(t)
	// Public channel of a public board: readable without membership.
	expectScope(mock, false, "public")
	expectNotBanned(mock)
	expectMembership(mock, false)
	expectRoles(mock)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected read access")
	}
}

func TestCanReadChannel_Denied(t *testing.T) {
	db, mock := newAccessDB(t)
	// Private channel, viewer is not a member and holds no overwrite.
	expectScope(mock, true, "public")
	expectNotBanned(mock)
	expectMembership(mock, false)
	expectRoles(mock)
	expectNoOverwrites(mock)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Error("expected read denial")
	}
}

func TestCanReadChannel_ExplicitDenyOnPublicDenied(t *testing.T) {
	db, mock := newAccessDB(t)
	// Public channel, but the member's role carries an explicit view deny:
	// the channel must disappear (Discord semantics).
	expectScope(mock, false, "public")
	expectNotBanned(mock)
	expectMembership(mock, true)
	expectRoles(mock, "send_messages")
	expectDenyOverwrite(mock, testUser)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Error("explicit view deny on a public channel must hide it")
	}
}

func TestCanReadChannel_MemberPublicNoGrantDenied(t *testing.T) {
	db, mock := newAccessDB(t)
	// Member on a public channel with no view grant anywhere: hidden.
	// This is the @everyone-view-off lockdown.
	expectScope(mock, false, "public")
	expectNotBanned(mock)
	expectMembership(mock, true)
	expectRoles(mock) // no grants at all
	expectNoOverwrites(mock)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Error("member without a view grant must not see the channel")
	}
}

func TestCanReadChannel_MemberPublicEveryoneGrantAllowed(t *testing.T) {
	db, mock := newAccessDB(t)
	expectScope(mock, false, "public")
	expectNotBanned(mock)
	expectMembership(mock, true)
	expectEveryoneGrant(mock, `{"view_channel": true}`)
	expectNoOverwrites(mock)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected read access via @everyone grant")
	}
}

func TestCanReadChannel_DBErrorFailsClosed(t *testing.T) {
	db, mock := newAccessDB(t)
	mock.ExpectQuery(`SELECT ch\.board_id.*FROM channels ch JOIN boards b`).
		WithArgs(testChannel, testUser).
		WillReturnError(sql.ErrConnDone)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err == nil {
		t.Fatal("expected error to propagate")
	}
	if ok {
		t.Error("must fail closed on DB error")
	}
}

func TestCanWriteChannel_Allowed(t *testing.T) {
	db, mock := newAccessDB(t)
	// Member writing to a public channel.
	expectScope(mock, false, "public")
	expectNotBanned(mock)
	expectMembership(mock, true)
	expectRoles(mock)

	ok, err := CanWriteChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected write access")
	}
}

// A channel that vanished between route and check must deny — never panic.
func TestCanWriteChannel_MissingChannelDenies(t *testing.T) {
	db, mock := newAccessDB(t)
	mock.ExpectQuery(`SELECT ch\.board_id.*FROM channels ch JOIN boards b`).
		WithArgs(testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"board_id", "is_private", "owner_id", "visibility"})) // zero rows → ErrNoRows

	ok, err := CanWriteChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("ErrNoRows must be mapped to a clean denial, got error: %v", err)
	}
	if ok {
		t.Error("missing channel must deny")
	}
}

func TestCanModerateChannel_RoleGranted(t *testing.T) {
	db, mock := newAccessDB(t)
	expectScope(mock, false, "public")
	expectNotBanned(mock)
	expectMembership(mock, true)
	expectRoles(mock, "can_delete_threads")

	ok, err := CanModerateChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected moderation rights")
	}
}

func TestCanModerateChannel_Denied(t *testing.T) {
	db, mock := newAccessDB(t)
	expectScope(mock, false, "public")
	expectNotBanned(mock)
	expectMembership(mock, true)
	expectRoles(mock) // no grants

	ok, err := CanModerateChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Error("expected no moderation rights")
	}
}
