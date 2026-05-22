package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
