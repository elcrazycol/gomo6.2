package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/redis/go-redis/v9"
)

// DefaultDataCacheTTL is the default TTL for data cache entries (2 minutes).
const DefaultDataCacheTTL = 2 * time.Minute

// cacheTTLByPath returns a differentiated TTL based on the request path:
// - 30s for threads/posts (frequently updated content)
// - 5min for boards/profiles (rarely changed)
// - 2min default for everything else
func cacheTTLByPath(path string, defaultTTL time.Duration) time.Duration {
	// Threads and posts: short TTL — content changes frequently
	if strings.Contains(path, "/threads") || strings.Contains(path, "/posts") {
		return 30 * time.Second
	}
	// Boards and profiles: medium TTL — rarely change but must reflect updates quickly
	if strings.Contains(path, "/boards") || strings.Contains(path, "/profiles") {
		return 30 * time.Second
	}
	return defaultTTL
}

func DataCacheMiddleware(redisClient *redis.Client, ttl time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only cache GET requests
		if c.Request.Method != "GET" {
			c.Next()
			return
		}

		// Skip if Redis is not available
		if redisClient == nil {
			c.Next()
			return
		}

		// Skip caching for achievements endpoints — they must be real-time
		if strings.Contains(c.Request.URL.Path, "achievements") {
			c.Next()
			return
		}

		// Skip caching for messenger endpoints — they must be real-time
		// Caching causes multi-minute delays in message delivery and conversation updates
		if strings.Contains(c.Request.URL.Path, "messenger") {
			c.Next()
			return
		}

		// Skip caching for drops endpoints — must reflect immediate balance changes and be per-user
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/v1/drops/wallet") ||
			strings.HasPrefix(path, "/api/v1/drops/history") ||
			strings.HasPrefix(path, "/api/v1/drops/users/search") ||
			strings.HasPrefix(path, "/api/v1/user/drops") {
			c.Next()
			return
		}

		// Determine TTL based on path (threads/posts=30s, boards/profiles=5min)
		effectiveTTL := cacheTTLByPath(c.Request.URL.Path, ttl)

		// Build cache key from path and query params
		cacheKey := fmt.Sprintf("data:%s?%s", c.Request.URL.Path, c.Request.URL.RawQuery)

		// Try to get cached response
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()

		cachedData, err := redisClient.Get(ctx, cacheKey).Result()
		if err == nil && cachedData != "" {
			// Cache hit - return cached response
			var response map[string]interface{}
			if err := json.Unmarshal([]byte(cachedData), &response); err == nil {
				c.Header("X-Cache", "HIT")
				c.JSON(200, response)
				c.Abort()
				return
			}
		}

		// Cache miss - continue to handler
		c.Header("X-Cache", "MISS")

		// Store cache key in context for potential invalidation later
		c.Set("cache_key", cacheKey)

		// Capture response
		writer := &responseWriter{
			ResponseWriter: c.Writer,
			body:           []byte{},
		}
		c.Writer = writer

		c.Next()

		// Cache successful responses in background
		// Don't cache empty arrays or very small responses (likely empty results)
		if c.Writer.Status() == 200 && len(writer.body) > 10 {
			// Check if response is an empty array []
			bodyStr := string(writer.body)
			if bodyStr != "[]" && bodyStr != "{\"data\":[]}" {
				go func() {
					ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
					defer cancel()

					err := redisClient.Set(ctx, cacheKey, writer.body, effectiveTTL).Err()
					if err != nil {
						log.Printf("[DataCache] Failed to cache response: %v", err)
					}
				}()
			}
		}
	}
}

// responseWriter captures response body for caching
type responseWriter struct {
	gin.ResponseWriter
	body []byte
}

func (w *responseWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return w.ResponseWriter.Write(b)
}

// InvalidateCache removes cached data by pattern
func InvalidateCache(redisClient *redis.Client, pattern string) error {
	cache.InvalidateByPattern(redisClient, pattern)
	return nil
}

