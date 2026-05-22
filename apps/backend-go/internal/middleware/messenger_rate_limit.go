package middleware

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// MessengerRateLimiter implements rate limiting for messenger operations
type MessengerRateLimiter struct {
	mu              sync.RWMutex
	userLimits      map[string]*userLimit
	cleanupInterval time.Duration
}

type userLimit struct {
	messages   []time.Time
	lastAccess time.Time
}

// NewMessengerRateLimiter creates a new rate limiter for messenger
func NewMessengerRateLimiter() *MessengerRateLimiter {
	limiter := &MessengerRateLimiter{
		userLimits:      make(map[string]*userLimit),
		cleanupInterval: 5 * time.Minute,
	}

	// Start cleanup goroutine
	go limiter.cleanup()

	return limiter
}

// AllowMessage checks if user can send a message
// Limits: 30 messages per minute, 100 messages per hour
func (l *MessengerRateLimiter) AllowMessage(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	limit, exists := l.userLimits[userID]
	if !exists {
		limit = &userLimit{
			messages:   []time.Time{now},
			lastAccess: now,
		}
		l.userLimits[userID] = limit
		return true
	}

	// Remove messages older than 1 hour
	oneHourAgo := now.Add(-1 * time.Hour)
	oneMinuteAgo := now.Add(-1 * time.Minute)

	var recentMessages []time.Time
	var lastMinuteCount int
	var lastHourCount int

	for _, msgTime := range limit.messages {
		if msgTime.After(oneHourAgo) {
			recentMessages = append(recentMessages, msgTime)
			lastHourCount++
			if msgTime.After(oneMinuteAgo) {
				lastMinuteCount++
			}
		}
	}

	// Check limits
	if lastMinuteCount >= 30 {
		return false // Too many messages in last minute
	}
	if lastHourCount >= 100 {
		return false // Too many messages in last hour
	}

	// Allow message
	recentMessages = append(recentMessages, now)
	limit.messages = recentMessages
	limit.lastAccess = now

	return true
}

// AllowConversationCreate checks if user can create a conversation
// Limit: 10 conversations per hour
func (l *MessengerRateLimiter) AllowConversationCreate(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	limit, exists := l.userLimits[userID]
	if !exists {
		limit = &userLimit{
			messages:   []time.Time{now},
			lastAccess: now,
		}
		l.userLimits[userID] = limit
		return true
	}

	// Count conversations created in last hour
	oneHourAgo := now.Add(-1 * time.Hour)
	var recentConversations []time.Time

	for _, msgTime := range limit.messages {
		if msgTime.After(oneHourAgo) {
			recentConversations = append(recentConversations, msgTime)
		}
	}

	// Check limit
	if len(recentConversations) >= 10 {
		return false
	}

	// Allow conversation
	recentConversations = append(recentConversations, now)
	limit.messages = recentConversations
	limit.lastAccess = now

	return true
}

// cleanup removes old entries periodically
func (l *MessengerRateLimiter) cleanup() {
	ticker := time.NewTicker(l.cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		l.mu.Lock()
		now := time.Now()
		cutoff := now.Add(-2 * time.Hour)

		for userID, limit := range l.userLimits {
			if limit.lastAccess.Before(cutoff) {
				delete(l.userLimits, userID)
			}
		}
		l.mu.Unlock()
	}
}

// MessengerRateLimitMiddleware creates middleware for rate limiting messenger operations
func MessengerRateLimitMiddleware(limiter *MessengerRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only apply to messenger endpoints
		path := c.Request.URL.Path
		if !isMessengerEndpoint(path) {
			c.Next()
			return
		}

		// Get user ID from claims
		claimsInterface, exists := c.Get("claims")
		if !exists {
			c.Next()
			return
		}

		claims, ok := claimsInterface.(interface{ GetUserID() string })
		if !ok {
			c.Next()
			return
		}

		userID := claims.GetUserID()
		if userID == "" {
			c.Next()
			return
		}

		// Check rate limit based on operation
		if c.Request.Method == "POST" {
			switch path {
			case "/rpc/v1/get_or_create_direct_chat":
				if !limiter.AllowConversationCreate(userID) {
					c.JSON(429, gin.H{"error": "Rate limit exceeded: too many conversations created. Please wait."})
					c.Abort()
					return
				}
			case "/rest/v1/chat_messages":
				if !limiter.AllowMessage(userID) {
					c.JSON(429, gin.H{"error": "Rate limit exceeded: too many messages sent. Please slow down."})
					c.Abort()
					return
				}
			}
		}

		c.Next()
	}
}

func isMessengerEndpoint(path string) bool {
	messengerPaths := []string{
		"/rest/v1/chat_messages",
		"/rest/v1/chat_conversations",
		"/rest/v1/chat_conversation_members",
		"/rest/v1/chat_receipts",
		"/rpc/v1/get_or_create_direct_chat",
		"/rpc/v1/chat_mark_delivered",
		"/rpc/v1/chat_mark_read",
	}

	for _, p := range messengerPaths {
		if path == p {
			return true
		}
	}
	return false
}
