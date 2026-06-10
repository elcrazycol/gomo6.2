package websocket

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// Handler handles WebSocket HTTP requests
type Handler struct {
	hub         *Hub
	authService *auth.AuthService
}

// NewHandler creates a new WebSocket handler
func NewHandler(hub *Hub, authService *auth.AuthService) *Handler {
	return &Handler{
		hub:         hub,
		authService: authService,
	}
}

// HandleWebSocket handles WebSocket upgrade requests.
// Authentication happens via the first message (type: "auth"), not the URL.
// This prevents tokens from leaking into server logs and proxy logs.
func (h *Handler) HandleWebSocket(c *gin.Context) {
	log.Printf("[WebSocket] HandleWebSocket called from %s", c.ClientIP())

	// Upgrade HTTP connection to WebSocket — no pre-auth required.
	// The client must send an {"type":"auth","data":{"token":"..."}} message
	// within 5 seconds or the connection will be closed.
	ServeWs(h.hub, c.Writer, c.Request, h.authService)
}

// GetOnlineUsers returns the count of online users (for admin/debug purposes)
func (h *Handler) GetOnlineUsers(c *gin.Context) {
	users := h.hub.GetOnlineUsers()
	c.JSON(http.StatusOK, gin.H{
		"count": len(users),
		"users": users,
	})
}
