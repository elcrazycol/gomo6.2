package storage

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/aws/smithy-go"
)

// =============================================================================
// corsOrigins
// =============================================================================

func TestCorsOrigins_Default(t *testing.T) {
	// No env var set → should return ["*"]
	origins := corsOrigins()
	if len(origins) != 1 || origins[0] != "*" {
		t.Errorf("expected [\"*\"], got %v", origins)
	}
}

func TestCorsOrigins_CustomEnv(t *testing.T) {
	os.Setenv("GARAGE_S3_CORS_ORIGINS", "http://localhost,http://127.0.0.1")
	defer os.Unsetenv("GARAGE_S3_CORS_ORIGINS")

	origins := corsOrigins()
	if len(origins) != 2 {
		t.Fatalf("expected 2 origins, got %d: %v", len(origins), origins)
	}
	if origins[0] != "http://localhost" || origins[1] != "http://127.0.0.1" {
		t.Errorf("unexpected origins: %v", origins)
	}
}

func TestCorsOrigins_EmptyEnv(t *testing.T) {
	os.Setenv("GARAGE_S3_CORS_ORIGINS", "")
	defer os.Unsetenv("GARAGE_S3_CORS_ORIGINS")

	origins := corsOrigins()
	if len(origins) != 1 || origins[0] != "*" {
		t.Errorf("expected [\"*\"] for empty env, got %v", origins)
	}
}

func TestCorsOrigins_WhitespaceOnlyEnv(t *testing.T) {
	os.Setenv("GARAGE_S3_CORS_ORIGINS", "  ,  ,  ")
	defer os.Unsetenv("GARAGE_S3_CORS_ORIGINS")

	origins := corsOrigins()
	if len(origins) != 1 || origins[0] != "*" {
		t.Errorf("expected [\"*\"] for whitespace-only env, got %v", origins)
	}
}

func TestCorsOrigins_SingleOrigin(t *testing.T) {
	os.Setenv("GARAGE_S3_CORS_ORIGINS", "https://example.com")
	defer os.Unsetenv("GARAGE_S3_CORS_ORIGINS")

	origins := corsOrigins()
	if len(origins) != 1 || origins[0] != "https://example.com" {
		t.Errorf("expected [\"https://example.com\"], got %v", origins)
	}
}

func TestCorsOrigins_WhitespaceAroundOrigins(t *testing.T) {
	os.Setenv("GARAGE_S3_CORS_ORIGINS", " http://a.com , https://b.com , ")
	defer os.Unsetenv("GARAGE_S3_CORS_ORIGINS")

	origins := corsOrigins()
	if len(origins) != 2 {
		t.Fatalf("expected 2 origins, got %d: %v", len(origins), origins)
	}
	if origins[0] != "http://a.com" || origins[1] != "https://b.com" {
		t.Errorf("unexpected origins after trimming: %v", origins)
	}
}

// =============================================================================
// normalizeEndpoint
// =============================================================================

