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
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "Bucket not allowed",
		})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "No file provided",
		})
		return
	}
	defer file.Close()

	if header.Size > maxUploadBytes {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "File too large (max 10MB)",
		})
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowedTypes := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".webp": true, ".pdf": true, ".txt": true, ".md": true,
	}
	if !allowedTypes[ext] {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "File type not allowed",
		})
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, storage.UploadResponse{
			Success: false,
			Error:   "Failed to read file",
		})
		return
	}
	if int64(len(data)) > maxUploadBytes {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "File too large (max 10MB)",
		})
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
		c.JSON(http.StatusInternalServerError, storage.UploadResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, storage.UploadResponse{
		Success: true,
		File:    fileInfo,
	})
}

func (h *StorageHandler) DownloadFile(c *gin.Context) {
	bucket := c.Param("bucket")
	key := c.Param("key")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, storage.DownloadResponse{
			Success: false,
			Error:   "Bucket and key are required",
		})
		return
	}

	data, contentType, err := h.client.GetFile(bucket, key)
	if err != nil {
		c.JSON(http.StatusNotFound, storage.DownloadResponse{
			Success: false,
			Error:   "File not found",
		})
		return
	}

	c.Data(http.StatusOK, contentType, data)
}

func (h *StorageHandler) DeleteFile(c *gin.Context) {
	bucket := c.Param("bucket")
	key := c.Param("key")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, storage.DeleteResponse{
			Success: false,
			Error:   "Bucket and key are required",
		})
		return
	}

	if err := h.client.DeleteFile(bucket, key); err != nil {
		c.JSON(http.StatusInternalServerError, storage.DeleteResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, storage.DeleteResponse{Success: true})
}

func (h *StorageHandler) GetPresignedURL(c *gin.Context) {
	bucket := c.Param("bucket")
	key := c.Param("key")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, storage.PresignedURLResponse{
			Success: false,
			Error:   "Bucket and key are required",
		})
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
		c.JSON(http.StatusInternalServerError, storage.PresignedURLResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, storage.PresignedURLResponse{
		Success: true,
		URL:     url,
	})
}

func (h *StorageHandler) PresignUpload(c *gin.Context) {
	var req storage.PresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, storage.PresignUploadResponse{
			Success: false,
			Error:   "Invalid request body",
		})
		return
	}

	req.Bucket = strings.TrimSpace(req.Bucket)
	req.Key = strings.TrimSpace(req.Key)
	if req.Bucket == "" || req.Key == "" {
		c.JSON(http.StatusBadRequest, storage.PresignUploadResponse{
			Success: false,
			Error:   "Bucket and key are required",
		})
		return
	}
	if !storage.IsAllowedBucket(req.Bucket) {
		c.JSON(http.StatusBadRequest, storage.PresignUploadResponse{
			Success: false,
			Error:   "Bucket not allowed",
		})
		return
	}
	if err := storage.ValidateObjectKey(req.Key); err != nil {
		c.JSON(http.StatusBadRequest, storage.PresignUploadResponse{
			Success: false,
			Error:   err.Error(),
		})
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
		c.JSON(http.StatusInternalServerError, storage.PresignUploadResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, storage.PresignUploadResponse{
		Success:   true,
		UploadURL: uploadURL,
		Bucket:    req.Bucket,
		Key:       req.Key,
	})
}

// ServeObject streams an object from Garage through the API (same origin as the web app).
func (h *StorageHandler) ServeObject(c *gin.Context) {
	bucket := strings.TrimSpace(c.Param("bucket"))
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")

	if bucket == "" || key == "" {
		c.JSON(http.StatusBadRequest, storage.PresignedURLResponse{
			Success: false,
			Error:   "Bucket and key are required",
		})
		return
	}
	if !storage.IsAllowedBucket(bucket) {
		c.JSON(http.StatusBadRequest, storage.PresignedURLResponse{
			Success: false,
			Error:   "Bucket not allowed",
		})
		return
	}
	if err := storage.ValidateObjectKey(key); err != nil {
		c.JSON(http.StatusBadRequest, storage.PresignedURLResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	out, err := h.client.GetObject(c.Request.Context(), bucket, key)
	if err != nil {
		if storage.IsNotFound(err) {
			if bucket == "post-images" && strings.Contains(key, "avatar") {
				c.Header("Content-Type", "image/svg+xml")
				c.Header("Cache-Control", "public, max-age=3600")
				c.Data(http.StatusOK, "image/svg+xml", []byte(storage.AvatarPlaceholderSVG))
				return
			}
			c.JSON(http.StatusNotFound, storage.PresignedURLResponse{
				Success: false,
				Error:   "Object not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load object"})
		return
	}
	defer out.Body.Close()

	if out.ContentType != nil && aws.ToString(out.ContentType) != "" {
		c.Header("Content-Type", aws.ToString(out.ContentType))
	}
	if out.ContentLength != nil && *out.ContentLength > 0 {
		c.Header("Content-Length", fmt.Sprintf("%d", *out.ContentLength))
	}
	if out.ETag != nil {
		c.Header("ETag", aws.ToString(out.ETag))
	}
	c.Header("Cache-Control", "public, max-age=3600")

	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, out.Body); err != nil {
		return
	}
}
