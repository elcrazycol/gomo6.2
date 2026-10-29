package gomosubperms

import "testing"

func TestUnion(t *testing.T) {
	a := map[string]bool{PermManageRoles: true}
	b := map[string]bool{PermManageChannels: true, PermManageRoles: false}
	u := Union(a, b, nil)
	if !u[PermManageRoles] || !u[PermManageChannels] {
		t.Fatalf("union lost grants: %v", u)
	}
	if len(u) != 2 {
		t.Fatalf("union should skip false, got %v", u)
	}
}

func TestAdminBypass(t *testing.T) {
	if !IsAdmin(map[string]bool{PermAdministrator: true}) {
		t.Fatal("administrator not detected")
	}
	if IsAdmin(map[string]bool{PermManageRoles: true}) {
		t.Fatal("false admin positive")
	}
	owner := OwnerPermissions()
	if !IsAdmin(owner) || !owner[PermBanMembers] || !owner[PermViewChannel] {
		t.Fatalf("owner grant incomplete: %v", owner)
	}
}

func TestApplyOverwritesDenyWins(t *testing.T) {
	base := map[string]bool{PermViewChannel: true, PermSendMessages: true}
	out := ApplyOverwrites(base,
		[]map[string]bool{{PermSendMessages: true}},
		[]map[string]bool{{PermSendMessages: true}})
	if !out[PermViewChannel] {
		t.Fatal("unrelated grant must survive")
	}
	if out[PermSendMessages] {
		t.Fatal("deny must win over allow")
	}
}

func TestCanManageRoleHierarchy(t *testing.T) {
	if !CanManageRole(true, false, 0, 100, false) {
		t.Fatal("owner must bypass")
	}
	if !CanManageRole(false, true, 0, 100, false) {
		t.Fatal("admin must bypass")
	}
	if CanManageRole(false, false, 5, 10, true) {
		t.Fatal("lower role must not manage higher role")
	}
	if !CanManageRole(false, false, 10, 5, true) {
		t.Fatal("higher role must manage lower role")
	}
	if CanManageRole(false, false, 10, 5, false) {
		t.Fatal("manage_roles required")
	}
	if CanManageRole(false, false, 5, 5, true) {
		t.Fatal("equal position must not manage")
	}
}
