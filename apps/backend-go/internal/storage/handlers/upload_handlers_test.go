package handlers

import (
	"bytes"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

// testPNG renders a tiny valid PNG used for image-upload flows.
func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 120, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test image: %v", err)
	}
	return buf.Bytes()
}

// newMultipartUploadRequest builds a multipart POST with a single file part
// and optional form fields.
func newMultipartUploadRequest(t *testing.T, fieldName, filename string, data []byte, formFields map[string]string) *http.Request {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
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

// storageContext builds a gin context for a multipart POST with optional claims.
func storageContext(t *testing.T, req *http.Request, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

// uploadResponse mirrors the JSON shape returned by the upload handlers.
type uploadResponse struct {
	Data struct {
		Key      string `json:"key"`
		Variants *struct {
			PreviewKey  string `json:"preview_key"`
			LQIP        string `json:"lqip"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
			ContentType string `json:"content_type"`
		} `json:"variants"`
	} `json:"data"`
}

// ─── UploadFile ──────────────────────────────────────────────────────────────

func TestUploadFile_ContentBucket_ImageWithVariants(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	pngBytes := testPNG(t, 100, 80)
	req := newMultipartUploadRequest(t, "file", "photo.png", pngBytes, map[string]string{"bucket": "content"})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp uploadResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp.Data.Key == "" {
		t.Fatal("expected a key in the response")
	}
	if !strings.HasSuffix(resp.Data.Key, ".png") {
		t.Fatalf("expected png extension in key, got %q", resp.Data.Key)
	}
	if resp.Data.Variants == nil {
		t.Fatal("expected image variants for an image upload")
	}
	if resp.Data.Variants.Width != 100 || resp.Data.Variants.Height != 80 {
		t.Fatalf("unexpected variant dimensions: %dx%d", resp.Data.Variants.Width, resp.Data.Variants.Height)
	}
	if !strings.HasPrefix(resp.Data.Variants.LQIP, "data:image/jpeg;base64,") {
		t.Error("LQIP must be a JPEG data URL")
	}
	// Original + derivative must both be persisted in the bucket.
	if _, ok := f.get("content", resp.Data.Key); !ok {
		t.Error("original object was not stored")
	}
	if _, ok := f.get("content", resp.Data.Variants.PreviewKey); !ok {
		t.Error("preview derivative was not stored")
	}
}

func TestUploadFile_UploadsBucket_RequiresClaims(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	req := newMultipartUploadRequest(t, "file", "photo.png", testPNG(t, 10, 10), map[string]string{"bucket": "uploads"})
	c, w := storageContext(t, req, nil)

	h.UploadFile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without claims, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUploadFile_UploadsBucket_WithClaims_PrefixesMessengerKey(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	req := newMultipartUploadRequest(t, "file", "photo.png", testPNG(t, 12, 12), map[string]string{"bucket": "uploads"})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp uploadResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if !strings.HasPrefix(resp.Data.Key, "user-1/messenger/") {
		t.Fatalf("uploads key must live under <user>/messenger/, got %q", resp.Data.Key)
	}
	// Messenger objects are encrypted at rest — stored bytes must differ.
	stored, ok := f.get("uploads", resp.Data.Key)
	if !ok {
		t.Fatal("encrypted object was not stored")
	}
	if bytes.Equal(stored, testPNG(t, 12, 12)) {
		t.Error("uploaded object must be encrypted at rest")
	}
}

func TestUploadFile_InvalidImageData_Rejected(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	req := newMultipartUploadRequest(t, "file", "broken.jpg", []byte("definitely not an image"), map[string]string{"bucket": "post-images"})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFile(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid image, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "invalid image") {
		t.Errorf("expected 'invalid image' error, got: %s", w.Body.String())
	}
}

func TestUploadFile_DefaultsToUploadsBucket(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	// No bucket field → defaults to "uploads" → needs auth.
	req := newMultipartUploadRequest(t, "file", "photo.png", testPNG(t, 10, 10), nil)
	c, w := storageContext(t, req, nil)

	h.UploadFile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (uploads bucket default) without claims, got %d", w.Code)
	}
}

// ─── UploadFileWithKey ───────────────────────────────────────────────────────

func TestUploadFileWithKey_Success_OwnedImage(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	req := newMultipartUploadRequest(t, "file", "avatar.png", testPNG(t, 64, 64), map[string]string{
		"bucket": "post-images",
		"key":    "user-1/avatar_123.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp uploadResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp.Data.Key != "user-1/avatar_123.png" {
		t.Fatalf("unexpected key: %q", resp.Data.Key)
	}
	if resp.Data.Variants == nil {
		t.Fatal("expected variants for an image key")
	}
	if _, ok := f.get("post-images", "user-1/avatar_123.png"); !ok {
		t.Error("object was not stored")
	}
}

func TestUploadFileWithKey_UploadsBucket_RequiresMessengerNamespace(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	// Key outside <user>/messenger/ must be rejected even for the owner.
	req := newMultipartUploadRequest(t, "file", "photo.png", testPNG(t, 10, 10), map[string]string{
		"bucket": "uploads",
		"key":    "user-1/avatar_123.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-messenger uploads key, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUploadFileWithKey_UploadsBucket_Success(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	req := newMultipartUploadRequest(t, "file", "photo.png", testPNG(t, 16, 16), map[string]string{
		"bucket": "uploads",
		"key":    "user-1/messenger/photo.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if _, ok := f.get("uploads", "user-1/messenger/photo.png"); !ok {
		t.Error("encrypted messenger object was not stored")
	}
}

// ─── gift-layers (admin-managed) ──────────────────────────────────────────────

func TestUploadFileWithKey_GiftLayers_AdminAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, f := setupStorageHandlerWithS3(t, db)

	// Gift keys are not user-namespaced — an admin must be able to write them.
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role = 'admin'`)).
		WithArgs("admin-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	req := newMultipartUploadRequest(t, "file", "base.png", testPNG(t, 64, 64), map[string]string{
		"bucket": "gift-layers",
		"key":    "gifts/e9671c88-8c47-4037-bd9b-4bef453f17b0/base.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "admin-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if _, ok := f.get("gift-layers", "gifts/e9671c88-8c47-4037-bd9b-4bef453f17b0/base.png"); !ok {
		t.Error("gift object was not stored")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestUploadFileWithKey_GiftLayers_NonAdmin_Forbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, _ := setupStorageHandlerWithS3(t, db)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role = 'admin'`)).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	req := newMultipartUploadRequest(t, "file", "base.png", testPNG(t, 64, 64), map[string]string{
		"bucket": "gift-layers",
		"key":    "gifts/whatever/base.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestDeleteFile_GiftLayers_AdminAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, f := setupStorageHandlerWithS3(t, db)
	f.put("gift-layers", "gifts/abc/base.png", []byte("png-bytes"), "image/png")

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role = 'admin'`)).
		WithArgs("admin-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/gift-layers/gifts/abc/base.png",
		map[string]string{"bucket": "gift-layers", "key": "gifts/abc/base.png"}, &auth.Claims{UserID: "admin-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if _, ok := f.get("gift-layers", "gifts/abc/base.png"); ok {
		t.Error("gift object must be deleted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestDeleteFile_GiftLayers_NonAdmin_Forbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, _ := setupStorageHandlerWithS3(t, db)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role = 'admin'`)).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/gift-layers/gifts/abc/base.png",
		map[string]string{"bucket": "gift-layers", "key": "gifts/abc/base.png"}, &auth.Claims{UserID: "user-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

// ─── Emoji validation ────────────────────────────────────────────────────────

func TestUploadFileWithKey_Emoji_TooLarge(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	big := make([]byte, 600*1024) // > 512KB
	req := newMultipartUploadRequest(t, "file", "emoji.png", big, map[string]string{
		"bucket": "emojis",
		"key":    "user-1/emoji.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized emoji, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "too large") {
		t.Errorf("expected size error, got: %s", w.Body.String())
	}
}

func TestUploadFileWithKey_Emoji_InvalidDimensions(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	// A valid PNG header claiming 1000x1000 (well under the 10MB read cap) —
	// must be rejected by the 128px emoji dimension limit, not by CRC/decode.
	req := newMultipartUploadRequest(t, "file", "emoji.png", bigPNGHeader(t, 1000, 1000), map[string]string{
		"bucket": "emojis",
		"key":    "user-1/emoji.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized emoji dimensions, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "128") {
		t.Errorf("expected dimension-limit message, got: %s", w.Body.String())
	}
}

// bigPNGHeader builds a syntactically valid PNG signature + IHDR chunk for the
// given dimensions (no IDAT) so image.DecodeConfig succeeds and dimension
// checks run. The IHDR CRC is computed properly.
func bigPNGHeader(t *testing.T, width, height uint32) []byte {
	t.Helper()
	ihdrData := []byte{
		byte(width >> 24), byte(width >> 16), byte(width >> 8), byte(width),
		byte(height >> 24), byte(height >> 16), byte(height >> 8), byte(height),
		8, 2, 0, 0, 0, // 8-bit, truecolor, no compression/filter/interlace
	}
	chunk := append([]byte("IHDR"), ihdrData...)
	crc := crc32.ChecksumIEEE(chunk)
	header := append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0d"), chunk...)
	header = append(header, byte(crc>>24), byte(crc>>16), byte(crc>>8), byte(crc))
	return header
}

func TestUploadFileWithKey_Emoji_Success(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	req := newMultipartUploadRequest(t, "file", "emoji.png", testPNG(t, 32, 32), map[string]string{
		"bucket": "emojis",
		"key":    "user-1/emoji.png",
	})
	c, w := storageContext(t, req, &auth.Claims{UserID: "user-1"})

	h.UploadFileWithKey(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if _, ok := f.get("emojis", "user-1/emoji.png"); !ok {
		t.Error("emoji object was not stored")
	}
}

// ─── DeleteFile ──────────────────────────────────────────────────────────────

func TestDeleteFile_Success_OwnedPublic(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	f.put("post-images", "user-1/photo.jpg", []byte("jpeg-bytes"), "image/jpeg")

	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/post-images/user-1/photo.jpg",
		map[string]string{"bucket": "post-images", "key": "user-1/photo.jpg"}, &auth.Claims{UserID: "user-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if _, ok := f.get("post-images", "user-1/photo.jpg"); ok {
		t.Error("object must be deleted")
	}
}

func TestDeleteFile_RemovesPreviewDerivative(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	f.put("content", "user-1/photo.jpg", []byte("jpeg-bytes"), "image/jpeg")
	f.put("content", "user-1/photo.jpg.preview.jpg", []byte("preview"), "image/jpeg")

	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/content/user-1/photo.jpg",
		map[string]string{"bucket": "content", "key": "user-1/photo.jpg"}, &auth.Claims{UserID: "user-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if _, ok := f.get("content", "user-1/photo.jpg"); ok {
		t.Error("original must be deleted")
	}
	if _, ok := f.get("content", "user-1/photo.jpg.preview.jpg"); ok {
		t.Error("preview derivative must not be orphaned")
	}
}

func TestDeleteFile_Uploads_SenderAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, f := setupStorageHandlerWithS3(t, db)
	f.put("uploads", "user-1/messenger/photo.jpg", []byte("ciphertext"), "image/jpeg")

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("user-1/messenger/photo.jpg", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/uploads/user-1/messenger/photo.jpg",
		map[string]string{"bucket": "uploads", "key": "user-1/messenger/photo.jpg"}, &auth.Claims{UserID: "user-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for sender, got %d: %s", w.Code, w.Body.String())
	}
	if _, ok := f.get("uploads", "user-1/messenger/photo.jpg"); ok {
		t.Error("sender's attachment must be deleted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestDeleteFile_Uploads_NotSender_Forbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, _ := setupStorageHandlerWithS3(t, db)

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("user-2/messenger/photo.jpg", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/uploads/user-2/messenger/photo.jpg",
		map[string]string{"bucket": "uploads", "key": "user-2/messenger/photo.jpg"}, &auth.Claims{UserID: "user-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-sender, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFile_Uploads_PreviewKey_Forbidden(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	// A derivative key must never be deletable as a user-facing attachment.
	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/uploads/user-1/messenger/photo.jpg.preview.jpg",
		map[string]string{"bucket": "uploads", "key": "user-1/messenger/photo.jpg.preview.jpg"}, &auth.Claims{UserID: "user-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for preview key, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteFile_Uploads_NilDB_Unauthorized(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)
	// db=nil → membership check is impossible → fail closed.
	c, w := newStoragePathContext(http.MethodDelete, "/storage/v1/object/uploads/user-1/messenger/photo.jpg",
		map[string]string{"bucket": "uploads", "key": "user-1/messenger/photo.jpg"}, &auth.Claims{UserID: "user-1"})

	h.DeleteFile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when db is unavailable, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── ServeObject ─────────────────────────────────────────────────────────────

func TestServeObject_Success_PublicBucket(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	f.put("content", "user-1/photo.jpg", []byte("jpeg-bytes"), "image/jpeg")

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/content/user-1/photo.jpg",
		map[string]string{"bucket": "content", "key": "user-1/photo.jpg"}, nil)

	h.ServeObject(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "jpeg-bytes" {
		t.Fatalf("unexpected body: %q", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("expected image/jpeg content type, got %q", ct)
	}
	if cc := w.Header().Get("Cache-Control"); !strings.Contains(cc, "public") {
		t.Errorf("expected public cache-control, got %q", cc)
	}
}

func TestServeObject_RangeRequest_PartialContent(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	f.put("content", "user-1/video.webm", []byte("0123456789"), "video/webm")

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/content/user-1/video.webm",
		map[string]string{"bucket": "content", "key": "user-1/video.webm"}, nil)
	c.Request.Header.Set("Range", "bytes=0-3")

	h.ServeObject(c)

	if w.Code != http.StatusPartialContent {
		t.Fatalf("expected 206, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "0123" {
		t.Fatalf("expected first 4 bytes, got %q", w.Body.String())
	}
	if cr := w.Header().Get("Content-Range"); cr != "bytes 0-3/10" {
		t.Errorf("unexpected Content-Range: %q", cr)
	}
}

func TestServeObject_NotFound_JSON(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/content/user-1/missing.jpg",
		map[string]string{"bucket": "content", "key": "user-1/missing.jpg"}, nil)

	h.ServeObject(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Object not found") {
		t.Errorf("unexpected body: %s", w.Body.String())
	}
}

func TestServeObject_AvatarPlaceholderSVG(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/post-images/user-1/avatar_123.jpg",
		map[string]string{"bucket": "post-images", "key": "user-1/avatar_123.jpg"}, nil)

	h.ServeObject(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with placeholder, got %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/svg+xml" {
		t.Errorf("expected svg content type, got %q", ct)
	}
	if !strings.Contains(w.Body.String(), "<svg") {
		t.Errorf("expected svg body, got: %s", w.Body.String())
	}
}

func TestServeObject_Uploads_NoClaims_Unauthorized(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/uploads/user-1/messenger/photo.jpg",
		map[string]string{"bucket": "uploads", "key": "user-1/messenger/photo.jpg"}, nil)

	h.ServeObject(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without claims, got %d: %s", w.Code, w.Body.String())
	}
}

func TestServeObject_Uploads_MemberAllowed_RoundTrip(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, f := setupStorageHandlerWithS3(t, db)

	// Upload through the real handler: stored encrypted at rest.
	original := testPNG(t, 20, 20)
	req := newMultipartUploadRequest(t, "file", "photo.png", original, map[string]string{
		"bucket": "uploads",
		"key":    "user-1/messenger/photo.png",
	})
	cUp, wUp := storageContext(t, req, &auth.Claims{UserID: "user-1"})
	h.UploadFileWithKey(cUp)
	if wUp.Code != http.StatusOK {
		t.Fatalf("upload failed: %d: %s", wUp.Code, wUp.Body.String())
	}

	// A chat member may then read it back — and gets the DECRYPTED original.
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("user-1/messenger/photo.png", "user-2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/uploads/user-1/messenger/photo.png",
		map[string]string{"bucket": "uploads", "key": "user-1/messenger/photo.png"}, &auth.Claims{UserID: "user-2"})
	h.ServeObject(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for member, got %d: %s", w.Code, w.Body.String())
	}
	if !bytes.Equal(w.Body.Bytes(), original) {
		t.Error("member must receive the decrypted original bytes")
	}
	if cc := w.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Errorf("private messenger objects must be no-store, got %q", cc)
	}
	// The bytes at rest in the fake S3 must be ciphertext (round-trip sanity).
	stored, _ := f.get("uploads", "user-1/messenger/photo.png")
	if bytes.Equal(stored, original) {
		t.Error("object must be encrypted at rest")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestServeObject_Uploads_Denied_Forbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, _ := setupStorageHandlerWithS3(t, db)

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("user-1/messenger/photo.jpg", "user-2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/uploads/user-1/messenger/photo.jpg",
		map[string]string{"bucket": "uploads", "key": "user-1/messenger/photo.jpg"}, &auth.Claims{UserID: "user-2"})
	h.ServeObject(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-member, got %d: %s", w.Code, w.Body.String())
	}
}

func TestServeObject_Uploads_NotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	h, _ := setupStorageHandlerWithS3(t, db)

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("user-1/messenger/missing.jpg", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/object/uploads/user-1/messenger/missing.jpg",
		map[string]string{"bucket": "uploads", "key": "user-1/messenger/missing.jpg"}, &auth.Claims{UserID: "user-1"})
	h.ServeObject(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Avatars ─────────────────────────────────────────────────────────────────

func TestUploadAvatar_Success(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	pngBytes := testPNG(t, 40, 40)
	req := newMultipartUploadRequest(t, "avatar", "avatar.png", pngBytes, nil)
	c, w := storageContext(t, req, nil)

	h.UploadAvatar(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"success":true`) {
		t.Errorf("expected success response, got: %s", w.Body.String())
	}
	// Avatar keys are md5-based, no user prefix.
	key := fmt.Sprintf("%x.png", md5.Sum(pngBytes))
	if _, ok := f.get("avatars", key); !ok {
		t.Error("avatar object was not stored under its md5 key")
	}
}

func TestGetAvatar_Success(t *testing.T) {
	h, f := setupStorageHandlerWithS3(t, nil)
	f.put("avatars", "abc123.png", []byte("avatar-bytes"), "image/png")

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/avatar/abc123.png",
		map[string]string{"key": "abc123.png"}, nil)

	h.GetAvatar(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "avatar-bytes" {
		t.Fatalf("unexpected body: %q", w.Body.String())
	}
}

func TestGetAvatar_NotFound(t *testing.T) {
	h, _ := setupStorageHandlerWithS3(t, nil)

	c, w := newStoragePathContext(http.MethodGet, "/storage/v1/avatar/missing.png",
		map[string]string{"key": "missing.png"}, nil)

	h.GetAvatar(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

func TestIsImageBucket(t *testing.T) {
	for _, b := range []string{"uploads", "content", "post-images", "avatars", "wall"} {
		if !isImageBucket(b) {
			t.Errorf("expected %q to be an image bucket", b)
		}
	}
	for _, b := range []string{"emojis", "gift-layers", "unknown"} {
		if isImageBucket(b) {
			t.Errorf("expected %q to NOT be an image bucket", b)
		}
	}
}

func TestIsImageKey(t *testing.T) {
	for _, k := range []string{"a.jpg", "b.JPEG", "c.png", "d.gif", "e.webp"} {
		if !isImageKey(k) {
			t.Errorf("expected %q to be an image key", k)
		}
	}
	for _, k := range []string{"a.txt", "b.mp4", "c.pdf", ""} {
		if isImageKey(k) {
			t.Errorf("expected %q to NOT be an image key", k)
		}
	}
}

func TestValidateEmojiUpload_Valid(t *testing.T) {
	if err := validateEmojiUpload(testPNG(t, 64, 64)); err != nil {
		t.Fatalf("valid emoji rejected: %v", err)
	}
}

func TestValidateEmojiUpload_InvalidImage(t *testing.T) {
	if err := validateEmojiUpload([]byte("not an image")); err == nil {
		t.Fatal("expected invalid image error")
	}
}

func TestValidateEmojiUpload_TooLarge(t *testing.T) {
	if err := validateEmojiUpload(make([]byte, 600*1024)); err == nil {
		t.Fatal("expected size error")
	}
}

// newStoragePathContext builds a gin context for GET/DELETE handlers with path
// params and optional claims.
func newStoragePathContext(method, url string, pathParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, url, nil)
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}
