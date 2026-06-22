package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
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

// newGETContext creates a gin test context for a GET request.
// Returns (context, *httptest.ResponseRecorder).
func newGETContext(url string, queryParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	q := req.URL.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()
	c.Request = req
	return c, w
}

func newGETContextWithParams(url string, queryParams map[string]string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	q := req.URL.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()
	c.Request = req
	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}
	return c, w
}

// newPOSTContext creates a gin test context for a POST request with JSON body and auth claims.
// Returns (context, *httptest.ResponseRecorder).
func newPOSTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(http.MethodPost, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}

// newDELETEPContext creates a gin test context for a DELETE request.
// Returns (context, *httptest.ResponseRecorder).
func newDELETEPContext(url string, queryParams map[string]string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, url, nil)
	q := req.URL.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}

	return c, w
}

// newPUTContext creates a gin test context for a PUT request with JSON body, auth claims, and path params.
// Returns (context, *httptest.ResponseRecorder).
func newPUTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(http.MethodPut, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
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

// setupRPCHandler creates an RPCHandler with a mock DB.
func setupRPCHandler(t *testing.T) (*RPCHandler, sqlmock.Sqlmock) {
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

	handler := NewRPCHandler(db)
	return handler, mock
}

// setupUniversalHandler creates a UniversalHandler with a mock DB (hub=nil, redis=nil).
func setupUniversalHandler(t *testing.T) (*UniversalHandler, sqlmock.Sqlmock) {
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

	handler := NewUniversalHandler(db, nil) // hub=nil skips websocket events
	return handler, mock
}

// newGETContextWithClaims creates a gin test context for GET with auth claims.
func newGETContextWithClaims(urlStr string, queryParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	u, _ := url.Parse(urlStr)
	q := u.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()

	req := httptest.NewRequest(http.MethodGet, u.String(), nil)
	req.URL.RawQuery = q.Encode()
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}

// newRPCGETContext creates a gin test context for RPC methods that use c.Query() parameters.
// RPC handlers are called via POST /rpc/<name> but read from query params.
func newRPCGETContext(queryParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	req := httptest.NewRequest(http.MethodPost, "/rpc/test", nil)
	q := req.URL.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()
	c.Request = req

	return c, w
}

// newRPCPostContext creates a gin test context for RPC methods that use JSON body.
func newRPCPostContext(body interface{}, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(http.MethodPost, "/rpc/test", bodyReader)
	req.Header.Set("Content-Type", "application/json")

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}

// newUniversalRequestContext creates a gin context for UniversalHandler with specified method, path, body, and claims.
func newUniversalRequestContext(method, path string, body interface{}, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")

	// Parse query params from path
	if parts := strings.SplitN(path, "?", 2); len(parts) == 2 {
		req.URL.RawQuery = parts[1]
	}

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}
