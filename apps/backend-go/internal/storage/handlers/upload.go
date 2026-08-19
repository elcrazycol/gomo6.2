package handlers

import (
	"bytes"
	"crypto/md5"
	"database/sql"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/media"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/storage"
	_ "golang.org/x/image/webp"
)

const (
	// Videos are transcoded on the server, so keep the input bounded: multipart
	// data is read by the API before ffmpeg processes it.
	maxUploadBytes      = 50 * 1024 * 1024
	maxEmojiUploadBytes = 512 * 1024
	maxEmojiDimension   = 128
)

type imageVariantResponse struct {
	PreviewKey  string `json:"preview_key"`
	LQIP        string `json:"lqip"`
	ThumbHash   string `json:"thumb_hash"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	ContentType string `json:"content_type"`
}

type videoVariantResponse struct {
	PosterKey   string `json:"poster_key"`
	ContentType string `json:"content_type"`
}

type StorageHandler struct {
	client *storage.StorageClient
	db     *sql.DB
}

// db is optional for compatibility with validation-only tests. Production
// callers pass it so private messenger objects can be authorized by message
// membership before any bytes leave Garage.
func NewStorageHandler(client *storage.StorageClient, db ...*sql.DB) *StorageHandler {
	var database *sql.DB
	if len(db) > 0 {
		database = db[0]
	}
	return &StorageHandler{client: client, db: database}
}

// isAdmin reports whether the user holds the platform 'admin' role. Used to
// gate writes to the admin-managed gift-layers bucket, whose keys are NOT
// namespaced by user ID (e.g. gifts/<id>/base.png). Fails closed when the DB
// is unavailable — a nil db only occurs in validation-only unit tests.
func (h *StorageHandler) isAdmin(userID string) bool {
	if h.db == nil {
		return false
	}
	var count int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role = 'admin'`, userID).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

// readUploadFile reads and validates a single file from multipart form.
// Returns file data, original header, and any error.
func (h *StorageHandler) readUploadFile(c *gin.Context) (data []byte, header *multipart.FileHeader, err error) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		return nil, nil, fmt.Errorf("no file provided")
	}
	defer file.Close()

	if header.Size > maxUploadBytes {
		return nil, nil, fmt.Errorf("file too large (max %dMB)", maxUploadBytes/(1024*1024))
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowedTypes := map[string]bool{
		// Images
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".webp": true,
		// Video inputs are normalized to H.264/AAC MP4 before storing.
		".mp4": true, ".webm": true, ".mov": true, ".m4v": true,
		// Audio
		".mp3": true, ".ogg": true, ".wav": true, ".flac": true,
		".m4a": true, ".aac": true,
		// Documents
		".pdf": true, ".txt": true, ".md": true,
	}
	if !allowedTypes[ext] {
		return nil, nil, fmt.Errorf("file type not allowed: %s", ext)
	}

	data, err = io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read file")
	}
	if int64(len(data)) > maxUploadBytes {
		return nil, nil, fmt.Errorf("file too large (max %dMB)", maxUploadBytes/(1024*1024))
	}

	return data, header, nil
}