// InvalidateCacheForThread invalidates all cache entries related to a thread
func InvalidateCacheForThread(redisClient *redis.Client, threadID string) {
	// Use wildcard patterns to invalidate ALL queries for this thread
	patterns := []string{
		fmt.Sprintf("data:/api/v1/posts*thread_id=eq.%s*", threadID),
		fmt.Sprintf("data:/api/v1/threads*%s*", threadID),
		"data:/api/v1/posts*",
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForProfile invalidates all cache entries related to a profile
func InvalidateCacheForProfile(redisClient *redis.Client, userID string) {
	// Use wildcard patterns to invalidate ALL queries for this profile
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profiles*%s*", userID),
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForBoard invalidates all cache entries related to a board
func InvalidateCacheForBoard(redisClient *redis.Client, boardID string) {
	// Use wildcard patterns scoped to this specific board
	patterns := []string{
		fmt.Sprintf("data:/api/v1/threads*board_id=eq.%s*", boardID),
		fmt.Sprintf("data:/api/v1/boards*id=eq.%s*", boardID),
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForProfileWall invalidates all cache entries related to a user's profile wall
func InvalidateCacheForProfileWall(redisClient *redis.Client, userID string) {
	// Use wildcard patterns scoped to this specific user only (NOT global)
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profile_wall_posts*user_id=eq.%s*", userID),
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForWallPost invalidates cache for a specific wall post and its comments, likes, reposts
func InvalidateCacheForWallPost(redisClient *redis.Client, postID string) {
	cache.InvalidateForWallPost(redisClient, postID, "")
}

// InvalidateCacheForPost invalidates cache for a specific post
func InvalidateCacheForPost(redisClient *redis.Client, postID string, threadID string) {
	// Use wildcard patterns to invalidate ALL queries for this post and its thread
	patterns := []string{
		fmt.Sprintf("data:/api/v1/posts*%s*", postID),
	}
	if threadID != "" {
		patterns = append(patterns, fmt.Sprintf("data:/api/v1/posts*thread_id=eq.%s*", threadID))
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForPostLike invalidates cache when a post is liked/unliked
func InvalidateCacheForPostLike(redisClient *redis.Client, postID string, threadID string) {
	// Invalidate the post itself (likes affect post data)
	InvalidateCacheForPost(redisClient, postID, threadID)
}

// InvalidateCacheForThreadLike invalidates cache when a thread is liked/unliked
func InvalidateCacheForThreadLike(redisClient *redis.Client, threadID string, boardID string) {
	// Invalidate the thread itself (likes affect thread data)
	InvalidateCacheForThread(redisClient, threadID)
}

// InvalidateCacheForNotification invalidates notification cache for a user
func InvalidateCacheForNotification(redisClient *redis.Client, userID string) {
	// Use wildcard to invalidate ALL notification queries for this user
	patterns := []string{
		fmt.Sprintf("data:/api/v1/notifications*user_id=eq.%s*", userID),
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForChatMessage invalidates chat message cache
func InvalidateCacheForChatMessage(redisClient *redis.Client, messageID string, conversationID string) {
	// Use wildcard to invalidate ALL chat message queries
	patterns := []string{
		fmt.Sprintf("data:/api/v1/chat_messages*conversation_id=eq.%s*", conversationID),
		"data:/api/v1/chat_messages*",
		"data:/api/v1/chat_conversations*",
		"data:/api/v1/chat_receipts*",
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForChatConversation invalidates chat conversation cache
func InvalidateCacheForChatConversation(redisClient *redis.Client, conversationID string, userID string) {
	// Use wildcard to invalidate ALL chat conversation queries
	patterns := []string{
		fmt.Sprintf("data:/api/v1/chat_conversations*%s*", conversationID),
		"data:/api/v1/chat_conversation_members*",
		"data:/api/v1/chat_messages*",
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}

// InvalidateCacheForWallComment invalidates wall comment cache
func InvalidateCacheForWallComment(redisClient *redis.Client, commentID string, postID string) {
	// Use wildcard to invalidate ALL wall comment queries for this post
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profile_wall_post_comments*post_id=eq.%s*", postID),
		"data:/api/v1/profile_wall_post_comments*",
		fmt.Sprintf("data:/api/v1/profile_wall_posts*%s*", postID),
	}
	for _, pattern := range patterns {
		cache.InvalidateByPattern(redisClient, pattern)
	}
}
