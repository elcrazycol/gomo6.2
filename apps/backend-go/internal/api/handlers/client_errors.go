package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

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
// ReportClientError godoc
// @Summary      Report client error
// @Description  Store a client-side JavaScript error report (public, rate-limited)
// @Tags         Client Errors
// @Accept       json
// @Produce      json
// @Param        request body ClientErrorRequest true "Error report"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /client-errors [post]
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

const (
	// clientErrorRetentionDays is how long client error reports are kept.
	// Override with CLIENT_ERRORS_RETENTION_DAYS (positive integer).
	clientErrorRetentionDays = 90
	// clientErrorRetentionInterval is how often the retention loop runs.
	clientErrorRetentionInterval = 24 * time.Hour
	// clientErrorRetentionBatch bounds a single DELETE so a large backlog never
	// holds one long transaction; the loop repeats until the backlog is drained.
	clientErrorRetentionBatch = 5000
	// clientErrorRetentionMaxBatches caps how much work one run does.
	clientErrorRetentionMaxBatches = 100
)

// StartClientErrorRetention starts a low-frequency maintenance loop that deletes
// client error reports older than the retention window. client_errors is
// append-only and unbounded otherwise (unlike bot_logs, which is trimmed by a
// trigger). Runs once at startup, then daily; failures are logged and never
// affect request handling or server readiness.
func (h *ClientErrorsHandler) StartClientErrorRetention() {
	if h == nil || h.db == nil {
		return
	}
	go func() {
		h.cleanupOldClientErrors()
		ticker := time.NewTicker(clientErrorRetentionInterval)
		defer ticker.Stop()
		for range ticker.C {
			h.cleanupOldClientErrors()
		}
	}()
}

// clientErrorRetentionWindow resolves the retention window, honouring the
// optional CLIENT_ERRORS_RETENTION_DAYS override.
func clientErrorRetentionWindow() time.Duration {
	days := clientErrorRetentionDays
	if raw := os.Getenv("CLIENT_ERRORS_RETENTION_DAYS"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			days = n
		}
	}
	return time.Duration(days) * 24 * time.Hour
}

func (h *ClientErrorsHandler) cleanupOldClientErrors() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	cutoff := time.Now().UTC().Add(-clientErrorRetentionWindow())
	var total int64
	for i := 0; i < clientErrorRetentionMaxBatches; i++ {
		res, err := h.db.ExecContext(ctx, `
			DELETE FROM client_errors
			WHERE id IN (
				SELECT id FROM client_errors
				WHERE created_at < $1
				ORDER BY created_at
				LIMIT $2
			)`, cutoff, clientErrorRetentionBatch)
		if err != nil {
			log.Printf("client_errors retention: delete: %v", err)
			return
		}
		n, err := res.RowsAffected()
		if err != nil {
			log.Printf("client_errors retention: rows affected: %v", err)
			return
		}
		total += n
		if n < clientErrorRetentionBatch {
			break
		}
	}
	if total > 0 {
		log.Printf("client_errors retention: deleted %d rows older than %s", total, cutoff.Format(time.RFC3339))
	}
}