// UploadFile stores a file with an auto-generated MD5-based key.
func (h *StorageHandler) UploadFile(c *gin.Context) {
	bucket := strings.TrimSpace(c.PostForm("bucket"))
	if bucket == "" {
		bucket = "uploads"
	}
	if !storage.IsAllowedBucket(bucket) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket not allowed"))
		return
	}

	data, header, err := h.readUploadFile(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	hash := fmt.Sprintf("%x", md5.Sum(data))
	key := fmt.Sprintf("%s%s", hash, ext)
	if bucket == "uploads" {
		claimsValue, exists := c.Get("claims")
		claims, claimsOK := claimsValue.(*auth.Claims)
		if !exists || !claimsOK || claims == nil || claims.UserID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return
		}
		// Keep the legacy auto-key endpoint safe and compatible with the
		// explicit-key messenger endpoint. A root-level uploads key cannot be
		// authorized against a message attachment row.
		key = fmt.Sprintf("%s/messenger/%s%s", claims.UserID, hash, ext)
	}

	// H2.1: the stored Content-Type is derived server-side from the extension,
	// never from the client's multipart part header — a client-declared
	// text/html can no longer be persisted and later executed in the app origin.
	contentType := contentTypeForUpload(header.Filename)

	var generated *media.ImageVariants
	if isImageBucket(bucket) && isImageKey(key) {
		generated, err = media.GenerateImageVariants(data)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("invalid image"))
			return
		}
		// H2.2: persist the EXIF/GPS-stripped re-encode produced alongside the
		// preview instead of the raw upload bytes.
		data = generated.Original
	}

	var fileInfo *storage.FileInfo
	if bucket == "uploads" {
		fileInfo, err = h.client.UploadFileEncrypted(bucket, key, data, contentType)
	} else {
		fileInfo, err = h.client.UploadFile(bucket, key, data, contentType)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	response := gin.H{"file": fileInfo, "key": key}
	if generated != nil {
		previewKey := key + ".preview.jpg"
		var previewInfo *storage.FileInfo
		if bucket == "uploads" {
			previewInfo, err = h.client.UploadFileEncrypted(bucket, previewKey, generated.Preview, generated.PreviewType)
		} else {
			previewInfo, err = h.client.UploadFile(bucket, previewKey, generated.Preview, generated.PreviewType)
		}
		_ = previewInfo
		if err != nil {
			_ = h.client.DeleteFile(bucket, key)
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("failed to store image preview"))
			return
		}
		response["variants"] = &imageVariantResponse{
			PreviewKey:  previewKey,
			LQIP:        generated.LQIP,
			ThumbHash:   generated.ThumbHash,
			Width:       generated.Width,
			Height:      generated.Height,
			ContentType: generated.PreviewType,
		}
	}
	c.JSON(http.StatusOK, models.SuccessResponse(response))
}

