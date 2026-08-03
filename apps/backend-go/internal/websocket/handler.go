package websocket

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

const (
	defaultPreAuthMaxConnections = 20
	defaultPreAuthWindow         = time.Minute
)

// PreAuthLimiter bounds WebSocket upgrades before the client has authenticated.
// It is keyed by the source IP and backed by Redis so the budget holds across
// all server instances (the previous in-memory window was per-process).
//
// Unlike the other Redis-backed limiters, this one fails CLOSED on Redis
// errors: it is the only anti-DoS control that runs before authentication, so
// an outage must not silently disable the upgrade throttle (legitimate clients
// can simply retry after the outage). A nil Redis client (tests, dev) still
// fails open.
type PreAuthLimiter struct {
	redis        *redis.Client
	maxAttempts  int
	windowLength time.Duration
}

func NewPreAuthLimiter(redisClient *redis.Client, maxAttempts int, windowLength time.Duration) *PreAuthLimiter {
	if maxAttempts <= 0 {
		maxAttempts = defaultPreAuthMaxConnections
	}
	if windowLength <= 0 {
		windowLength = defaultPreAuthWindow
	}
	return &PreAuthLimiter{
		redis:        redisClient,
		maxAttempts:  maxAttempts,
		windowLength: windowLength,
	}
}

// Allow admits one upgrade attempt and returns false after the per-IP budget
// is exhausted. Redis TTL expires the window automatically; no manual pruning
// is needed.
func (l *PreAuthLimiter) Allow(ip string) bool {
	if l == nil {
		return true // nil limiter: allow
	}
	if l.redis == nil {
		return true // Redis not configured (tests/dev): allow
	}
	ip = strings.TrimSpace(ip)
	if ip == "" {
		ip = "unknown"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	key := fmt.Sprintf("ratelimit:ws-pre:%s", ip)
	count, err := l.redis.Incr(ctx, key).Result()
	if err != nil {
		return false // fail CLOSED on Redis errors: do not disable the pre-auth throttle
	}
	if count == 1 {
		l.redis.Expire(ctx, key, l.windowLength)
	}

	return count <= int64(l.maxAttempts)
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
	// The default limiter is Redis-backed via the hub's client so the upgrade
	// budget is shared across instances.
	var redisClient *redis.Client
	if hub != nil {
		redisClient = hub.redis
	}
	limiter := NewPreAuthLimiter(redisClient, defaultPreAuthMaxConnections, defaultPreAuthWindow)
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
