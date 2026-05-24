package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// newAudioRequest creates a multipart request with an audio file for testing.
func newAudioRequest(t *testing.T, filename string, data []byte) *http.Request {
	t.Helper()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("audio", filename)
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("failed to write file data: %v", err)
	}
	writer.Close()

	req := httptest.NewRequest("POST", "/api/audio/metadata", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func setupAudioContext(t *testing.T, req *http.Request) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	return c, w
}

// =============================================================================
// ExtractAudioMetadata
// =============================================================================

func TestExtractAudioMetadata_NoFile(t *testing.T) {
	h := &AudioHandler{}
	c, w := setupAudioContext(t, httptest.NewRequest("POST", "/api/audio/metadata", nil))

	h.ExtractAudioMetadata(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing file, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["success"] != false {
		t.Errorf("expected success=false, got %v", resp["success"])
	}
}

func TestExtractAudioMetadata_NonAudioFile_ReturnsBasicInfo(t *testing.T) {
	h := &AudioHandler{}
	// A non-audio file (e.g., plain text) - tag.ReadFrom will fail
	data := []byte("This is not an audio file content at all")
	req := newAudioRequest(t, "test.txt", data)
	c, w := setupAudioContext(t, req)

	h.ExtractAudioMetadata(c)

	// Should return 200 with basic info even if metadata extraction fails
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 with basic info, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// Filename without extension should be used as title
	if resp["title"] != "test" {
		t.Errorf("expected title 'test' (from filename), got %v", resp["title"])
	}
}

func TestExtractAudioMetadata_NonAudioFile_AlternativeNames(t *testing.T) {
	h := &AudioHandler{}

	tests := []struct {
		filename      string
		expectedTitle string
	}{
		{"song.mp3", "song"},
		{"track.flac", "track"},
		{"my.song.wav", "my.song"},
		{"noextension", "noextension"},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			data := []byte("non-audio binary content")
			req := newAudioRequest(t, tt.filename, data)
			c, w := setupAudioContext(t, req)

			h.ExtractAudioMetadata(c)

			if w.Code != http.StatusOK {
				t.Errorf("expected 200, got %d", w.Code)
			}

			var resp map[string]interface{}
			json.Unmarshal(w.Body.Bytes(), &resp)
			if resp["title"] != tt.expectedTitle {
				t.Errorf("expected title %q, got %v", tt.expectedTitle, resp["title"])
			}
		})
	}
}

func TestExtractAudioMetadata_BinaryFile_ReturnsBasicInfo(t *testing.T) {
	h := &AudioHandler{}
	// Binary data that isn't a valid audio format
	data := make([]byte, 512)
	for i := range data {
		data[i] = byte(i)
	}
	req := newAudioRequest(t, "unknown.bin", data)
	c, w := setupAudioContext(t, req)

	h.ExtractAudioMetadata(c)

	// Should return 200 with basic info since tag.ReadFrom will fail
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 with basic info, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["title"] != "unknown" {
		t.Errorf("expected title 'unknown', got %v", resp["title"])
	}
	if resp["artist"] != nil {
		t.Errorf("expected nil artist for unparsable file, got %v", resp["artist"])
	}
	if resp["album"] != nil {
		t.Errorf("expected nil album for unparsable file, got %v", resp["album"])
	}
}

func TestNewAudioHandler(t *testing.T) {
	h := NewAudioHandler()
	if h == nil {
		t.Fatal("NewAudioHandler() returned nil")
	}
}
