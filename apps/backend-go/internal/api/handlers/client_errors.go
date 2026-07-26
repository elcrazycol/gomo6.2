package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ClientErrorRequest represents a client-side error report sent by the frontend.
type ClientErrorRequest struct {
	Type      string                 `json:"type" binding:"required"`
	Message   string                 `json:"message" binding:"required"`
	Stack     string                 `json:"stack"`
	URL       string                 `json:"url"`
	UserAgent string                 `json:"user_agent"`
	Metadata  map[string]interface{} `json:"metadata"`
}

// ClientErrorsHandler handles client-side JavaScript error reports.
type ClientErrorsHandler struct {
	db *sql.DB
}

// NewClientErrorsHandler creates a new ClientErrorsHandler.
func NewClientErrorsHandler(db *sql.DB) *ClientErrorsHandler {
	return &ClientErrorsHandler{db: db}
}

const (
	maxClientErrorMsgLen     = 4096
	maxClientErrorStackLen   = 16384
	maxClientErrorURLLen     = 4096
	maxClientErrorUALen      = 2048
	maxClientErrorMetadataKB = 8
)

// ReportClientError accepts a client error report and stores it in the database.
func (h *ClientErrorsHandler) ReportClientError(c *gin.Context) {
	var req ClientErrorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid error report: "+err.Error()))
		return
	}

	// Truncate long fields to avoid abuse / oversized rows.
	msg := req.Message
	if len(msg) > maxClientErrorMsgLen {
		msg = msg[:maxClientErrorMsgLen]
	}
	stack := req.Stack
	if len(stack) > maxClientErrorStackLen {
		stack = stack[:maxClientErrorStackLen]
	}
	ua := req.UserAgent
	if len(ua) > maxClientErrorUALen {
		ua = ua[:maxClientErrorUALen]
	}
	url := req.URL
	if len(url) > maxClientErrorURLLen {
		url = url[:maxClientErrorURLLen]
	}

	metadataJSON, _ := json.Marshal(req.Metadata)
	if len(metadataJSON) > maxClientErrorMetadataKB*1024 {
		metadataJSON, _ = json.Marshal(map[string]interface{}{
			"_error": "metadata truncated: exceeded size limit",
		})
	}

	// Best-effort: user ID may be present from optional auth middleware.
	var userID interface{}
	if claimsVal, ok := c.Get("claims"); ok {
		if claims, ok := claimsVal.(*auth.Claims); ok {
			userID = claims.UserID
		}
	}

	query := `
		INSERT INTO client_errors (type, message, stack, url, user_agent, user_id, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	if _, err := h.db.Exec(query, req.Type, msg, stack, url, ua, userID, metadataJSON); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to store error report"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}