func TestNormalizeEndpoint_Valid(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple", "http://localhost:3900", "http://localhost:3900"},
		{"trailing slash", "http://localhost:3900/", "http://localhost:3900"},
		{"https", "https://s3.example.com", "https://s3.example.com"},
		{"with path", "http://garage:3900/s3", "http://garage:3900/s3"},
		{"trailing slash with path", "http://garage:3900/s3/", "http://garage:3900/s3"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeEndpoint(tt.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.expected {
				t.Errorf("got %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestNormalizeEndpoint_MissingScheme(t *testing.T) {
	_, err := normalizeEndpoint("localhost:3900")
	if err == nil {
		t.Fatal("expected error for missing scheme, got nil")
	}
	if !strings.Contains(err.Error(), "http or https scheme") {
		t.Errorf("error should mention http or https scheme: %v", err)
	}
}

func TestNormalizeEndpoint_Invalid(t *testing.T) {
	_, err := normalizeEndpoint("://bad")
	if err == nil {
		t.Fatal("expected error for invalid URL, got nil")
	}
}

func TestNormalizeEndpoint_MissingHost(t *testing.T) {
	// url.Parse parses "http://" as having scheme=http but no host.
	_, err := normalizeEndpoint("http://")
	if err == nil {
		t.Fatal("expected error for missing host, got nil")
	}
	if !strings.Contains(err.Error(), "host") {
		t.Errorf("error should mention host: %v", err)
	}
}

func TestNormalizeEndpoint_TrimmedWhitespace(t *testing.T) {
	got, err := normalizeEndpoint("  http://localhost:3900  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "http://localhost:3900" {
		t.Errorf("got %q, want %q", got, "http://localhost:3900")
	}
}

// =============================================================================
// browserReachableS3URL
// =============================================================================

func TestBrowserReachableS3URL_Garage(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "garage hostname",
			input:    "http://garage:3900",
			expected: "http://localhost:3900",
		},
		{
			name:     "garage-proxy hostname",
			input:    "http://garage-proxy:3900",
			expected: "http://localhost:3900",
		},
		{
			name:     "garage-proxy on port 80",
			input:    "http://garage-proxy",
			expected: "http://localhost:3900",
		},
		{
			name:     "garage on port 80",
			input:    "http://garage",
			expected: "http://localhost:3900",
		},
		{
			name:     "custom port on garage",
			input:    "http://garage:3901",
			expected: "http://localhost:3901",
		},
		{
			name:     "other hostname unchanged",
			input:    "http://s3.amazonaws.com",
			expected: "http://s3.amazonaws.com",
		},
		{
			name:     "localhost unchanged",
			input:    "http://localhost:3900",
			expected: "http://localhost:3900",
		},
		{
			name:     "public endpoint unchanged",
			input:    "https://cdn.example.com",
			expected: "https://cdn.example.com",
		},
		{
			name:     "trailing slash cleaned",
			input:    "http://garage:3900/",
			expected: "http://localhost:3900",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := browserReachableS3URL(tt.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.expected {
				t.Errorf("browserReachableS3URL(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestBrowserReachableS3URL_CaseInsensitive(t *testing.T) {
	// Garage → lowercase comparison; "GARAGE" should be treated as Docker hostname
	got, err := browserReachableS3URL("http://GARAGE:3900")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "http://localhost:3900" {
		t.Errorf("expected case-insensitive match, got %q", got)
	}

	got, err = browserReachableS3URL("http://Garage-Proxy:3900")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "http://localhost:3900" {
		t.Errorf("expected case-insensitive match for garage-proxy, got %q", got)
	}
}

// =============================================================================
// IsAllowedBucket
// =============================================================================

func TestIsAllowedBucket_Defaults(t *testing.T) {
	allowed := []string{"content", "post-images", "avatars", "uploads"}
	for _, b := range allowed {
		t.Run(b, func(t *testing.T) {
			if !IsAllowedBucket(b) {
				t.Errorf("expected %q to be allowed by default", b)
			}
		})
	}
}

func TestIsAllowedBucket_NotAllowed(t *testing.T) {
	notAllowed := []string{"", "unknown", "random-bucket", "attachments"}
	for _, b := range notAllowed {
		t.Run(fmt.Sprintf("not_allowed_%q", b), func(t *testing.T) {
			if IsAllowedBucket(b) {
				t.Errorf("expected %q to NOT be allowed", b)
			}
		})
	}
}

func TestIsAllowedBucket_CustomEnv(t *testing.T) {
	t.Skip("sync.Once already fired from previous tests — env isolation requires subprocess")
}

// =============================================================================
// ValidateObjectKey
// =============================================================================

func TestValidateObjectKey_Valid(t *testing.T) {
	valid := []string{
		"a",
		"abc.jpg",
		"path/to/file.png",
		"avatars/user-123/photo_2024.jpg",
		"1779454531112_wl7rbfjs6d.jpg",
		"5b6e91c0-9f33-46b9-86ad-e1a62a448304/avatar_1779454123006.jpg",
	}
	for _, k := range valid {
		t.Run(k, func(t *testing.T) {
			if err := ValidateObjectKey(k); err != nil {
				t.Errorf("expected valid key %q, got error: %v", k, err)
			}
		})
	}
}

func TestValidateObjectKey_Invalid(t *testing.T) {
	tests := []struct {
		name      string
		key       string
		errSubstr string
	}{
		{"empty", "", "invalid key"},
		{"too long", strings.Repeat("x", 2049), "invalid key"},
		{"path traversal", "foo/../bar.jpg", "invalid key"},
		{"absolute path", "/etc/passwd", "invalid key"},
		{"starts with slash", "/foo/bar", "invalid key"},
		{"double dots anywhere", "a..b", "invalid key"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateObjectKey(tt.key)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.errSubstr) {
				t.Errorf("expected error containing %q, got: %v", tt.errSubstr, err)
			}
		})
	}
}

func TestValidateObjectKey_Boundary(t *testing.T) {
	// Exactly 2048 — should pass
	k := strings.Repeat("x", 2048)
	if err := ValidateObjectKey(k); err != nil {
		t.Errorf("expected 2048-char key to be valid, got: %v", err)
	}
}

// =============================================================================
// IsNotFound
// =============================================================================

func TestIsNotFound_NilError(t *testing.T) {
	if IsNotFound(nil) {
		t.Error("expected false for nil error")
	}
}

func TestIsNotFound_NoSuchKey_String(t *testing.T) {
	err := errors.New("S3 error: NoSuchKey: object does not exist")
	if !IsNotFound(err) {
		t.Errorf("expected true for error containing NoSuchKey, got false: %v", err)
	}
}

func TestIsNotFound_NotFound_String(t *testing.T) {
	err := errors.New("Not Found")
	if !IsNotFound(err) {
		t.Errorf("expected true for error containing 'Not Found', got false: %v", err)
	}
}

func TestIsNotFound_OtherError(t *testing.T) {
	err := errors.New("AccessDenied: you don't have permissions")
	if IsNotFound(err) {
		t.Errorf("expected false for AccessDenied error, got true: %v", err)
	}
}

func TestIsNotFound_ConnectionError(t *testing.T) {
	err := errors.New("connection refused")
	if IsNotFound(err) {
		t.Errorf("expected false for connection error, got true: %v", err)
	}
}

// smithyAPIError is a minimal implementation of smithy.APIError for testing.
type smithyAPIError struct {
	code    string
	message string
}

func (e *smithyAPIError) Error() string { return e.code + ": " + e.message }
func (e *smithyAPIError) ErrorCode() string { return e.code }
func (e *smithyAPIError) ErrorMessage() string { return e.message }
func (e *smithyAPIError) ErrorFault() smithy.ErrorFault { return smithy.FaultServer }

func TestIsNotFound_SmithyNoSuchKey(t *testing.T) {
	err := &smithyAPIError{code: "NoSuchKey", message: "The specified key does not exist."}
	if !IsNotFound(err) {
		t.Errorf("expected true for smithy NoSuchKey error, got false")
	}
}

func TestIsNotFound_SmithyNotFound(t *testing.T) {
	err := &smithyAPIError{code: "NotFound", message: "Resource not found."}
	if !IsNotFound(err) {
		t.Errorf("expected true for smithy NotFound error, got false")
	}
}

func TestIsNotFound_SmithyOther(t *testing.T) {
	err := &smithyAPIError{code: "AccessDenied", message: "Access denied."}
	if IsNotFound(err) {
		t.Errorf("expected false for smithy AccessDenied error, got true")
	}
}

func TestIsNotFound_WrappedError(t *testing.T) {
	inner := &smithyAPIError{code: "NoSuchKey", message: "not found"}
	err := fmt.Errorf("upload failed: %w", inner)
	if !IsNotFound(err) {
		t.Errorf("expected true for wrapped NoSuchKey error, got false")
	}
}

// =============================================================================
// TODO: ensureBucketCORS и GetPresignedPutURL требуют integration-тестов
// с реальным Garage. Mocking *s3.Client без интерфейса невозможен —
// s3.Client — concrete type из AWS SDK v2.
// =============================================================================

func TestLoadAllowedBuckets_Defaults(t *testing.T) {
	// allowedBucketsOnce has already fired in a full test run.
	// This test verifies the current state matches expected defaults.
	m := loadAllowedBuckets()
	expected := []string{"content", "post-images", "avatars", "uploads"}
	for _, b := range expected {
		if _, ok := m[b]; !ok {
			t.Errorf("expected bucket %q in allowed set, got %v", b, keysOf(m))
		}
	}
	if len(m) != len(expected) {
		t.Errorf("expected %d buckets, got %d: %v", len(expected), len(m), keysOf(m))
	}
}

func keysOf(m map[string]struct{}) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}
