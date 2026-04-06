package websocket

import (
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

// HandleWebSocket handles WebSocket upgrade requests
func (h *Handler) HandleWebSocket(c *gin.Context) {
	// Extract user from context (set by auth middleware)
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	
	userClaims, ok := claims.(*auth.Claims)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authentication"})
		return
	}
	
	// Get username from claims or use userID as fallback
	username := userClaims.Username
	if username == "" {
		username = userClaims.UserID[:8] // Use first 8 chars of ID as fallback
	}
	
	// Upgrade HTTP connection to WebSocket
	ServeWs(h.hub, c.Writer, c.Request, userClaims.UserID, username)
}

// GetOnlineUsers returns the count of online users (for admin/debug purposes)
func (h *Handler) GetOnlineUsers(c *gin.Context) {
	users := h.hub.GetOnlineUsers()
	c.JSON(http.StatusOK, gin.H{
		"count": len(users),
		"users": users,
	})
}