// UploadFileWithKey stores a file with an explicit key from the frontend.
// Accepts multipart form: file, bucket, key.
// This is the replacement for presign-upload — browser uploads through backend,
// avoiding CORS and S3 signature issues with direct Garage access.
// UploadFileWithKey godoc
// @Summary      Upload file with key
// @Description  Upload a file (multipart) to a bucket under an explicit key owned by the user. NOTE: the actual path is /storage/v1/upload, outside the /api/v1 base path shown here.
// @Tags         Storage
// @Accept       multipart/form-data
// @Produce      json
// @Param        file formData file true "File to upload (max 50MB)"
// @Param        bucket formData string true "Bucket: uploads, content, post-images, avatars, wall, emojis"
// @Param        key formData string true "Object key — must start with <userID>/ (or <userID>/messenger/ for uploads). gift-layers is admin-managed and accepts keys like gifts/<id>/base.png"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /storage/v1/upload [post]
// @Security     BearerAuth
func (h *StorageHandler) UploadFileWithKey(c *gin.Context) {
	bucket := strings.TrimSpace(c.PostForm("bucket"))
	key := strings.TrimSpace(c.PostForm("key"))

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket and key are required"))
		return
	}
	if !storage.IsAllowedBucket(bucket) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket not allowed"))
		return
	}
	if err := storage.ValidateObjectKey(key); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	data, header, err := h.readUploadFile(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	if bucket == "emojis" {
		if err := validateEmojiUpload(data); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}
	}

	// H2.1: server-derived Content-Type — see contentTypeForUpload.
	contentType := contentTypeForUpload(header.Filename)

	// Ownership check. Messenger attachments live under <userID>/messenger/,
	// every other user-uploaded object under <userID>/... . Keys are guessable
	// (e.g. <userID>/avatar_<ts>.jpg), so an authenticated user must never be
	// allowed to write into another user's namespace and overwrite their files.
	// The admin-managed gift-layers bucket is exempt: gift images/layers are
	// uploaded by the dev-dashboard under keys like gifts/<id>/base.png, which
	// carry no user ID. Access there is gated by the platform admin role.
	claimsValue, exists := c.Get("claims")
	claims, claimsOK := claimsValue.(*auth.Claims)
	if !exists || !claimsOK || claims == nil || claims.UserID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	if bucket == "gift-layers" {
		if !h.isAdmin(claims.UserID) {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
			return
		}
	} else if bucket == "uploads" {
		if !strings.HasPrefix(key, claims.UserID+"/messenger/") {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Invalid attachment key"))
			return
		}
	} else if !strings.HasPrefix(key, claims.UserID+"/") {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Invalid object key"))
		return
	}

	// Generate derivatives before writing, but persist the original first. If
	// the derivative write fails we can remove the original and avoid returning
	// a reference that cannot render its preview. Both objects are encrypted at
	// rest and share the same private namespace.
	var generated *media.ImageVariants
	var variants *imageVariantResponse
	if isImageBucket(bucket) && isImageKey(key) {
		generated, err = media.GenerateImageVariants(data)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("invalid image"))
			return
		}
		// H2.2: persist the EXIF/GPS-stripped re-encode instead of the raw
		// upload bytes (produced inside GenerateImageVariants — no extra
		// decode on the hot path).
		data = generated.Original
		variants = &imageVariantResponse{
			PreviewKey:  key + ".preview.jpg",
			LQIP:        generated.LQIP,
			ThumbHash:   generated.ThumbHash,
			Width:       generated.Width,
			Height:      generated.Height,
			ContentType: generated.PreviewType,
		}
	}
	var videoVariants *videoVariantResponse
	var poster []byte
	if isVideoKey(key) {
		generatedVideo, videoErr := media.GenerateVideoVariants(c.Request.Context(), data, filepath.Ext(key))
		if videoErr != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrVideoProcessing, "Failed to process video", map[string]string{"reason": videoErr.Error()}))
			return
		}
		// FFmpeg always writes MP4, so the key and MIME stay truthful even for
		// MOV/WebM input.
		key = strings.TrimSuffix(key, filepath.Ext(key)) + ".mp4"
		data = generatedVideo.Video
		poster = generatedVideo.Poster
		contentType = "video/mp4"
		videoVariants = &videoVariantResponse{PosterKey: key + ".poster.jpg", ContentType: "video/mp4"}
	}

	// Encrypt messenger attachments at rest.
	var fileInfo *storage.FileInfo
	if bucket == "uploads" {
		fileInfo, err = h.client.UploadFileEncrypted(bucket, key, data, contentType)
	} else {
		fileInfo, err = h.client.UploadFile(bucket, key, data, contentType)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	if variants != nil {
		if bucket == "uploads" {
			_, err = h.client.UploadFileEncrypted(bucket, variants.PreviewKey, generated.Preview, generated.PreviewType)
		} else {
			_, err = h.client.UploadFile(bucket, variants.PreviewKey, generated.Preview, generated.PreviewType)
		}
		if err != nil {
			// Best-effort rollback. A scheduled orphan cleanup is still advisable
			// for process crashes between independent S3 operations.
			_ = h.client.DeleteFile(bucket, key)
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("failed to store image preview"))
			return
		}
	}
	if videoVariants != nil {
		// Messenger video posters are private attachment data like the clip
		// itself: encrypt them at rest in the uploads bucket so a leaked object
		// key never exposes the frame. Public buckets stay plaintext.
		if bucket == "uploads" {
			_, err = h.client.UploadFileEncrypted(bucket, videoVariants.PosterKey, poster, "image/jpeg")
		} else {
			_, err = h.client.UploadFile(bucket, videoVariants.PosterKey, poster, "image/jpeg")
		}
		if err != nil {
			_ = h.client.DeleteFile(bucket, key)
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("failed to store video preview"))
			return
		}
	}

	response := gin.H{
		"file": fileInfo,
		"key":  key,
	}
	if variants != nil {
		response["variants"] = variants
	}
	if videoVariants != nil {
		response["video"] = videoVariants
	}
	c.JSON(http.StatusOK, models.SuccessResponse(response))
}

