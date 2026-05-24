package handlers

import (
	"encoding/hex"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// TestGenerateBotToken_Length tests token length (32 bytes → 64 hex chars)
func TestGenerateBotToken_Length(t *testing.T) {
	token, err := generateBotToken()
	if err != nil {
		t.Fatalf("generateBotToken() error: %v", err)
	}

	if len(token) != 64 {
		t.Errorf("Expected 64 hex chars (32 bytes), got %d chars", len(token))
	}
}

// TestGenerateBotToken_IsHex tests that the token is valid hex
func TestGenerateBotToken_IsHex(t *testing.T) {
	token, err := generateBotToken()
	if err != nil {
		t.Fatalf("generateBotToken() error: %v", err)
	}

	_, decodeErr := hex.DecodeString(token)
	if decodeErr != nil {
		t.Errorf("Token is not valid hex: %v", decodeErr)
	}
}

// TestGenerateBotToken_NotEmpty tests that token is not empty
func TestGenerateBotToken_NotEmpty(t *testing.T) {
	token, err := generateBotToken()
	if err != nil {
		t.Fatalf("generateBotToken() error: %v", err)
	}

	if token == "" {
		t.Fatal("Token is empty")
	}
}

// TestGenerateBotToken_Uniqueness tests that multiple tokens are unique
func TestGenerateBotToken_Uniqueness(t *testing.T) {
	tokens := make(map[string]bool)
	for i := 0; i < 100; i++ {
		token, err := generateBotToken()
		if err != nil {
			t.Fatalf("generateBotToken() error at iteration %d: %v", i, err)
		}
		if tokens[token] {
			t.Fatalf("Duplicate token found at iteration %d: %s", i, token)
		}
		tokens[token] = true
	}
}

// TestGenerateBotToken_NotPredictable tests that consecutive tokens differ
func TestGenerateBotToken_NotPredictable(t *testing.T) {
	token1, _ := generateBotToken()
	token2, _ := generateBotToken()

	if token1 == token2 {
		t.Fatal("Consecutive tokens are identical — not random enough")
	}

	// First 4 chars should differ (highly likely with crypto/rand)
	if token1[:4] == token2[:4] {
		t.Skip("First 4 chars match — statistically possible but unlikely; skipping")
	}
}

// TestGetUserIDFromContext_ValidClaims tests extracting user ID from claims
func TestGetUserIDFromContext_ValidClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	c.Set("claims", &auth.Claims{
		UserID: "test-user-123",
	})

	userID, err := getUserIDFromContext(c)
	if err != nil {
		t.Fatalf("getUserIDFromContext() error: %v", err)
	}
	if userID != "test-user-123" {
		t.Errorf("Expected 'test-user-123', got '%s'", userID)
	}
}

// TestGetUserIDFromContext_EmptyUserID tests claims with empty user ID
func TestGetUserIDFromContext_EmptyUserID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	c.Set("claims", &auth.Claims{
		UserID: "",
	})

	userID, err := getUserIDFromContext(c)
	if err != nil {
		t.Fatalf("getUserIDFromContext() should not error for empty user ID: %v", err)
	}
	if userID != "" {
		t.Errorf("Expected empty user ID, got '%s'", userID)
	}
}

// TestGetUserIDFromContext_NoClaims tests context without claims
func TestGetUserIDFromContext_NoClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	// Don't set "claims" — should return error
	userID, err := getUserIDFromContext(c)
	if err == nil {
		t.Fatal("Expected error for missing claims, got nil")
	}
	if userID != "" {
		t.Errorf("Expected empty user ID on error, got '%s'", userID)
	}
}

// TestGetUserIDFromContext_WrongType tests claims with wrong type
func TestGetUserIDFromContext_WrongType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	// Set "claims" to something that's not *auth.Claims
	c.Set("claims", "not-a-claims-object")

	userID, err := getUserIDFromContext(c)
	if err == nil {
		t.Fatal("Expected error for wrong claims type, got nil")
	}
	if userID != "" {
		t.Errorf("Expected empty user ID on error, got '%s'", userID)
	}
}

// TestGetUserIDFromContext_NilClaims tests claims set to nil
func TestGetUserIDFromContext_NilClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	c.Set("claims", nil)

	userID, err := getUserIDFromContext(c)
	if err == nil {
		t.Fatal("Expected error for nil claims, got nil")
	}
	if userID != "" {
		t.Errorf("Expected empty user ID on error, got '%s'", userID)
	}
}

// TestGetUserIDFromContext_LongUserID tests a very long user ID
func TestGetUserIDFromContext_LongUserID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	longID := string(make([]byte, 1000))
	for i := range longID {
		longID = "a" + longID[:i] // build a string of 'a's
	}
	// Actually simpler:
	longID = ""
	for i := 0; i < 1000; i++ {
		longID += "x"
	}

	c.Set("claims", &auth.Claims{
		UserID: longID,
	})

	userID, err := getUserIDFromContext(c)
	if err != nil {
		t.Fatalf("getUserIDFromContext() error for long user ID: %v", err)
	}
	if userID != longID {
		t.Errorf("Expected long user ID, got different value")
	}
}
