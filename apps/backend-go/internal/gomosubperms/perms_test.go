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

func TestTieredRoleAllowOverridesEveryoneDeny(t *testing.T) {
	// The lockdown-server recipe: @everyone is denied view, one role is
	// explicitly allowed — the member must see the channel.
	base := map[string]bool{}
	ow := ChannelOverwrites{
		EveryoneAllow: map[string]bool{},
		EveryoneDeny:  map[string]bool{PermViewChannel: true},
		RoleAllow:     map[string]bool{PermViewChannel: true},
		RoleDeny:      map[string]bool{},
	}
	resolved, _ := ow.Resolve(base)
	if !resolved[PermViewChannel] {
		t.Fatal("role allow must override an @everyone deny")
	}
	if ow.Denies(PermViewChannel) {
		t.Fatal("upheld-deny must be false when a role allow overrides it")
	}
}

func TestTieredRoleDenyAlwaysWins(t *testing.T) {
	// An explicit role deny beats everything: base grant + role allow.
	base := map[string]bool{PermViewChannel: true, PermSendMessages: true}
	ow := ChannelOverwrites{
		EveryoneAllow: map[string]bool{},
		EveryoneDeny:  map[string]bool{},
		RoleAllow:     map[string]bool{PermViewChannel: true, PermSendMessages: true},
		RoleDeny:      map[string]bool{PermViewChannel: true, PermSendMessages: true},
	}
	resolved, denied := ow.Resolve(base)
	if resolved[PermViewChannel] || resolved[PermSendMessages] {
		t.Fatal("role deny must strip the grant")
	}
	if !denied[PermViewChannel] || !ow.Denies(PermSendMessages) {
		t.Fatal("role deny must be reported as upheld")
	}
}

func TestTieredEveryoneDenyHoldsWithoutRoleAllow(t *testing.T) {
	base := map[string]bool{PermViewChannel: true}
	ow := ChannelOverwrites{
		EveryoneAllow: map[string]bool{},
		EveryoneDeny:  map[string]bool{PermViewChannel: true},
		RoleAllow:     map[string]bool{},
		RoleDeny:      map[string]bool{},
	}
	resolved, _ := ow.Resolve(base)
	if resolved[PermViewChannel] {
		t.Fatal("unopposed @everyone deny must hide the channel")
	}
	if !ow.Denies(PermViewChannel) {
		t.Fatal("unopposed @everyone deny must be upheld")
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
