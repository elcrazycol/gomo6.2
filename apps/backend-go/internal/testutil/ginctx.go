// Package testutil holds shared test scaffolding used by leaf packages that
// were extracted from api/handlers (messenger, and future F1 extractions).
// The gin test-context builders here are the same helpers the api/handlers
// package still defines anonymously in handler_test_helpers.go; extracted
// packages must use this package instead of reaching back into handlers.
package testutil

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// NewGETContext creates a gin test context for a GET request.
// Returns (context, *httptest.ResponseRecorder).
func NewGETContext(url string, queryParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
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

// NewGETContextWithParams creates a gin test context for a GET request with
// path params glued onto the context (same shape as NewGETContext but the
// route captures are set for :id-style handlers).
func NewGETContextWithParams(url string, queryParams map[string]string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	c, w := NewGETContext(url, queryParams)
	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}
	return c, w
}

// NewPOSTContext creates a gin test context for a POST request with a JSON
// body and auth claims. Returns (context, *httptest.ResponseRecorder).
func NewPOSTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	req := httptest.NewRequest(http.MethodPost, url, marshalBody(body))
	req.Header.Set("Content-Type", "application/json")

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}
	appendParams(c, pathParams)

	return c, w
}

// NewPUTContext creates a gin test context for a PUT request with a JSON body,
// auth claims and path params. Returns (context, *httptest.ResponseRecorder).
func NewPUTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	req := httptest.NewRequest(http.MethodPut, url, marshalBody(body))
	req.Header.Set("Content-Type", "application/json")

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}
	appendParams(c, pathParams)

	return c, w
}

// NewDELETEPContext creates a gin test context for a DELETE request with
// query params and path params. Returns (context, *httptest.ResponseRecorder).
func NewDELETEPContext(url string, queryParams map[string]string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, url, nil)
	q := req.URL.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()

	c, _ := gin.CreateTestContext(w)
	c.Request = req
	appendParams(c, pathParams)

	return c, w
}

func marshalBody(body interface{}) io.Reader {
	if body == nil {
		return nil
	}
	b, err := json.Marshal(body)
	if err != nil {
		panic(fmt.Sprintf("failed to marshal test body: %v", err))
	}
	return bytes.NewReader(b)
}

func appendParams(c *gin.Context, pathParams map[string]string) {
	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}
}
