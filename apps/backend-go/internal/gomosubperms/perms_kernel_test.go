package gomosubperms

import (
	"database/sql/driver"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// ─── LoadEffective: the permission kernel ───────────────────────────
// These tests pin the two-query shape (membership check, then the role
// union) and the @everyone-members-only rule, which every read/write gate
// in the codebase delegates to.

// expectMembership mocks the EXISTS membership probe.
func expectMembership(mock sqlmock.Sqlmock, board, user string, member bool) {
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(board, user).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(member))
}

// expectUnion mocks the 5-column role union; roles are (id, name, perms, pos, everyone).
func expectUnion(mock sqlmock.Sqlmock, board, user string, rows ...[]driver.Value) {
	r := sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"})
	for _, row := range rows {
		r.AddRow(row...)
	}
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(board, user).
		WillReturnRows(r)
}

const (
	kBoard = "550e8400-e29b-41d4-a716-446655440000"
	kUser  = "660e8400-e29b-41d4-a716-446655442222"
)

func TestLoadEffective_MemberUnionAndTop(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, kBoard, kUser, true)
	expectUnion(mock, kBoard, kUser,
		[]driver.Value{"r-every", "@everyone", []byte(`{"view_channel": true, "send_messages": true}`), 0, true},
		[]driver.Value{"r-mod", "mods", []byte(`{"can_manage_channels": true, "kick_members": true}`), 5, false},
	)

	eff, err := LoadEffective(db, kBoard, kUser)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !eff.IsMember {
		t.Fatal("member not detected")
	}
	if eff.Top() != 5 {
		t.Fatalf("top should be the mod role position 5, got %d", eff.Top())
	}
	perms := eff.Perms()
	for _, k := range []string{PermViewChannel, PermSendMessages, PermManageChannels, PermKickMembers} {
		if !perms[k] {
			t.Fatalf("union lost grant %q: %v", k, perms)
		}
	}
	if eff.IsAdmin() {
		t.Fatal("non-admin resolved as admin")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestLoadEffective_OutsiderSkipsEveryone(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, kBoard, kUser, false)
	// The union still returns the @everyone row (no membership filter in
	// SQL); the kernel must skip it for outsiders.
	expectUnion(mock, kBoard, kUser,
		[]driver.Value{"r-every", "@everyone", []byte(`{"view_channel": true}`), 0, true},
	)

	eff, err := LoadEffective(db, kBoard, kUser)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eff.IsMember {
		t.Fatal("outsider detected as member")
	}
	if len(eff.Roles) != 0 {
		t.Fatalf("@everyone must be skipped for outsiders, got %v", eff.Roles)
	}
	if eff.Top() != -1 {
		t.Fatalf("outsider top must be -1, got %d", eff.Top())
	}
	if eff.Perms()[PermViewChannel] {
		t.Fatal("outsider must not inherit @everyone grants")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestLoadEffective_EveryoneOnlyMemberTopZero(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, kBoard, kUser, true)
	expectUnion(mock, kBoard, kUser,
		[]driver.Value{"r-every", "@everyone", []byte(`{"view_channel": true}`), 0, true},
	)

	eff, err := LoadEffective(db, kBoard, kUser)
	if err != nil {
		t.Fatal(err)
	}
	if eff.Top() != 0 {
		t.Fatalf("@everyone-only member top must be 0, got %d", eff.Top())
	}
	if !eff.Perms()[PermViewChannel] {
		t.Fatal("member must inherit @everyone base grant")
	}
}

func TestLoadEffective_AdminDetected(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, kBoard, kUser, true)
	expectUnion(mock, kBoard, kUser,
		[]driver.Value{"r-adm", "admins", []byte(`{"administrator": true}`), 9, false},
	)

	eff, err := LoadEffective(db, kBoard, kUser)
	if err != nil {
		t.Fatal(err)
	}
	if !eff.IsAdmin() {
		t.Fatal("administrator grant not detected")
	}
	if eff.Top() != 9 {
		t.Fatalf("top should be 9, got %d", eff.Top())
	}
}

func TestLoadEffective_ExplicitFalseCountsAsAbsent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, kBoard, kUser, true)
	expectUnion(mock, kBoard, kUser,
		[]driver.Value{"r-1", "r", []byte(`{"view_channel": false, "send_messages": true}`), 3, false},
	)

	eff, err := LoadEffective(db, kBoard, kUser)
	if err != nil {
		t.Fatal(err)
	}
	if eff.Perms()[PermViewChannel] {
		t.Fatal("explicit false must count as absent (binary role permissions)")
	}
	if !eff.Perms()[PermSendMessages] {
		t.Fatal("true grant lost")
	}
}

func TestLoadEffective_Guards(t *testing.T) {
	// Nil DB and empty ids never touch the database and never fail.
	eff, err := LoadEffective(nil, kBoard, kUser)
	if err != nil || eff == nil || eff.IsMember || eff.Top() != -1 {
		t.Fatalf("nil db must yield an empty effective, got %+v err=%v", eff, err)
	}

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	eff, err = LoadEffective(db, "", "")
	if err != nil || eff == nil || len(eff.Perms()) != 0 {
		t.Fatalf("empty ids must yield an empty effective, got %+v err=%v", eff, err)
	}
}

func TestLoadEffective_UnionError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectMembership(mock, kBoard, kUser, true)
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(kBoard, kUser).
		WillReturnError(errors.New("boom"))

	if _, err := LoadEffective(db, kBoard, kUser); err == nil {
		t.Fatal("union query error must propagate")
	}
}

func TestRoleScopeCTE_Placeholders(t *testing.T) {
	cte := RoleScopeCTE("$3", "$7")
	for _, want := range []string{"my_roles", "$3", "$7", "gomosub_member_roles"} {
		if !containsStr(cte, want) {
			t.Fatalf("RoleScopeCTE missing %q:\n%s", want, cte)
		}
	}
}

func TestResolveChannel_Wrapper(t *testing.T) {
	base := map[string]bool{PermViewChannel: true}
	ow := ChannelOverwrites{
		EveryoneAllow: map[string]bool{},
		EveryoneDeny:  map[string]bool{PermViewChannel: true},
		RoleAllow:     map[string]bool{},
		RoleDeny:      map[string]bool{},
	}
	if got := ResolveChannel(base, ow); got[PermViewChannel] {
		t.Fatal("ResolveChannel must apply the @everyone deny")
	}
	if got := ResolveChannel(map[string]bool{}, ChannelOverwrites{
		EveryoneAllow: map[string]bool{PermViewChannel: true},
		EveryoneDeny:  map[string]bool{},
		RoleAllow:     map[string]bool{},
		RoleDeny:      map[string]bool{},
	}); !got[PermViewChannel] {
		t.Fatal("ResolveChannel must apply the @everyone allow")
	}
}

func containsStr(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
