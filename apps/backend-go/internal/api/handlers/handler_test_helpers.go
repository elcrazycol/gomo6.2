package handlers

import (
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

// setupPostsHandler creates a PostsHandler with a mock DB.
func setupPostsHandler(t *testing.T) (*PostsHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewPostsHandler(db)
	return handler, mock
}

// setupThreadsHandler creates a ThreadsHandler with a mock DB.
func setupThreadsHandler(t *testing.T) (*ThreadsHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewThreadsHandler(db)
	return handler, mock
}

// setupBoardsHandler creates a BoardsHandler with a mock DB.
func setupBoardsHandler(t *testing.T) (*BoardsHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewBoardsHandler(db)
	return handler, mock
}

// setupProfilesHandler creates a ProfilesHandler with a mock DB.
func setupProfilesHandler(t *testing.T) (*ProfilesHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewProfilesHandler(db)
	return handler, mock
}

// setupLikesHandler creates a LikesHandler with a mock DB (redis = nil, skips cache/bot paths).
func setupLikesHandler(t *testing.T) (*LikesHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewLikesHandler(db, nil) // redis = nil to skip cache/bot paths
	return handler, mock
}

// setupNotificationsHandler creates a NotificationsHandler with a mock DB (redis = nil).
func setupNotificationsHandler(t *testing.T) (*NotificationsHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewNotificationsHandler(db)
	return handler, mock
}

// ─── gin test-context builders ─────────────────────────────────────────────
//
// The anonymous wrappers below delegate to internal/testutil — the single
// implementation of these builders (added for the messenger extraction).
// They exist so the ~400 existing call sites in this package's tests keep
// compiling unchanged; new test code should call testutil directly.

// newGETContext creates a gin test context for a GET request.
// Returns (context, *httptest.ResponseRecorder).
func newGETContext(url string, queryParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	return testutil.NewGETContext(url, queryParams)
}

func newGETContextWithParams(url string, queryParams map[string]string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	return testutil.NewGETContextWithParams(url, queryParams, pathParams)
}

// newPOSTContext creates a gin test context for a POST request with JSON body and auth claims.
// Returns (context, *httptest.ResponseRecorder).
func newPOSTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	return testutil.NewPOSTContext(url, body, claims, pathParams)
}

// newDELETEPContext creates a gin test context for a DELETE request.
// Returns (context, *httptest.ResponseRecorder).
func newDELETEPContext(url string, queryParams map[string]string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	return testutil.NewDELETEContext(url, queryParams, pathParams)
}

// newDELETEPContextWithClaims creates a gin test context for a DELETE request
// with auth claims and path params (same shape as newDELETEPContext but sets
// the authenticated claims on the context).
func newDELETEPContextWithClaims(url string, queryParams map[string]string, pathParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	return testutil.NewDELETEContextWithClaims(url, queryParams, pathParams, claims)
}

// newPUTContext creates a gin test context for a PUT request with JSON body, auth claims, and path params.
// Returns (context, *httptest.ResponseRecorder).
func newPUTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	return testutil.NewPUTContext(url, body, claims, pathParams)
}

// setupAuthHandler creates an AuthHandler with a mock DB.
func setupAuthHandler(t *testing.T) (*AuthHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewAuthHandler(db)
	return handler, mock
}

// newGETContextWithClaims creates a gin test context for GET with auth claims.
func newGETContextWithClaims(urlStr string, queryParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	return testutil.NewGETContextWithClaims(urlStr, queryParams, claims)
}
