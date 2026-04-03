package middleware

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// ValidateFileMiddleware validates file uploads
func ValidateFileMiddleware(maxSize int64, allowedTypes []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"error":   "No file provided",
			})
			c.Abort()
			return
		}
		file.Close()

		// Check file size
		if header.Size > maxSize {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"error":   "File too large",
			})
			c.Abort()
			return
		}

		// Check file type
		ext := strings.ToLower(filepath.Ext(header.Filename))
		allowed := false
		for _, allowedExt := range allowedTypes {
			if ext == allowedExt {
				allowed = true
				break
			}
		}

		if !allowed {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"error":   "File type not allowed",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ValidateImageMiddleware validates image uploads
func ValidateImageMiddleware() gin.HandlerFunc {
	allowedTypes := []string{".jpg", ".jpeg", ".png", ".gif", ".webp"}
	return ValidateFileMiddleware(10*1024*1024, allowedTypes) // 10MB max
}

// ValidateAvatarMiddleware validates avatar uploads
func ValidateAvatarMiddleware() gin.HandlerFunc {
	allowedTypes := []string{".jpg", ".jpeg", ".png", ".gif", ".webp"}
	return ValidateFileMiddleware(5*1024*1024, allowedTypes) // 5MB max
}
