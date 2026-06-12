package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── Setup ───────────────────────────────────────────────────────────────────

func setupMessengerHandler(t *testing.T) (*MessengerHandler, sqlmock.Sqlmock) {
	t.Helper()

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

	handler := NewMessengerHandler(db, nil)
	return handler, mock
}

// stripJSON removes the `data` wrapper from APIResponse and returns the inner data.
func stripJSON(body []byte) (map[string]interface{}, error) {
	var resp models.APIResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	if resp.Data == nil {
		return nil, nil
	}
	return resp.Data.(map[string]interface{}), nil
}

// stripJSONArray returns the data field as []interface{}.
func stripJSONArray(body []byte) ([]interface{}, error) {
	var resp models.APIResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	if resp.Data == nil {
		return nil, nil
	}
	return resp.Data.([]interface{}), nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func TestGetClaims_Valid(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("claims", &auth.Claims{UserID: "u1", Username: "test"})

	claims := getClaims(c)
	if claims == nil {
		t.Fatal("expected non-nil claims")
	}
	if claims.UserID != "u1" {
		t.Fatalf("expected u1, got %s", claims.UserID)
	}
}

func TestGetClaims_Nil(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	claims := getClaims(c)
	if claims != nil {
		t.Fatal("expected nil claims")
	}
}

func TestEnsureAuth_Valid(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("claims", &auth.Claims{UserID: "u1"})

	claims := ensureAuth(c)
	if claims == nil {
		t.Fatal("expected non-nil claims")
	}
}

func TestEnsureAuth_Missing(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	claims := ensureAuth(c)
	if claims != nil {
		t.Fatal("expected nil claims for unauthenticated request")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 written to response, got %d", w.Code)
	}
}

func TestSanitizeContent(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expectOk    bool
		expectedMsg string
	}{
		{"normal", "Hello world", true, "Hello world"},
		{"trim spaces", "  hello  ", true, "hello"},
		{"short", "ok", true, "ok"},
		{"empty", "   ", false, ""},
		{"html tag", "<b>bold</b>", false, ""},
		{"html script", "<script>alert('xss')</script>", false, ""},
		{"html img", "hello<img src=x>", false, ""},
		{"html entity ok", "hello &amp; world", true, "hello &amp; world"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := sanitizeContent(tt.input)
			if tt.expectOk {
				if err != nil {
					t.Errorf("expected ok, got error: %v", err)
				}
				if result != tt.expectedMsg {
					t.Errorf("expected %q, got %q", tt.expectedMsg, result)
				}
			} else {
				if err == nil {
					t.Errorf("expected error for %q, got nil", tt.input)
				}
			}
		})
	}
}

func TestHasHTML(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"plain text", false},
		{"<b>bold</b>", true},
		{"text with <br> tag", true},
		{"just text", false},
		{"<img src=x>", true},
		{"hello &amp; goodbye", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := hasHTML(tt.input); got != tt.expected {
				t.Errorf("hasHTML(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestGenerateClientID(t *testing.T) {
	id1 := GenerateClientID()
	id2 := GenerateClientID()

	if id1 == "" {
		t.Error("expected non-empty client ID")
	}
	if id1[:1] != "c" {
		t.Errorf("expected client ID to start with 'c', got %q", id1)
	}
	if id2[:1] != "c" {
		t.Errorf("expected client ID to start with 'c', got %q", id2)
	}
}

func TestEncryptDecrypt(t *testing.T) {
	// Save original key and restore
	origKey := messengerEncryptionKey
	defer func() { messengerEncryptionKey = origKey }()

	// Set a test key (must be exactly 32 bytes for AES-256)
	messengerEncryptionKey = []byte("test-key-exactly-32-bytes-here!!")

	plaintext := "Hello, secure world!"
	encrypted, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent failed: %v", err)
	}
	if encrypted == plaintext {
		t.Fatal("encrypted content should differ from plaintext")
	}

	decrypted, err := decryptContent(encrypted)
	if err != nil {
		t.Fatalf("decryptContent failed: %v", err)
	}
	if decrypted != plaintext {
		t.Fatalf("decrypt mismatch: got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptDecrypt_NoKey(t *testing.T) {
	origKey := messengerEncryptionKey
	defer func() { messengerEncryptionKey = origKey }()

	messengerEncryptionKey = nil

	plaintext := "unencrypted"
	encrypted, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent without key failed: %v", err)
	}
	if encrypted != plaintext {
		t.Fatal("without key, content should not be encrypted")
	}

	decrypted, err := decryptContent(plaintext)
	if err != nil {
		t.Fatalf("decryptContent without key failed: %v", err)
	}
	if decrypted != plaintext {
		t.Fatal("without key, decryption should return plaintext")
	}
}
