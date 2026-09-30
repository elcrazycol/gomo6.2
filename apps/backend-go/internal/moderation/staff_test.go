package moderation

import (
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const adminRe = `SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role = 'admin'\)`

func TestGrantRole_Success(t *testing.T) {
	h, mock := setupHandler(t)
	mock.ExpectQuery(adminRe).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT id::text FROM users WHERE username = \$1`).
		WithArgs("bob").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(cardUserID))

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO user_roles \(user_id, role\) VALUES \(\$1, \$2\) ON CONFLICT`).
		WithArgs(cardUserID, "moderator").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "role_granted", TargetUser, cardUserID, nil, "moderator", nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/staff",
		map[string]string{"username": "bob", "role": "moderator"}, claimsFor("u1"), nil)
	h.GrantRole(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestGrantRole_RejectsNonAdmin(t *testing.T) {
	h, mock := setupHandler(t)
	mock.ExpectQuery(adminRe).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/moderation/staff",
		map[string]string{"username": "bob", "role": "admin"}, claimsFor("u1"), nil)
	h.GrantRole(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestGrantRole_ConflictingRoleReturns409(t *testing.T) {
	h, mock := setupHandler(t)
	mock.ExpectQuery(adminRe).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT id::text FROM users WHERE username`).
		WithArgs("bob").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(cardUserID))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO user_roles`).WillReturnResult(sqlmock.NewResult(0, 0)) // conflict
	mock.ExpectExec(`INSERT INTO moderation_actions`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/staff",
		map[string]string{"username": "bob", "role": "helper"}, claimsFor("u1"), nil)
	h.GrantRole(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestGrantRole_RejectsAdminRole(t *testing.T) {
	h, mock := setupHandler(t)
	mock.ExpectQuery(adminRe).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/moderation/staff",
		map[string]string{"username": "bob", "role": "admin"}, claimsFor("u1"), nil)
	h.GrantRole(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for granting admin, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestRevokeRole_RejectsAdminRole(t *testing.T) {
	h, mock := setupHandler(t)
	mock.ExpectQuery(adminRe).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/moderation/staff/"+cardUserID+"/admin", nil, claimsFor("u1"),
		map[string]string{"userId": cardUserID, "role": "admin"})
	c.Request.Method = http.MethodDelete
	h.RevokeRole(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for revoking admin, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestListStaff_HelperCanRead(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, true)
	mock.ExpectQuery(`(?s)SELECT u\.id::text, u\.username.*array_agg\(r\.role.*FROM user_roles r`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "avatar_url", "roles"}).
			AddRow(cardUserID, "bob", "Боб", nil, []byte("{moderator}")))

	c, w := newGETContext("/api/v1/moderation/staff", claimsFor("u1"))
	h.ListStaff(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}
