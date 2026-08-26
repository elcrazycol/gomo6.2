package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

func TestServerError_ReturnsGeneric500(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	ServerError(c, "test context", errors.New("secret db detail: password=123"))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
	if !c.IsAborted() {
		t.Fatal("expected context to be aborted")
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal body: %v", err)
	}
	if resp.Error == nil {
		t.Fatal("expected error field, got nil")
	}
	// The raw error must never leak to the client.
	if strings.Contains(*resp.Error, "password=42") {
		t.Fatalf("raw error leaked to client: %q", *resp.Error)
	}
	if *resp.Error != "Internal server error" {
		t.Fatalf("expected generic message, got %q", *resp.Error)
	}

	// The real error is recorded on the context for the error middleware/logging.
	if len(c.Errors) != 1 {
		t.Fatalf("expected 1 recorded error, got %d", len(c.Errors))
	}
}

func TestAuthenticatedUserID_WithClaims(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("claims", &auth.Claims{UserID: "u42", Username: "alice"})

	if got := AuthenticatedUserID(c); got != "u42" {
		t.Fatalf("expected u42, got %q", got)
	}
}

func TestAuthenticatedUserID_NoClaims(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	if got := AuthenticatedUserID(c); got != "" {
		t.Fatalf("expected empty for missing claims, got %q", got)
	}
}

func TestAuthenticatedUserID_WrongType(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("claims", "not-a-claims")

	if got := AuthenticatedUserID(c); got != "" {
		t.Fatalf("expected empty for wrong type, got %q", got)
	}
}

func TestAuthenticatedUserID_NilClaims(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("claims", (*auth.Claims)(nil))

	if got := AuthenticatedUserID(c); got != "" {
		t.Fatalf("expected empty for nil claims, got %q", got)
	}
}

func TestAuthenticatedUserID_EmptyUserID(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("claims", &auth.Claims{UserID: ""})

	if got := AuthenticatedUserID(c); got != "" {
		t.Fatalf("expected empty for empty UserID, got %q", got)
	}
}
