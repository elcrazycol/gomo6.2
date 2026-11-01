package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// ─── Service account enforcement ───────────────────────────────────────────

func TestLogin_ServiceAccount_Blocked(t *testing.T) {
	h, mock := setupAuthHandler(t)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("gomo6").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "display_name", "email", "domain", "password_hash",
			"totp_enabled", "totp_secret", "trusted_devices", "created_at", "is_service",
		}).AddRow("svc-1", "gomo6", "gomo6", nil, "localhost:8080",
			"$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			false, nil, nil, time.Now(), true))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"username":              "gomo6",
		"password":              "anything1",
		"cf_turnstile_response": "test-token",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for service account login, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Admin service sudo ────────────────────────────────────────────────────

func newAdminServiceHandlerWithMock(t *testing.T) (*AdminServiceHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})
	return NewAdminServiceHandler(db, nil, nil, nil, nil), mock
}

func TestServiceSudo_SwapsIdentityAndStashesAdmin(t *testing.T) {
	h, mock := newAdminServiceHandlerWithMock(t)
	mock.ExpectQuery(`SELECT id, username FROM users WHERE username`).
		WithArgs("gomo6").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username"}).AddRow("svc-1", "gomo6"))

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/service/wall", nil)
	c.Set("claims", &auth.Claims{UserID: "admin-1", Username: "boss"})

	h.ServiceSudoMiddleware()(c)

	if c.IsAborted() {
		t.Fatalf("expected Next, got abort %d: %s", w.Code, w.Body.String())
	}
	claims, _ := c.Get("claims")
	swapped, ok := claims.(*auth.Claims)
	if !ok || swapped.UserID != "svc-1" || swapped.Username != "gomo6" {
		t.Fatalf("claims not swapped to service identity: %+v", claims)
	}
	adminID, _ := c.Get("adminID")
	if adminID != "admin-1" {
		t.Fatalf("admin id not stashed: %v", adminID)
	}
}

func TestServiceSudo_NoServiceAccount_Refuses(t *testing.T) {
	h, mock := newAdminServiceHandlerWithMock(t)
	mock.ExpectQuery(`SELECT id, username FROM users WHERE username`).
		WithArgs("gomo6").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username"}))

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/service/wall", nil)
	c.Set("claims", &auth.Claims{UserID: "admin-1", Username: "boss"})

	h.ServiceSudoMiddleware()(c)

	if !c.IsAborted() {
		t.Fatal("expected abort when service account missing")
	}
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestServiceAccountInfo_ReturnsIdentity(t *testing.T) {
	h, mock := newAdminServiceHandlerWithMock(t)
	mock.ExpectQuery(`SELECT id, username FROM users WHERE username`).
		WithArgs("gomo6").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username"}).AddRow("svc-1", "gomo6"))
	mock.ExpectQuery(`SELECT display_name FROM users WHERE id`).
		WithArgs("svc-1").
		WillReturnRows(sqlmock.NewRows([]string{"display_name"}).AddRow("gomo6 Official"))

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/service/account", nil)
	c.Set("claims", &auth.Claims{UserID: "admin-1", Username: "boss"})

	h.ServiceAccountInfo(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRequireFreshReauth(t *testing.T) {
	mr := setupTestRedis(t)
	authSvc := auth.NewAuthService()
	authSvc.SetRedis(mr)

	mkCtx := func(token string) (*gin.Context, *httptest.ResponseRecorder) {
		gin.SetMode(gin.TestMode)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/service/wall", nil)
		c.Set("claims", &auth.Claims{UserID: "admin-1", Username: "boss"})
		if token != "" {
			c.Request.Header.Set("X-Reauth-Token", token)
		}
		return c, w
	}

	// Missing token → 401.
	c, w := mkCtx("")
	RequireFreshReauth(authSvc)(c)
	if !c.IsAborted() || w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", w.Code)
	}

	// Garbage token → 403.
	c, w = mkCtx("garbage")
	RequireFreshReauth(authSvc)(c)
	if !c.IsAborted() || w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for garbage token, got %d", w.Code)
	}

	// Fresh token → passes and burns (single-use).
	valid, err := authSvc.GenerateReauthToken("admin-1")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	c, w = mkCtx(valid)
	RequireFreshReauth(authSvc)(c)
	if c.IsAborted() {
		t.Fatalf("expected pass, got %d: %s", w.Code, w.Body.String())
	}
	c2, w2 := mkCtx(valid)
	RequireFreshReauth(authSvc)(c2)
	if !c2.IsAborted() || w2.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on replay, got %d", w2.Code)
	}
}
