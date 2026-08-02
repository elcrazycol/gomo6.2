package websocket

import (
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

const (
	defaultPreAuthMaxConnections = 20
	defaultPreAuthWindow         = time.Minute
)

type preAuthWindow struct {
	started time.Time
	count   int
}

// PreAuthLimiter bounds WebSocket upgrades before the client has authenticated.
// It is deliberately keyed by the source IP and fails closed when exhausted.
type PreAuthLimiter struct {
	mu           sync.Mutex
	windows      map[string]preAuthWindow
	maxAttempts  int
	windowLength time.Duration
}

func NewPreAuthLimiter(maxAttempts int, windowLength time.Duration) *PreAuthLimiter {
	if maxAttempts <= 0 {
		maxAttempts = defaultPreAuthMaxConnections
	}
	if windowLength <= 0 {
		windowLength = defaultPreAuthWindow
	}
	return &PreAuthLimiter{
		windows:      make(map[string]preAuthWindow),
		maxAttempts:  maxAttempts,
		windowLength: windowLength,
	}
}

// Allow admits one upgrade attempt and returns false after the per-IP budget
// is exhausted. Old entries are pruned opportunistically to keep memory bound.
func (l *PreAuthLimiter) Allow(ip string) bool {
	if l == nil {
		return true
	}
	ip = strings.TrimSpace(ip)
	if ip == "" {
		ip = "unknown"
	}

	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	for key, entry := range l.windows {
		if now.Sub(entry.started) >= 2*l.windowLength {
			delete(l.windows, key)
		}
	}

	entry, ok := l.windows[ip]
	if !ok || now.Sub(entry.started) >= l.windowLength {
		l.windows[ip] = preAuthWindow{started: now, count: 1}
		return true
	}
	if entry.count >= l.maxAttempts {
		return false
	}
	entry.count++
	l.windows[ip] = entry
	return true
}

// Handler handles WebSocket HTTP requests
type Handler struct {
	hub            *Hub
	authService    *auth.AuthService
	preAuthLimiter *PreAuthLimiter
}

// NewHandler creates a new WebSocket handler. The optional limiter is useful
// for tests and deployment-specific limits; production uses the safe default.
func NewHandler(hub *Hub, authService *auth.AuthService, limiters ...*PreAuthLimiter) *Handler {
	limiter := NewPreAuthLimiter(defaultPreAuthMaxConnections, defaultPreAuthWindow)
	if len(limiters) > 0 && limiters[0] != nil {
		limiter = limiters[0]
	}
	return &Handler{
		hub:            hub,
		authService:    authService,
		preAuthLimiter: limiter,
	}
}

// HandleWebSocket handles WebSocket upgrade requests.
// Authentication happens via the first message (type: "auth"), not the URL.
// This prevents tokens from leaking into server logs and proxy logs.
func (h *Handler) HandleWebSocket(c *gin.Context) {
	if h.preAuthLimiter != nil && !h.preAuthLimiter.Allow(c.ClientIP()) {
		c.AbortWithStatus(http.StatusTooManyRequests)
		return
	}

	log.Printf("[WebSocket] HandleWebSocket called from %s", c.ClientIP())

	// Upgrade HTTP connection — authentication is required in the first
	// WebSocket frame or from the HttpOnly access cookie.
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
