package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func TestMessengerTransactionMiddlewareBindsAndCommits(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claims := &auth.Claims{UserID: "00000000-0000-0000-0000-000000000001"}
	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs(claims.UserID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	hookCalled := false
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("claims", claims)
		c.Next()
	})
	router.Use(MessengerTransactionMiddleware(db))
	router.GET("/", func(c *gin.Context) {
		QueueMessengerAfterCommit(c, func() { hookCalled = true })
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	if !hookCalled {
		t.Fatal("after-commit hook was not called")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations: %v", err)
	}
}

func TestMessengerTransactionMiddlewareRollsBackOnHandlerError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claims := &auth.Claims{UserID: "00000000-0000-0000-0000-000000000002"}
	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs(claims.UserID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectRollback()

	hookCalled := false
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("claims", claims)
		c.Next()
	})
	router.Use(MessengerTransactionMiddleware(db))
	router.GET("/", func(c *gin.Context) {
		QueueMessengerAfterCommit(c, func() { hookCalled = true })
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed"})
	})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/", nil))

	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
	if hookCalled {
		t.Fatal("after-commit hook ran after rollback")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations: %v", err)
	}
}

func TestMessengerTransactionMiddlewareRollsBackWhenBindingFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	claims := &auth.Claims{UserID: "00000000-0000-0000-0000-000000000003"}
	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs(claims.UserID).
		WillReturnError(sqlmock.ErrCancelled)
	mock.ExpectRollback()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("claims", claims)
		c.Next()
	})
	router.Use(MessengerTransactionMiddleware(db))
	router.GET("/", func(c *gin.Context) {
		t.Fatal("handler ran after RLS binding failed")
	})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/", nil))

	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("SQL expectations: %v", err)
	}
}

func TestMessengerTransactionMiddlewareRequiresClaims(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(MessengerTransactionMiddleware(db))
	router.GET("/", func(c *gin.Context) {
		t.Fatal("handler ran without claims")
	})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/", nil))
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected SQL: %v", err)
	}
}
