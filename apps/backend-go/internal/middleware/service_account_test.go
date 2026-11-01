package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/google/uuid"
)

func TestDenyServiceAccount_Blocks(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/messenger/conversations", nil)
	c.Set("claims", &auth.Claims{UserID: "svc-1"})

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COALESCE\(is_service, false\) FROM users WHERE id`).
		WithArgs("svc-1").
		WillReturnRows(sqlmock.NewRows([]string{"is_service"}).AddRow(true))

	DenyServiceAccount(db, nil)(c)

	if !c.IsAborted() {
		t.Fatal("expected abort for service account")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled: %v", err)
	}
}

func TestDenyServiceAccount_AllowsRegular(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/messenger/conversations", nil)
	c.Set("claims", &auth.Claims{UserID: uuid.New().String()})

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COALESCE\(is_service, false\) FROM users WHERE id`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"is_service"}).AddRow(false))

	DenyServiceAccount(db, nil)(c)
	if c.IsAborted() {
		t.Fatalf("regular user must pass, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled: %v", err)
	}
}
