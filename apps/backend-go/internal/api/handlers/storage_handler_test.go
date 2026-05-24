package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	storageHandlers "github.com/gomo6/backend/internal/storage/handlers"
)

// setupStorageHandler creates a StorageHandler with nil client.
// Only validation/error paths can be tested (all return before calling S3).
func setupStorageHandler(t *testing.T) *storageHandlers.StorageHandler {
	t.Helper()
	gin.SetMode(gin.TestMode)
	return storageHandlers.NewStorageHandler(nil)
}

// newUploadRequest builds a multipart POST request with a file part and optional form fields.
func newUploadRequest(t *testing.T, fieldName, filename, contentType string, data []byte, formFields map[string]string) *http.Request {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		t.Fatalf("CreateFormFile(%s): %v", fieldName, err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write file data: %v", err)
	}
	for k, v := range formFields {
		if err := writer.WriteField(k, v); err != nil {
			t.Fatalf("WriteField(%s): %v", k, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/storage/v1/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

// newStorageContext creates a gin context for a GET/DELETE handler with path params.
func newStorageContext(method, url string, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, url, nil)
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}
	return c, w
}

// ------- UploadFile -------

func TestUploadFile_NoFile(t *testing.T) {
	h := setupStorageHandler(t)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("bucket", "uploads")
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/storage/v1/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUploadFile_InvalidBucket(t *testing.T) {
	h := setupStorageHandler(t)
	req := newUploadRequest(t, "file", "test.png", "image/png", []byte("fake-image-data"), map[string]string{"bucket": "nonexistent"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp["success"] != false {
		t.Error("expected success=false")
	}
}

func TestUploadFile_WrongFileType(t *testing.T) {
	h := setupStorageHandler(t)
	req := newUploadRequest(t, "file", "test.exe", "application/x-msdownload", []byte("PE file"), map[string]string{"bucket": "uploads"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUploadFile_FileTooLarge(t *testing.T) {
	h := setupStorageHandler(t)
	largeData := make([]byte, 11*1024*1024) // 11MB > 10MB max
	req := newUploadRequest(t, "file", "test.png", "image/png", largeData, map[string]string{"bucket": "uploads"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ------- UploadFileWithKey -------

func TestUploadFileWithKey_MissingBucket(t *testing.T) {
	h := setupStorageHandler(t)
	req := newUploadRequest(t, "file", "test.png", "image/png", []byte("data"), map[string]string{"key": "custom-key"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFileWithKey(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUploadFileWithKey_MissingKey(t *testing.T) {
	h := setupStorageHandler(t)
	req := newUploadRequest(t, "file", "test.png", "image/png", []byte("data"), map[string]string{"bucket": "uploads"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFileWithKey(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUploadFileWithKey_InvalidBucket(t *testing.T) {
	h := setupStorageHandler(t)
	req := newUploadRequest(t, "file", "test.png", "image/png", []byte("data"), map[string]string{"bucket": "invalid", "key": "my-key"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFileWithKey(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUploadFileWithKey_InvalidKey(t *testing.T) {
	h := setupStorageHandler(t)
	req := newUploadRequest(t, "file", "test.png", "image/png", []byte("data"), map[string]string{"bucket": "uploads", "key": "../etc/passwd"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFileWithKey(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUploadFileWithKey_NoFile(t *testing.T) {
	h := setupStorageHandler(t)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("bucket", "uploads")
	writer.WriteField("key", "my-key")
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/storage/v1/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadFileWithKey(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ------- DownloadFile -------

func TestDownloadFile_MissingBucket(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/object//key",
		map[string]string{"key": "test.png"})

	h.DownloadFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestDownloadFile_MissingKey(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/object/uploads/",
		map[string]string{"bucket": "uploads"})

	h.DownloadFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ------- DeleteFile -------

func TestDeleteFile_MissingBucket(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodDelete, "/storage/v1/object//key",
		map[string]string{"key": "test.png"})

	h.DeleteFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFile_MissingKey(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodDelete, "/storage/v1/object/uploads/",
		map[string]string{"bucket": "uploads"})

	h.DeleteFile(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ------- GetPresignedURL -------

func TestGetPresignedURL_MissingBucket(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/presign//key",
		map[string]string{"key": "test.png"})

	h.GetPresignedURL(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestGetPresignedURL_MissingKey(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/presign/uploads/",
		map[string]string{"bucket": "uploads"})

	h.GetPresignedURL(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ------- ServeObject -------

func TestServeObject_MissingBucket(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/object//key",
		map[string]string{"key": "test.png"})

	h.ServeObject(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestServeObject_MissingKey(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/object/uploads/",
		map[string]string{"bucket": "uploads"})

	h.ServeObject(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestServeObject_InvalidBucket(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/object/invalid/test.png",
		map[string]string{"bucket": "invalid", "key": "test.png"})

	h.ServeObject(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestServeObject_InvalidKey(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/object/uploads/..%2Fetc%2Fpasswd",
		map[string]string{"bucket": "uploads", "key": "../etc/passwd"})

	h.ServeObject(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ------- UploadAvatar -------

func TestUploadAvatar_NoFile(t *testing.T) {
	h := setupStorageHandler(t)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/storage/v1/avatar", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadAvatar(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUploadAvatar_WrongFileType(t *testing.T) {
	h := setupStorageHandler(t)
	req := newUploadRequest(t, "avatar", "test.pdf", "application/pdf", []byte("pdf data"), nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadAvatar(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "avatar") {
		t.Errorf("response should mention avatar: %s", w.Body.String())
	}
}

func TestUploadAvatar_FileTooLarge(t *testing.T) {
	h := setupStorageHandler(t)
	largeData := make([]byte, 6*1024*1024) // 6MB > 5MB max for avatars
	req := newUploadRequest(t, "avatar", "avatar.png", "image/png", largeData, nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.UploadAvatar(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ------- GetAvatar -------

func TestGetAvatar_MissingKey(t *testing.T) {
	h := setupStorageHandler(t)
	c, w := newStorageContext(http.MethodGet, "/storage/v1/avatar/",
		map[string]string{})

	h.GetAvatar(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}
