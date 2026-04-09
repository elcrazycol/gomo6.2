package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dhowden/tag"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

type AudioHandler struct{}

func NewAudioHandler() *AudioHandler {
	return &AudioHandler{}
}

// ExtractAudioMetadata extracts metadata from uploaded audio file
func (h *AudioHandler) ExtractAudioMetadata(c *gin.Context) {
	file, header, err := c.Request.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Failed to get audio file"),
		})
		return
	}
	defer file.Close()

	// Create temporary file
	tempFile, err := os.CreateTemp("", "audio-*.tmp")
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Failed to create temp file"),
		})
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Copy uploaded file to temp
	_, err = io.Copy(tempFile, file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Failed to save temp file"),
		})
		return
	}

	// Seek back to beginning of temp file for reading
	tempFile.Seek(0, 0)

	// Extract metadata using tag library
	metadata, err := tag.ReadFrom(tempFile)
	if err != nil {
		fmt.Printf("Failed to extract audio metadata: %v\n", err)
		// Return basic info even if metadata extraction fails
		c.JSON(http.StatusOK, gin.H{
			"title":    strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename)),
			"artist":   nil,
			"album":    nil,
			"duration": nil,
			"coverArt": nil,
		})
		return
	}

	// Get duration - tag library doesn't provide duration, so we'll return 0 for now
	// For real duration extraction, you'd need ffmpeg integration
	duration := float64(0)

	// Extract cover art
	var coverArtURL string
	if metadata.Picture() != nil {
		picture := metadata.Picture()
		if picture != nil {
			// For now, we'll just indicate there's cover art
			// In a real implementation, you'd upload this to storage
			coverArtURL = "has_cover_art"
		}
	}

	result := gin.H{
		"title":    metadata.Title(),
		"artist":   metadata.Artist(),
		"album":    metadata.Album(),
		"duration": duration,
		"coverArt": coverArtURL,
	}

	fmt.Printf("Extracted audio metadata: %+v\n", result)
	c.JSON(http.StatusOK, result)
}
