package middleware

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

const sanctionLookupRe = `SELECT kind, reason, expires_at FROM user_sanctions`
const staffLookupRe = `SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role IN \('moderator', 'admin'\)\)`

func newGateContext(method string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/api/v1/anything", nil)
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

func newGateMock(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})
	return db, mock
}

func TestSanctionGate_BlocksBannedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock := newGateMock(t)

	mock.ExpectQuery(sanctionLookupRe).WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"kind", "reason", "expires_at"}).AddRow("ban", "спам", nil))
	mock.ExpectQuery(staffLookupRe).WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	reached := false
	c, w := newGateContext(http.MethodPost, &auth.Claims{UserID: "u2"})
	SanctionGateMiddleware(db, nil)(c)
	if !c.IsAborted() {
		reached = true
	}

	if reached {
		t.Fatal("expected the banned request to be aborted")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, `"code":"user_banned"`) || !strings.Contains(body, "спам") {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestSanctionGate_BlocksMutedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock := newGateMock(t)

	mock.ExpectQuery(sanctionLookupRe).WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"kind", "reason", "expires_at"}).AddRow("mute", "флуд", nil))
	mock.ExpectQuery(staffLookupRe).WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newGateContext(http.MethodPut, &auth.Claims{UserID: "u2"})
	SanctionGateMiddleware(db, nil)(c)

	if !c.IsAborted() || w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), `"code":"user_muted"`) {
		t.Fatalf("expected a muted 403, got code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestSanctionGate_LetsCleanUserThrough(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock := newGateMock(t)

	mock.ExpectQuery(sanctionLookupRe).WithArgs("u2").WillReturnError(sql.ErrNoRows)

	c, _ := newGateContext(http.MethodPost, &auth.Claims{UserID: "u2"})
	SanctionGateMiddleware(db, nil)(c)

	if c.IsAborted() {
		t.Fatal("a user without sanctions must not be blocked")
	}
}

func TestSanctionGate_ReadsAreNeverBlocked(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newGateMock(t) // no expectations: any query would be flagged

	c, _ := newGateContext(http.MethodGet, &auth.Claims{UserID: "u2"})
	SanctionGateMiddleware(db, nil)(c)

	if c.IsAborted() {
		t.Fatal("reads must pass the gate")
	}
}

func TestSanctionGate_StaffBypass(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock := newGateMock(t)

	mock.ExpectQuery(sanctionLookupRe).WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"kind", "reason", "expires_at"}).AddRow("ban", "ошибка", nil))
	mock.ExpectQuery(staffLookupRe).WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, _ := newGateContext(http.MethodPost, &auth.Claims{UserID: "u2"})
	SanctionGateMiddleware(db, nil)(c)

	if c.IsAborted() {
		t.Fatal("staff must bypass the gate")
	}
}

// A sanctioned user must still be able to appeal: that one POST is exempt.
func TestSanctionGate_AllowsAppealSubmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newGateMock(t) // no expectations: no lookup may happen for the exemption

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/moderation/appeals", nil)
	c.Set("claims", &auth.Claims{UserID: "u2"})

	SanctionGateMiddleware(db, nil)(c)

	if c.IsAborted() {
		t.Fatal("appeal submission must bypass the sanction gate")
	}
}