func validateEmojiUpload(data []byte) error {
	if len(data) > maxEmojiUploadBytes {
		return fmt.Errorf("emoji file too large (max %dKB)", maxEmojiUploadBytes/1024)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("invalid emoji image")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxEmojiDimension || config.Height > maxEmojiDimension {
		return fmt.Errorf("emoji dimensions must not exceed %d×%dpx", maxEmojiDimension, maxEmojiDimension)
	}
	return nil
}

func isImageBucket(bucket string) bool {
	switch bucket {
	case "uploads", "content", "post-images", "avatars", "wall":
		return true
	default:
		return false
	}
}

func isPreviewKey(key string) bool {
	return strings.HasSuffix(strings.ToLower(key), ".preview.jpg")
}

func attachmentKeyForLookup(key string) string {
	return strings.TrimSuffix(key, ".preview.jpg")
}

func isImageKey(key string) bool {
	ext := strings.ToLower(filepath.Ext(key))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}

func isVideoKey(key string) bool {
	switch strings.ToLower(filepath.Ext(key)) {
	case ".mp4", ".webm", ".mov", ".m4v":
		return true
	default:
		return false
	}
}

// DeleteFile godoc
// @Summary      Delete object
// @Description  Delete an object the user owns (messenger uploads require an attachment row owned by the caller). NOTE: the actual path is /storage/v1/object/{bucket}/{key}, outside the /api/v1 base path shown here.
// @Tags         Storage
// @Produce      json
// @Param        bucket path string true "Bucket"
// @Param        key path string true "Object key"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /storage/v1/object/{bucket}/{key} [delete]
// @Security     BearerAuth
func (h *StorageHandler) DeleteFile(c *gin.Context) {
	bucket := strings.TrimSpace(c.Param("bucket"))
	key := strings.TrimPrefix(c.Param("key"), "/")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket and key are required"))
		return
	}
	if !storage.IsAllowedBucket(bucket) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket not allowed"))
		return
	}
	if err := storage.ValidateObjectKey(key); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid object key"))
		return
	}

	// Ownership check. Messenger uploads are private and may only be deleted by
	// the sender of an attachment row. Public-bucket objects are user-scoped by
	// key (<userID>/...), so deleting outside your own namespace is forbidden —
	// object keys are guessable enough to make an unauthorised DELETE dangerous.
	// gift-layers is admin-managed (keys like gifts/<id>/base.png), so its
	// deletions require the platform admin role instead of a user prefix.
	claimsValue, exists := c.Get("claims")
	claims, claimsOK := claimsValue.(*auth.Claims)
	if !exists || !claimsOK || claims == nil || claims.UserID == "" {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	if bucket == "gift-layers" {
		if !h.isAdmin(claims.UserID) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
	} else if bucket == "uploads" {
		// A derivative is never a user-facing attachment target. Rejecting it
		// before the ownership query also prevents attachmentKeyForLookup from
		// authorizing a preview delete as if it were the original object.
		if isPreviewKey(key) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		if h.db == nil {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		var owned bool
		err := h.db.QueryRowContext(c.Request.Context(), `
			SELECT EXISTS(
				SELECT 1
				FROM message_attachments a
				JOIN chat_messages m ON m.id = a.message_id
				WHERE a.url = $1 AND m.sender_user_id = $2
			)`, attachmentKeyForLookup(key), claims.UserID).Scan(&owned)
		if err != nil || !owned {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
	} else if !strings.HasPrefix(key, claims.UserID+"/") {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	if err := h.client.DeleteFile(bucket, key); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	// Derivatives are private implementation details and must not become
	// orphaned when the user removes the attachment reference.
	if isImageBucket(bucket) && isImageKey(key) {
		_ = h.client.DeleteFile(bucket, key+".preview.jpg")
	}
	if isVideoKey(key) {
		_ = h.client.DeleteFile(bucket, key+".poster.jpg")
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// ServeObject streams an object from Garage through the API (same origin as the web app).
// ServeObject godoc
// @Summary      Get object
// @Description  Stream an object from storage (supports Range requests). The private 'uploads' bucket requires message membership. NOTE: the actual path is /storage/v1/object/{bucket}/{key}, outside the /api/v1 base path shown here.
// @Tags         Storage
// @Produce      application/octet-stream
// @Param        bucket path string true "Bucket"
// @Param        key path string true "Object key"
// @Success      200 {file} binary
// @Success      206 {file} binary
// @Failure      400 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /storage/v1/object/{bucket}/{key} [get]
func (h *StorageHandler) ServeObject(c *gin.Context) {
	bucket := strings.TrimSpace(c.Param("bucket"))
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket and key are required"))
		return
	}
	if !storage.IsAllowedBucket(bucket) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket not allowed"))
		return
	}
	if err := storage.ValidateObjectKey(key); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// uploads is a private messenger bucket. The URL is intentionally a Go
	// proxy, not a public Garage website object. Membership is checked against
	// the attachment row, so knowing a key is never sufficient for access.
	if bucket == "uploads" {
		claimsValue, exists := c.Get("claims")
		claims, claimsOK := claimsValue.(*auth.Claims)
		if !exists || !claimsOK || claims == nil || claims.UserID == "" || h.db == nil {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		var allowed bool
		err := h.db.QueryRowContext(c.Request.Context(), `
			SELECT EXISTS(
				SELECT 1
				FROM message_attachments a
				JOIN chat_messages m ON m.id = a.message_id
				JOIN chat_members cm ON cm.conversation_id = m.conversation_id
				WHERE a.url = $1 AND cm.user_id = $2
			)`, attachmentKeyForLookup(key), claims.UserID).Scan(&allowed)
		if err != nil || !allowed {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
	}

	// Encrypted messenger objects must be downloaded and decrypted before
	// returning bytes. Range requests cannot be applied to ciphertext safely,
	// so uploads use the normal full-object path.
	if bucket == "uploads" {
		data, contentType, err := h.client.GetFileEncrypted(bucket, key)
		if err != nil {
			if storage.IsNotFound(err) {
				c.JSON(http.StatusNotFound, models.ErrorResponse("Object not found"))
			} else {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to load object"))
			}
			return
		}
		// H2.1: legacy objects may carry a client-forged type — force unsafe
		// types to an opaque attachment so they can never run as a document.
		ctype, disp := safeContentHeaders(contentType)
		if strings.HasSuffix(strings.ToLower(key), ".preview.jpg") {
			c.Header("Cache-Control", "private, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "private, no-store")
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Security-Policy", "sandbox")
		c.Header("Content-Disposition", disp)
		c.Data(http.StatusOK, ctype, data)
		return
	}

	// Parse Range header for partial content support
	rangeHeader := c.GetHeader("Range")
	var rangeStart, rangeEnd *int64

	if rangeHeader != "" {
		// Parse "bytes=start-end" format
		if strings.HasPrefix(rangeHeader, "bytes=") {
			rangeSpec := strings.TrimPrefix(rangeHeader, "bytes=")
			parts := strings.Split(rangeSpec, "-")
			if len(parts) == 2 {
				if parts[0] != "" {
					if start, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
						rangeStart = &start
					}
				}
				if parts[1] != "" {
					if end, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
						rangeEnd = &end
					}
				}
			}
		}
	}

	out, err := h.client.GetObjectRange(c.Request.Context(), bucket, key, rangeStart, rangeEnd)
	if err != nil {
		if storage.IsNotFound(err) {
			if bucket == "post-images" && strings.Contains(key, "avatar") {
				c.Header("Content-Type", "image/svg+xml")
				c.Header("Cache-Control", "public, max-age=3600")
				c.Header("Content-Security-Policy", "sandbox")
				c.Data(http.StatusOK, "image/svg+xml", []byte(storage.AvatarPlaceholderSVG))
				return
			}
			c.JSON(http.StatusNotFound, models.ErrorResponse("Object not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to load object"))
		return
	}
	defer out.Body.Close()

	// Set common headers. The stored Content-Type may be client-forged on
	// legacy objects, so unsafe/unknown types are downgraded to an opaque
	// attachment (H2.1).
	if out.ContentType != nil && aws.ToString(out.ContentType) != "" {
		ctype, disp := safeContentHeaders(aws.ToString(out.ContentType))
		c.Header("Content-Type", ctype)
		c.Header("Content-Disposition", disp)
	} else {
		c.Header("Content-Type", "application/octet-stream")
		c.Header("Content-Disposition", "attachment")
	}
	if out.ETag != nil {
		c.Header("ETag", aws.ToString(out.ETag))
	}
	c.Header("Accept-Ranges", "bytes")
	if bucket == "uploads" {
		if strings.HasSuffix(strings.ToLower(key), ".preview.jpg") {
			c.Header("Cache-Control", "private, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "private, no-store")
		}
	} else if isPreviewKey(key) {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		c.Header("Cache-Control", "public, max-age=3600")
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox")
	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Content-Type, Range")
	c.Header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, Accept-Ranges")

	// Handle range response
	if out.ContentRange != nil && aws.ToString(out.ContentRange) != "" {
		c.Header("Content-Range", aws.ToString(out.ContentRange))
		if out.ContentLength != nil && *out.ContentLength > 0 {
			c.Header("Content-Length", fmt.Sprintf("%d", *out.ContentLength))
		}
		c.Status(http.StatusPartialContent)
	} else {
		if out.ContentLength != nil && *out.ContentLength > 0 {
			c.Header("Content-Length", fmt.Sprintf("%d", *out.ContentLength))
		}
		c.Status(http.StatusOK)
	}

	if _, err := io.Copy(c.Writer, out.Body); err != nil {
		return
	}
}
