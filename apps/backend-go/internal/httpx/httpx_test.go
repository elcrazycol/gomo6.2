package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/lib/pq"
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

// TestServerError_ClientInputReturns400 pins that malformed values supplied by
// the client (PostgreSQL data exception, class 22) answer 400 without leaking
// the driver text — they are request errors, not server faults.
func TestServerError_ClientInputReturns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	ServerError(c, "database error", &pq.Error{Code: "22P02", Message: `invalid input syntax for type uuid: "abc"`})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal body: %v", err)
	}
	if resp.Error == nil || *resp.Error != "Invalid request value" {
		t.Fatalf("expected generic invalid-value message, got %v", resp.Error)
	}
	if strings.Contains(w.Body.String(), "uuid") {
		t.Fatalf("raw driver error leaked to client: %s", w.Body.String())
	}
}

func TestIsClientInputError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"invalid uuid text", &pq.Error{Code: "22P02"}, true},
		{"invalid datetime", &pq.Error{Code: "22007"}, true},
		{"wrapped data exception", fmt.Errorf("query: %w", &pq.Error{Code: "22P02"}), true},
		{"unique violation is not input", &pq.Error{Code: "23505"}, false},
		{"plain error", errors.New("boom"), false},
		{"nil", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsClientInputError(tc.err); got != tc.want {
				t.Fatalf("IsClientInputError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
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

func TestUniqueViolationConstraint(t *testing.T) {
	t.Run("real unique violation returns the constraint", func(t *testing.T) {
		err := &pq.Error{Code: "23505", Constraint: "users_username_key"}
		if got := UniqueViolationConstraint(err); got != "users_username_key" {
			t.Fatalf("got %q, want users_username_key", got)
		}
	})

	t.Run("wrapped unique violation is detected", func(t *testing.T) {
		err := fmt.Errorf("insert user: %w", &pq.Error{Code: "23505", Constraint: "users_wallet_address_key"})
		if got := UniqueViolationConstraint(err); got != "users_wallet_address_key" {
			t.Fatalf("got %q, want users_wallet_address_key", got)
		}
	})

	t.Run("other pq errors are ignored", func(t *testing.T) {
		if got := UniqueViolationConstraint(&pq.Error{Code: "23502", Constraint: "users_email_not_null"}); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})

	t.Run("non-pq errors are ignored", func(t *testing.T) {
		if got := UniqueViolationConstraint(errors.New("duplicate key value violates unique constraint")); got != "" {
			t.Fatalf("got %q, want empty (no string sniffing)", got)
		}
		if got := UniqueViolationConstraint(nil); got != "" {
			t.Fatalf("nil: got %q, want empty", got)
		}
	})
}
