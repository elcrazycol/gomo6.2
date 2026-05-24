package middleware

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupErrorContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test", nil)
	return c, w
}

func TestErrorHandler_NoErrors(t *testing.T) {
	c, w := setupErrorContext()

	ErrorHandler()(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 when no errors, got %d", w.Code)
	}
	if w.Body.String() != "" {
		t.Errorf("expected empty body when no errors, got %q", w.Body.String())
	}
}

func TestErrorHandler_HTTPError(t *testing.T) {
	c, w := setupErrorContext()

	// Simulate a handler that adds an HTTPError
	c.Error(NewHTTPError(http.StatusNotFound, "User not found"))

	ErrorHandler()(c)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for HTTPError, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["error"] != "User not found" {
		t.Errorf("expected 'User not found', got %q", resp["error"])
	}
}

func TestErrorHandler_HTTPError_BadRequest(t *testing.T) {
	c, w := setupErrorContext()

	c.Error(NewHTTPError(http.StatusBadRequest, "Invalid input"))

	ErrorHandler()(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "Invalid input" {
		t.Errorf("expected 'Invalid input', got %q", resp["error"])
	}
}

func TestErrorHandler_HTTPError_Forbidden(t *testing.T) {
	c, w := setupErrorContext()

	c.Error(NewHTTPError(http.StatusForbidden, "Access denied"))

	ErrorHandler()(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "Access denied" {
		t.Errorf("expected 'Access denied', got %q", resp["error"])
	}
}

func TestErrorHandler_GenericError(t *testing.T) {
	c, w := setupErrorContext()

	c.Error(errors.New("something went wrong"))

	ErrorHandler()(c)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 for generic error, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["error"] != "Internal server error" {
		t.Errorf("expected 'Internal server error', got %q", resp["error"])
	}
}

func TestErrorHandler_MultipleErrors_FirstProcessed(t *testing.T) {
	c, w := setupErrorContext()

	c.Error(NewHTTPError(http.StatusBadRequest, "First error"))
	c.Error(NewHTTPError(http.StatusNotFound, "Second error (ignored)"))

	ErrorHandler()(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 (first error), got %d", w.Code)
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "First error" {
		t.Errorf("expected 'First error', got %q", resp["error"])
	}
}

func TestNewHTTPError(t *testing.T) {
	err := NewHTTPError(http.StatusTeapot, "I'm a teapot")

	if err.StatusCode != http.StatusTeapot {
		t.Errorf("expected 418, got %d", err.StatusCode)
	}
	if err.Message != "I'm a teapot" {
		t.Errorf("expected 'I'm a teapot', got %q", err.Message)
	}
	if err.Error() != "I'm a teapot" {
		t.Errorf("Error() should return message, got %q", err.Error())
	}
}
