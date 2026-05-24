package middleware

import (
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// =============================================================================
// helpers
// =============================================================================

// newUploadRequest creates a test multipart POST request with a file and optional handler.
func newUploadRequest(t *testing.T, filename string, content []byte, extraFields ...string) *http.Request {
	t.Helper()
	var b strings.Builder
	w := multipart.NewWriter(&b)

	// Write extra form fields (key1, value1, key2, value2, ...)
	for i := 0; i < len(extraFields); i += 2 {
		if i+1 < len(extraFields) {
			w.WriteField(extraFields[i], extraFields[i+1])
		}
	}

	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("Failed to create form file: %v", err)
	}
	part.Write(content)
	w.Close()

	req := httptest.NewRequest("POST", "/upload", strings.NewReader(b.String()))
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

// newRequestWithoutFile creates a test multipart POST request without a file field.
func newRequestWithoutFile(t *testing.T) *http.Request {
	t.Helper()
	var b strings.Builder
	w := multipart.NewWriter(&b)

	// Add some fields but no file
	w.WriteField("bucket", "test")
	w.Close()

	req := httptest.NewRequest("POST", "/upload", strings.NewReader(b.String()))
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

func newGinContext(req *http.Request) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	return c, w
}

func getErrorFromResponse(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}
	errStr, _ := resp["error"].(string)
	return errStr
}

// =============================================================================
// ValidateFileMiddleware — No file
// =============================================================================

func TestValidateFileMiddleware_NoFile(t *testing.T) {
	middleware := ValidateFileMiddleware(10*1024*1024, []string{".jpg", ".png"})

	c, w := newGinContext(newRequestWithoutFile(t))

	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d", w.Code)
	}
	errMsg := getErrorFromResponse(t, w)
	if !strings.Contains(strings.ToLower(errMsg), "no file") {
		t.Errorf("Expected 'no file' error, got '%s'", errMsg)
	}
	if c.IsAborted() {
		t.Log("Context was aborted as expected")
	}
}

// =============================================================================
// ValidateFileMiddleware — File size limit
// =============================================================================

func TestValidateFileMiddleware_TooLarge(t *testing.T) {
	// max 10 bytes
	middleware := ValidateFileMiddleware(10, []string{".txt"})

	content := []byte(strings.Repeat("a", 11))
	c, w := newGinContext(newUploadRequest(t, "test.txt", content))

	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for oversized file, got %d", w.Code)
	}
	errMsg := getErrorFromResponse(t, w)
	if !strings.Contains(strings.ToLower(errMsg), "too large") {
		t.Errorf("Expected 'too large' error, got '%s'", errMsg)
	}
}

func TestValidateFileMiddleware_ExactLimit(t *testing.T) {
	// max 10 bytes, content = 10 bytes
	middleware := ValidateFileMiddleware(10, []string{".txt"})

	content := []byte(strings.Repeat("b", 10))
	c, w := newGinContext(newUploadRequest(t, "test.txt", content))

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for exact-limit file, got %d", w.Code)
	}
	if c.IsAborted() {
		t.Error("Context should not be aborted for valid file size")
	}
}

// =============================================================================
// ValidateFileMiddleware — File type
// =============================================================================

func TestValidateFileMiddleware_DisallowedType(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{".jpg", ".png"})

	content := []byte("some content")
	c, w := newGinContext(newUploadRequest(t, "document.pdf", content))

	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for disallowed type, got %d", w.Code)
	}
	errMsg := getErrorFromResponse(t, w)
	if !strings.Contains(strings.ToLower(errMsg), "not allowed") {
		t.Errorf("Expected 'not allowed' error, got '%s'", errMsg)
	}
}

func TestValidateFileMiddleware_AllowedType(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{".jpg", ".png"})

	content := []byte("fake image data")
	c, w := newGinContext(newUploadRequest(t, "photo.jpg", content))

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for allowed type, got %d", w.Code)
	}
	if c.IsAborted() {
		t.Error("Context should not be aborted for valid file type")
	}
}

func TestValidateFileMiddleware_UpperCaseExtension(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{".jpg", ".png"})

	content := []byte("image data")
	c, w := newGinContext(newUploadRequest(t, "photo.JPG", content))

	middleware(c)

	// Middleware normalizes extension with strings.ToLower — .JPG matches .jpg
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for uppercase .JPG (normalized to .jpg), got %d", w.Code)
	}
	if c.IsAborted() {
		t.Error("Context should not be aborted — uppercase extension is handled case-insensitively")
	}
}

// =============================================================================
// ValidateFileMiddleware — Multiple types
// =============================================================================

func TestValidateFileMiddleware_MultipleAllowedTypes(t *testing.T) {
	types := []string{".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".txt"}

	tests := []struct {
		filename string
		allowed  bool
	}{
		{"pic.jpg", true},
		{"pic.jpeg", true},
		{"pic.png", true},
		{"pic.gif", true},
		{"pic.webp", true},
		{"doc.pdf", true},
		{"readme.txt", true},
		{"script.exe", false},
		{"data.zip", false},
		{"evil.php", false},
		{"page.html", false},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			middleware := ValidateFileMiddleware(1024, types)
			content := []byte("test content")
			c, w := newGinContext(newUploadRequest(t, tt.filename, content))

			middleware(c)

			if tt.allowed && w.Code != http.StatusOK {
				t.Errorf("Expected 200 for '%s', got %d", tt.filename, w.Code)
			}
			if !tt.allowed && w.Code != http.StatusBadRequest {
				t.Errorf("Expected 400 for '%s', got %d", tt.filename, w.Code)
			}
		})
	}
}

