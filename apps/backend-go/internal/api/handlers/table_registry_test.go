package handlers

import "testing"

// TestGenericTables_RegistryConsistency guards the invariants the generic CRUD
// surface relies on. The registry (table_registry.go) is the single source of
// truth for the universal routes, the handler allow-list and the
// permissions/scopes — a broken entry here silently changes routing or
// security posture, so the shape of the data itself is locked in.
func TestGenericTables_RegistryConsistency(t *testing.T) {
	seen := make(map[string]bool, len(genericTables))
	var prev string
	for i, meta := range genericTables {
		if meta.Name == "" {
			t.Fatalf("entry %d has an empty name", i)
		}
		if seen[meta.Name] {
			t.Fatalf("duplicate table %q in registry", meta.Name)
		}
		seen[meta.Name] = true
		if i > 0 && meta.Name < prev {
			t.Fatalf("registry not sorted alphabetically: %q after %q", meta.Name, prev)
		}
		prev = meta.Name

		// Write-denied tables must not declare write routes: the deny check in
		// HandleTableRequest runs before the method dispatch, so a routed write
		// would be a silent 403 — better to fail loudly here.
		if meta.WriteDenied && len(meta.Writes) > 0 {
			t.Errorf("table %q: WriteDenied but declares %d write route(s)", meta.Name, len(meta.Writes))
		}
		// Tables with write routes must name the middleware group they go on.
		if len(meta.Writes) > 0 && meta.WriteGroup == NoWrites {
			t.Errorf("table %q: declares write routes but WriteGroup is NoWrites", meta.Name)
		}
		// Upsert tables force the caller's user_id on POST (enforcePostOwnership
		// runs before upsertInsertQuery) — an OwnNone upsert could insert rows
		// for an arbitrary user_id from the body.
		if meta.Upsert && meta.PostOwner == OwnNone {
			t.Errorf("table %q: Upsert but PostOwner is OwnNone", meta.Name)
		}

		// Every table with a PUT/DELETE route must have SOME ownership
		// enforcement for those writes: the generic WriteOwner scope, gomosub
		// board permission gating (GomosubManagement), or explicit handler/
		// middleware scoping (WriteScopedByHandler, e.g. the emoji tables).
		// Without this, a new writable table — added to the registry by
		// someone (or an AI) who forgets the owner — would accept a PUT/DELETE
		// with only an id filter and update/delete ANY user's rows (IDOR,
		// no `user_id = caller` predicate).
		if meta.WriteOwner == OwnNone && !meta.GomosubManagement && !meta.WriteScopedByHandler {
			for _, r := range meta.Writes {
				if r.Method == "PUT" || r.Method == "DELETE" {
					t.Errorf("table %q: %s route without ownership enforcement (WriteOwner=OwnNone, GomosubManagement=false, WriteScopedByHandler=false)", meta.Name, r.Method)
					break
				}
			}
		}
		// Guest-read tables are reachable by anonymous callers; ReadDenied
		// tables are sensitive and must not be guest-visible.
		if meta.ReadAccess == GuestRead && meta.ReadDenied {
			t.Errorf("table %q: GuestRead but ReadDenied", meta.Name)
		}
		// Wildcard-less reads are a deliberate exception (emoji tables and
		// /<table>/<id> URL forms) — flag nothing, but require ReadAccess.
		if (meta.ReadAccess != NoRead) != meta.ReadWildcard && meta.ReadAccess == NoRead {
			t.Errorf("table %q: NoRead but ReadWildcard set", meta.Name)
		}
	}
	// The allow-list must actually contain the tables the routes are generated
	// for (a table with routes but no registry entry would 404 in the handler).
	for _, meta := range genericTables {
		if meta.ReadAccess != NoRead || len(meta.Writes) > 0 {
			if GenericTableByName(meta.Name) == nil {
				t.Errorf("table %q: routed but missing from GenericTableByName", meta.Name)
			}
		}
	}
}

// TestGenericTables_RoutedTablesHaveRegistryEntry cross-checks the handler's
// deny lists against the registry: every table the legacy switch functions
// know about must resolve to the same verdict the registry gives.
func TestGenericTables_DenyListsMatchRegistry(t *testing.T) {
	// Spot-check the security-critical entries that the old switch statements
	// hardcoded — the registry must agree with them exactly.
	cases := []struct {
		table        string
		readDenied   bool
		writeDenied  bool
		gomosubMgmt  bool
		userScoped   bool
		guestVisible bool
	}{
		{"user_roles", false, true, false, true, false},
		{"achievements", false, true, false, false, true},
		{"user_achievements", false, true, false, true, true},
		{"polls", false, true, false, false, true},
		{"gomosub_invites", true, true, false, false, false},
		{"reports", true, false, false, false, false},
		{"user_bans", true, false, false, false, false},
		{"channels", false, false, true, false, true},
		{"gomosub_roles", false, false, true, false, false},
		{"channel_permissions", false, false, true, false, false},
		{"gomosub_memberships", false, false, true, true, false},
		{"privacy_settings", false, false, false, true, false},
		{"profile_wall_posts", false, false, false, true, true},
		{"emoji_packs", false, false, false, false, true},
		{"custom_emojis", false, false, false, false, true},
		{"user_emoji_subscriptions", false, false, false, true, true},
	}
	for _, tc := range cases {
		meta := GenericTableByName(tc.table)
		if meta == nil {
			t.Errorf("table %q: missing from registry", tc.table)
			continue
		}
		if meta.ReadDenied != tc.readDenied {
			t.Errorf("table %q: ReadDenied = %v, want %v", tc.table, meta.ReadDenied, tc.readDenied)
		}
		if meta.WriteDenied != tc.writeDenied {
			t.Errorf("table %q: WriteDenied = %v, want %v", tc.table, meta.WriteDenied, tc.writeDenied)
		}
		if meta.GomosubManagement != tc.gomosubMgmt {
			t.Errorf("table %q: GomosubManagement = %v, want %v", tc.table, meta.GomosubManagement, tc.gomosubMgmt)
		}
		if meta.UserScopedRead != tc.userScoped {
			t.Errorf("table %q: UserScopedRead = %v, want %v", tc.table, meta.UserScopedRead, tc.userScoped)
		}
		guest := meta.ReadAccess == GuestRead
		if guest != tc.guestVisible {
			t.Errorf("table %q: guest-visible = %v, want %v", tc.table, guest, tc.guestVisible)
		}
	}
}
