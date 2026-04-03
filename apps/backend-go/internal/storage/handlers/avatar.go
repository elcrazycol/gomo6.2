package handlers

import (
	"crypto/md5"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/storage"
)

func (h *StorageHandler) UploadAvatar(c *gin.Context) {
	file, header, err := c.Request.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "No avatar file provided",
		})
		return
	}
	defer file.Close()

	// Validate file type
	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowedTypes := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".gif":  true,
		".webp": true,
	}

	if !allowedTypes[ext] {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "Avatar file type not allowed (only jpg, png, gif, webp)",
		})
		return
	}

	// Validate file size (5MB max for avatars)
	if header.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "Avatar file too large (max 5MB)",
		})
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, 5*1024*1024+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, storage.UploadResponse{
			Success: false,
			Error:   "Failed to read avatar file",
		})
		return
	}
	if len(data) > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, storage.UploadResponse{
			Success: false,
			Error:   "Avatar file too large (max 5MB)",
		})
		return
	}

	hash := fmt.Sprintf("%x", md5.Sum(data))
	key := fmt.Sprintf("%s%s", hash, ext)

	// Determine content type
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
		if ext == ".png" {
			contentType = "image/png"
		} else if ext == ".gif" {
			contentType = "image/gif"
		} else if ext == ".webp" {
			contentType = "image/webp"
		}
	}

	// Upload avatar
	fileInfo, err := h.client.UploadFile("avatars", key, data, contentType)
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

func (h *StorageHandler) GetAvatar(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, storage.DownloadResponse{
			Success: false,
			Error:   "Avatar key is required",
		})
		return
	}

	data, contentType, err := h.client.GetFile("avatars", key)
	if err != nil {
		c.JSON(http.StatusNotFound, storage.DownloadResponse{
			Success: false,
			Error:   "Avatar not found",
		})
		return
	}

	c.Data(http.StatusOK, contentType, data)
}