func TestValidateFileMiddleware_NoExtension(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{".txt"})

	content := []byte("content")
	c, w := newGinContext(newUploadRequest(t, "README", content))

	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for no-extension file, got %d", w.Code)
	}
	errMsg := getErrorFromResponse(t, w)
	if !strings.Contains(strings.ToLower(errMsg), "not allowed") {
		t.Errorf("Expected 'not allowed' error, got '%s'", errMsg)
	}
}

// =============================================================================
// ValidateFileMiddleware — Empty allowed types
// =============================================================================

func TestValidateFileMiddleware_EmptyAllowedTypes(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{})

	content := []byte("content")
	c, w := newGinContext(newUploadRequest(t, "test.txt", content))

	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 when no types are allowed, got %d", w.Code)
	}
}

// =============================================================================
// ValidateImageMiddleware tests
// =============================================================================

func TestValidateImageMiddleware(t *testing.T) {
	middleware := ValidateImageMiddleware()

	tests := []struct {
		filename string
		allowed  bool
	}{
		{"photo.jpg", true},
		{"photo.jpeg", true},
		{"photo.png", true},
		{"photo.gif", true},
		{"photo.webp", true},
		{"doc.pdf", false},
		{"file.txt", false},
		{"script.exe", false},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			content := []byte("image content")
			c, w := newGinContext(newUploadRequest(t, tt.filename, content))

			middleware(c)

			if tt.allowed && w.Code != http.StatusOK {
				t.Errorf("Expected 200 for '%s', got %d", tt.filename, w.Code)
			}
			if !tt.allowed && w.Code != http.StatusBadRequest {
				t.Errorf("Expected 400 for '%s', got %d", tt.filename, w.Code)
			}
		})
	}
}

// =============================================================================
// ValidateImageMiddleware — Size limit
// =============================================================================

func TestValidateImageMiddleware_LargeFile(t *testing.T) {
	middleware := ValidateImageMiddleware() // 10MB max

	// 11MB
	content := make([]byte, 11*1024*1024)
	c, w := newGinContext(newUploadRequest(t, "huge.jpg", content))

	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for >10MB image, got %d", w.Code)
	}
}

// =============================================================================
// ValidateAvatarMiddleware tests
// =============================================================================

func TestValidateAvatarMiddleware(t *testing.T) {
	middleware := ValidateAvatarMiddleware()

	tests := []struct {
		filename string
		allowed  bool
	}{
		{"avatar.jpg", true},
		{"avatar.png", true},
		{"avatar.gif", true},
		{"avatar.webp", true},
		{"avatar.pdf", false},
		{"avatar.txt", false},
		{"avatar.exe", false},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			content := []byte("avatar content")
			c, w := newGinContext(newUploadRequest(t, tt.filename, content))

			middleware(c)

			if tt.allowed && w.Code != http.StatusOK {
				t.Errorf("Expected 200 for '%s', got %d", tt.filename, w.Code)
			}
			if !tt.allowed && w.Code != http.StatusBadRequest {
				t.Errorf("Expected 400 for '%s', got %d", tt.filename, w.Code)
			}
		})
	}
}

func TestValidateAvatarMiddleware_LargeFile(t *testing.T) {
	middleware := ValidateAvatarMiddleware() // 5MB max

	// 6MB
	content := make([]byte, 6*1024*1024)
	c, w := newGinContext(newUploadRequest(t, "avatar.jpg", content))

	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for >5MB avatar, got %d", w.Code)
	}
}

func TestValidateAvatarMiddleware_ExactLimit(t *testing.T) {
	middleware := ValidateAvatarMiddleware() // 5MB max

	content := make([]byte, 5*1024*1024)
	c, w := newGinContext(newUploadRequest(t, "avatar.jpg", content))

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for exact 5MB avatar, got %d", w.Code)
	}
}

// =============================================================================
// ValidateFileMiddleware — Pass through (c.Next on success)
// =============================================================================

func TestValidateFileMiddleware_PassesThrough(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{".txt"})

	content := []byte("hello world")
	c, w := newGinContext(newUploadRequest(t, "hello.txt", content))

	middleware(c)

	if c.IsAborted() {
		t.Error("Context should not be aborted for valid file — middleware calls c.Next() which passes through")
	}
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

// =============================================================================
// ValidateFileMiddleware — Edge cases
// =============================================================================

func TestValidateFileMiddleware_EmptyFile(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{".txt"})

	content := []byte{} // empty file
	c, w := newGinContext(newUploadRequest(t, "empty.txt", content))

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for empty file, got %d", w.Code)
	}
}

func TestValidateFileMiddleware_DoubleExtension(t *testing.T) {
	middleware := ValidateFileMiddleware(1024, []string{".jpg"})

	content := []byte("content")
	c, w := newGinContext(newUploadRequest(t, "file.txt.jpg", content))

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for double extension .txt.jpg (matched .jpg), got %d", w.Code)
	}
}
