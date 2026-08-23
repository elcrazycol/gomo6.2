package handlers

import (
	"errors"
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

// maxAudioMetadataBytes caps the size of an audio file accepted by the metadata
// endpoint. It mirrors the regular upload cap (maxUploadBytes in storage) so a
// file the user could not attach via /storage/v1/upload cannot be parsed here
// either. The request-body limit adds a small multipart overhead allowance on
// top.
const (
	maxAudioMetadataBytes = 50 * 1024 * 1024 // 50MB
	maxAudioMetadataBody  = maxAudioMetadataBytes + (1 << 20)
)

type AudioHandler struct{}

func NewAudioHandler() *AudioHandler {
	return &AudioHandler{}
}

// ExtractAudioMetadata extracts metadata from uploaded audio file
//
// ExtractAudioMetadata godoc
// @Summary      Extract audio metadata
// @Description  Extract metadata (title, artist, album) from an uploaded audio file
// @Tags         Audio
// @Accept       multipart/form-data
// @Produce      json
// @Param        audio formData file true "Audio file"
// @Success      200 {object} object
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      413 {object} models.APIResponse
// @Security     BearerAuth
// @Router       /audio/metadata [post]
func (h *AudioHandler) ExtractAudioMetadata(c *gin.Context) {
	// Bound the request body BEFORE parsing the multipart form: without this,
	// ParseMultipartForm spools arbitrarily large uploads to disk (/tmp) and
	// only the (too-late) size check below would reject them. MaxBytesReader
	// makes ParseMultipartForm fail as soon as the limit is crossed and the
	// standard library removes the already-spooled temp files on that error.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAudioMetadataBody)

	file, header, err := c.Request.FormFile("audio")
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, models.ErrorResponse("Audio file too large (max 50MB)"))
			return
		}
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Failed to get audio file"))
		return
	}
	defer file.Close()

	// Second line of defense: the parsed part size (multipart overhead means a
	// file can be slightly smaller than the body limit).
	if header.Size > maxAudioMetadataBytes {
		c.JSON(http.StatusRequestEntityTooLarge, models.ErrorResponse("Audio file too large (max 50MB)"))
		return
	}

	// Create temporary file
	tempFile, err := os.CreateTemp("", "audio-*.tmp")
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to create temp file"))
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Copy uploaded file to temp (bounded by the body limit above; the LimitReader
	// is a third line of defense should the guard in FormFile ever be bypassed).
	written, err := io.Copy(tempFile, io.LimitReader(file, maxAudioMetadataBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to save temp file"))
		return
	}
	if written > maxAudioMetadataBytes {
		c.JSON(http.StatusRequestEntityTooLarge, models.ErrorResponse("Audio file too large (max 50MB)"))
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
