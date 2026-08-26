// Package testutil holds shared test scaffolding used by leaf packages that
// were extracted from api/handlers (messenger, and future F1 extractions).
// The gin test-context builders here are the single implementation of the
// context helpers that api/handlers/handler_test_helpers.go still exposes
// under anonymous names for its own tests — extracted packages must use this
// package instead of reaching back into handlers.
package testutil

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"

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
	appendParams(c, pathParams)
	return c, w
}

// NewGETContextWithClaims creates a gin test context for a GET request with
// auth claims set on the context.
func NewGETContextWithClaims(urlStr string, queryParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
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

// NewDELETEContext creates a gin test context for a DELETE request with query
// params and path params. Returns (context, *httptest.ResponseRecorder).
func NewDELETEContext(url string, queryParams map[string]string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
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

// NewDELETEContextWithClaims creates a gin test context for a DELETE request
// with query params, path params and auth claims on the context.
func NewDELETEContextWithClaims(url string, queryParams map[string]string, pathParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	c, w := NewDELETEContext(url, queryParams, pathParams)
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

// NewRPCGETContext creates a gin test context for RPC methods that use
// c.Query() parameters. RPC handlers are called via POST /rpc/<name> but read
// from query params.
func NewRPCGETContext(queryParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
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

// NewRPCPostContext creates a gin test context for RPC methods that use a JSON
// body.
func NewRPCPostContext(body interface{}, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	req := httptest.NewRequest(http.MethodPost, "/rpc/test", marshalBody(body))
	req.Header.Set("Content-Type", "application/json")

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}
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
