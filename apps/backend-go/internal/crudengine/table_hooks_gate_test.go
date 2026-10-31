package crudengine

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

// ─── GomoSub write gate + role hierarchy ────────────────────────────
// checkGomosubWritePermission is the management-plane gate for the generic
// surface; checkRoleHierarchy is the Discord rule (touch only roles below
// your top, grant only what you hold, @everyone is system-managed).

func TestCheckGomosubWritePermission_OwnerBypass(t *testing.T) {
	h, mock := setupEngine(t)
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("b1").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))

	c, _ := newRequestContext("POST", "/api/v1/gomosub_roles", map[string]interface{}{"board_id": "b1"},
		&auth.Claims{UserID: "owner-9"})
	if !h.checkGomosubWritePermission(c, "gomosub_roles") {
		t.Fatal("board owner must bypass the management gate")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCheckGomosubWritePermission_StrangerDenied(t *testing.T) {
	h, mock := setupEngine(t)
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("b1").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs("b1", "stranger").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs("b1", "stranger").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}))

	c, w := newRequestContext("POST", "/api/v1/gomosub_roles", map[string]interface{}{"board_id": "b1"},
		&auth.Claims{UserID: "stranger"})
	if h.checkGomosubWritePermission(c, "gomosub_roles") {
		t.Fatal("stranger must be denied the management gate")
	}
	if w.Code != 403 {
		t.Fatalf("expected 403, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCheckGomosubWritePermission_AdminBypass(t *testing.T) {
	h, mock := setupEngine(t)
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs("b1").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs("b1", "adm").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs("b1", "adm").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}).
			AddRow("r-adm", "admins", []byte(`{"administrator": true}`), 9, false))

	c, _ := newRequestContext("POST", "/api/v1/channels", map[string]interface{}{"board_id": "b1"},
		&auth.Claims{UserID: "adm"})
	if !h.checkGomosubWritePermission(c, "channels") {
		t.Fatal("administrator must bypass the management gate")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCheckRoleHierarchy_PostRole(t *testing.T) {
	h, _ := setupEngine(t)
	perms := map[string]bool{"can_manage_roles": true, "can_manage_channels": true}

	// @everyone flag: denied.
	c, w := newRequestContext("POST", "/api/v1/gomosub_roles",
		map[string]interface{}{"board_id": "b1", "name": "x", "is_everyone": true},
		&auth.Claims{UserID: "u1"})
	if h.checkRoleHierarchy(c, "gomosub_roles", "b1", perms, 5) || w.Code != 403 {
		t.Fatal("@everyone creation must be denied")
	}

	// Reserved name: denied.
	c2, w2 := newRequestContext("POST", "/api/v1/gomosub_roles",
		map[string]interface{}{"board_id": "b1", "name": "@everyone"},
		&auth.Claims{UserID: "u1"})
	if h.checkRoleHierarchy(c2, "gomosub_roles", "b1", perms, 5) || w2.Code != 403 {
		t.Fatal("reserved @everyone name must be denied")
	}

	// Position at/above top: denied.
	c3, w3 := newRequestContext("POST", "/api/v1/gomosub_roles",
		map[string]interface{}{"board_id": "b1", "name": "x", "position": 5},
		&auth.Claims{UserID: "u1"})
	if h.checkRoleHierarchy(c3, "gomosub_roles", "b1", perms, 5) || w3.Code != 403 {
		t.Fatal("role at own top must be denied")
	}

	// Granting an unheld permission: denied.
	c4, w4 := newRequestContext("POST", "/api/v1/gomosub_roles",
		map[string]interface{}{"board_id": "b1", "name": "x", "position": 1,
			"permissions": map[string]interface{}{"ban_members": true}},
		&auth.Claims{UserID: "u1"})
	if h.checkRoleHierarchy(c4, "gomosub_roles", "b1", perms, 5) || w4.Code != 403 {
		t.Fatal("granting an unheld permission must be denied")
	}

	// Held grant below top: allowed.
	c5, _ := newRequestContext("POST", "/api/v1/gomosub_roles",
		map[string]interface{}{"board_id": "b1", "name": "x", "position": 1,
			"permissions": map[string]interface{}{"can_manage_channels": true}},
		&auth.Claims{UserID: "u1"})
	if !h.checkRoleHierarchy(c5, "gomosub_roles", "b1", perms, 5) {
		t.Fatal("held grant below top must be allowed")
	}
}

func TestCheckRoleHierarchy_DeleteRole(t *testing.T) {
	h, mock := setupEngine(t)
	perms := map[string]bool{"can_manage_roles": true}

	fetch := func(roleID, boardID string, pos int, everyone bool) {
		mock.ExpectQuery(`SELECT board_id, position, COALESCE\(is_everyone, false\) FROM gomosub_roles WHERE id = \$1`).
			WithArgs(roleID).
			WillReturnRows(sqlmock.NewRows([]string{"board_id", "position", "is_everyone"}).
				AddRow(boardID, pos, everyone))
	}

	// Deleting @everyone: denied.
	fetch("r-every", "b1", 0, true)
	c, w := newRequestContext("DELETE", "/api/v1/gomosub_roles?id=eq.r-every", nil, &auth.Claims{UserID: "u1"})
	if h.checkRoleHierarchy(c, "gomosub_roles", "b1", perms, 9) || w.Code != 403 {
		t.Fatal("@everyone deletion must be denied")
	}

	// Deleting at/above top: denied.
	fetch("r-high", "b1", 9, false)
	c2, w2 := newRequestContext("DELETE", "/api/v1/gomosub_roles?id=eq.r-high", nil, &auth.Claims{UserID: "u1"})
	if h.checkRoleHierarchy(c2, "gomosub_roles", "b1", perms, 9) || w2.Code != 403 {
		t.Fatal("deleting a role above own top must be denied")
	}

	// Deleting below top: allowed.
	fetch("r-low", "b1", 1, false)
	c3, _ := newRequestContext("DELETE", "/api/v1/gomosub_roles?id=eq.r-low", nil, &auth.Claims{UserID: "u1"})
	if !h.checkRoleHierarchy(c3, "gomosub_roles", "b1", perms, 9) {
		t.Fatal("deleting a role below own top must be allowed")
	}

	// Missing target: allowed through (downstream matches nothing, no leak).
	mock.ExpectQuery(`SELECT board_id, position, COALESCE\(is_everyone, false\) FROM gomosub_roles WHERE id = \$1`).
		WithArgs("r-ghost").
		WillReturnError(sql.ErrNoRows)
	c4, _ := newRequestContext("DELETE", "/api/v1/gomosub_roles?id=eq.r-ghost", nil, &auth.Claims{UserID: "u1"})
	if !h.checkRoleHierarchy(c4, "gomosub_roles", "b1", perms, 9) {
		t.Fatal("missing target must pass through without leaking existence")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestLoadActorGrants(t *testing.T) {
	h, mock := setupEngine(t)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs("b1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs("b1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}).
			AddRow("r1", "mods", []byte(`{"can_manage_roles": true}`), 4, false))

	perms, top, err := loadActorGrants(h.db, "b1", "u1", true)
	if err != nil {
		t.Fatal(err)
	}
	if !perms["can_manage_roles"] || top != 4 {
		t.Fatalf("unexpected grants: %v top=%d", perms, top)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestFetchRoleTarget_NotFound(t *testing.T) {
	h, mock := setupEngine(t)
	mock.ExpectQuery(`SELECT board_id, position, COALESCE\(is_everyone, false\) FROM gomosub_roles WHERE id = \$1`).
		WithArgs("r-ghost").
		WillReturnError(sql.ErrNoRows)
	if _, err := fetchRoleTarget(h.db, "r-ghost"); err == nil {
		t.Fatal("expected error for missing role")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestGomosubRequestRoleID(t *testing.T) {
	c, _ := newRequestContext("DELETE", "/api/v1/gomosub_member_roles?role_id=eq.r1", nil, &auth.Claims{UserID: "u1"})
	if got := gomosubRequestRoleID(c); got != "r1" {
		t.Fatalf("query filter role_id not extracted, got %q", got)
	}
	c2, _ := newRequestContext("POST", "/api/v1/gomosub_member_roles",
		map[string]interface{}{"role_id": "r2"}, &auth.Claims{UserID: "u1"})
	if got := gomosubRequestRoleID(c2); got != "r2" {
		t.Fatalf("body role_id not extracted, got %q", got)
	}
}
