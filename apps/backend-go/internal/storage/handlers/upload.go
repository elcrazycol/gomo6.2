package handlers

import (
	"crypto/md5"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/storage"
)

const maxUploadBytes = 10 * 1024 * 1024

type StorageHandler struct {
	client *storage.StorageClient
}

func NewStorageHandler(client *storage.StorageClient) *StorageHandler {
	return &StorageHandler{client: client}
}

func (h *StorageHandler) UploadFile(c *gin.Context) {
	bucket := strings.TrimSpace(c.PostForm("bucket"))
	if bucket == "" {
		bucket = "uploads"
	}
	if !storage.IsAllowedBucket(bucket) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket not allowed"))
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No file provided"))
		return
	}
	defer file.Close()

	if header.Size > maxUploadBytes {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("File too large (max 10MB)"))
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowedTypes := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".webp": true, ".pdf": true, ".txt": true, ".md": true,
	}
	if !allowedTypes[ext] {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("File type not allowed"))
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to read file"))
		return
	}
	if int64(len(data)) > maxUploadBytes {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("File too large (max 10MB)"))
		return
	}

	hash := fmt.Sprintf("%x", md5.Sum(data))
	key := fmt.Sprintf("%s%s", hash, ext)

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	fileInfo, err := h.client.UploadFile(bucket, key, data, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"file": fileInfo}))
}

func (h *StorageHandler) DownloadFile(c *gin.Context) {
	bucket := c.Param("bucket")
	key := c.Param("key")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket and key are required"))
		return
	}

	data, contentType, err := h.client.GetFile(bucket, key)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("File not found"))
		return
	}

	c.Data(http.StatusOK, contentType, data)
}

func (h *StorageHandler) DeleteFile(c *gin.Context) {
	bucket := c.Param("bucket")
	key := c.Param("key")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket and key are required"))
		return
	}

	if err := h.client.DeleteFile(bucket, key); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

func (h *StorageHandler) GetPresignedURL(c *gin.Context) {
	bucket := c.Param("bucket")
	key := c.Param("key")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket and key are required"))
		return
	}

	expires := int64(3600)
	if exp := c.Query("expires"); exp != "" {
		if parsed, err := strconv.ParseInt(exp, 10, 64); err == nil {
			expires = parsed
		}
	}

	url, err := h.client.GetPresignedURL(bucket, key, time.Duration(expires)*time.Second)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"url": url}))
}

func (h *StorageHandler) PresignUpload(c *gin.Context) {
	var req storage.PresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	req.Bucket = strings.TrimSpace(req.Bucket)
	req.Key = strings.TrimSpace(req.Key)
	if req.Bucket == "" || req.Key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket and key are required"))
		return
	}
	if !storage.IsAllowedBucket(req.Bucket) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Bucket not allowed"))
		return
	}
	if err := storage.ValidateObjectKey(req.Key); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	expiresSeconds := req.Expires
	if expiresSeconds <= 0 {
		expiresSeconds = 3600
	}
	if req.ContentType == "" {
		req.ContentType = "application/octet-stream"
	}

	uploadURL, err := h.client.GetPresignedPutURL(req.Bucket, req.Key, req.ContentType, time.Duration(expiresSeconds)*time.Second)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"upload_url": uploadURL,
		"bucket":     req.Bucket,
		"key":        req.Key,
	}))
}

// ServeObject streams an object from Garage through the API (same origin as the web app).
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

	// Set common headers
	if out.ContentType != nil && aws.ToString(out.ContentType) != "" {
		c.Header("Content-Type", aws.ToString(out.ContentType))
	}
	if out.ETag != nil {
		c.Header("ETag", aws.ToString(out.ETag))
	}
	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "public, max-age=3600")
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
