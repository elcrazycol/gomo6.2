package cache

import (
	"context"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// Invalidator handles cache invalidation
type Invalidator struct {
	redis *redis.Client
}

// NewInvalidator creates a new cache invalidator
func NewInvalidator(redis *redis.Client) *Invalidator {
	return &Invalidator{redis: redis}
}

// InvalidateKeys removes specific cache keys from Redis
func (i *Invalidator) InvalidateKeys(keys ...string) error {
	if i.redis == nil || len(keys) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Filter out empty keys
	var validKeys []string
	for _, key := range keys {
		if key != "" {
			validKeys = append(validKeys, key)
		}
	}

	if len(validKeys) == 0 {
		log.Printf("[CacheInvalidator] No valid keys to delete")
		return nil
	}

	log.Printf("[CacheInvalidator] Attempting to delete keys: %v", validKeys)

	err := i.redis.Del(ctx, validKeys...).Err()
	if err != nil {
		log.Printf("[CacheInvalidator] Failed to delete keys: %v", err)
		return err
	}

	log.Printf("[CacheInvalidator] Successfully deleted %d keys: %v", len(validKeys), validKeys)
	return nil
}

// InvalidateByPattern removes cache keys matching a pattern using SCAN (non-blocking)
func (i *Invalidator) InvalidateByPattern(pattern string) error {
	if i.redis == nil || pattern == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var cursor uint64
	var totalDeleted int64

	for {
		keys, nextCursor, err := i.redis.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			log.Printf("[CacheInvalidator] Failed to scan keys for pattern %s: %v", pattern, err)
			return err
		}

		if len(keys) > 0 {
			if err := i.redis.Del(ctx, keys...).Err(); err != nil {
				log.Printf("[CacheInvalidator] Failed to delete keys for pattern %s: %v", pattern, err)
				return err
			}
			totalDeleted += int64(len(keys))
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	if totalDeleted > 0 {
		log.Printf("[CacheInvalidator] Deleted %d keys for pattern %s", totalDeleted, pattern)
	}

	return nil
}

// InvalidateForTable invalidates cache for a table using pattern-based invalidation
// Uses wildcard patterns to match real cache keys that include extra query params (select, order, limit, etc.)
func (i *Invalidator) InvalidateForTable(table string, values map[string]string) error {
	if i.redis == nil {
		return nil
	}

	patterns := BuildCachePatterns(table, values)
	if len(patterns) == 0 {
		return nil
	}

	for _, pattern := range patterns {
		if err := i.InvalidateByPattern(pattern); err != nil {
			return err
		}
	}

	return nil
}

// InvalidateForPost invalidates cache for a post and its thread's post list
func (i *Invalidator) InvalidateForPost(postID string, threadID string) error {
	if err := i.InvalidateForTable("posts", map[string]string{
		"id": postID, "post_id": postID, "thread_id": threadID,
	}); err != nil {
		return err
	}
	// Also invalidate the thread's post list
	if threadID != "" {
		return i.InvalidateForTable("threads", map[string]string{"id": threadID})
	}
	return nil
}

// InvalidateForThread invalidates cache for a thread, its posts, and its board
func (i *Invalidator) InvalidateForThread(threadID string, boardID string) error {
	values := map[string]string{"id": threadID, "thread_id": threadID}
	if boardID != "" {
		values["board_id"] = boardID
	}
	if err := i.InvalidateForTable("threads", values); err != nil {
		return err
	}
	// Also invalidate posts in this thread
	if err := i.InvalidateForTable("posts", map[string]string{"thread_id": threadID}); err != nil {
		return err
	}
	// Invalidate board threads list
	if boardID != "" {
		return i.InvalidateForTable("boards", map[string]string{"id": boardID})
	}
	return nil
}

// InvalidateForBoard invalidates cache for a board
func (i *Invalidator) InvalidateForBoard(boardID string, slug string) error {
	if i.redis == nil {
		return nil
	}

	return i.InvalidateForTable("boards", map[string]string{
		"id":   boardID,
		"slug": slug,
	})
}

// InvalidateForProfile invalidates cache for a user profile
func (i *Invalidator) InvalidateForProfile(userID string, username string) error {
	if i.redis == nil {
		return nil
	}

	return i.InvalidateForTable("profiles", map[string]string{
		"id":       userID,
		"username": username,
	})
}

// InvalidateForNotification invalidates cache for notifications
func (i *Invalidator) InvalidateForNotification(userID string) error {
	return i.InvalidateForTable("notifications", map[string]string{"user_id": userID})
}

// InvalidateForWallPost invalidates cache for profile wall posts
func (i *Invalidator) InvalidateForWallPost(postID string, userID string) error {
	values := map[string]string{"id": postID, "post_id": postID}
	if userID != "" {
		values["user_id"] = userID
	}
	return i.InvalidateForTable("profile_wall_posts", values)
}

// InvalidateForWallComment invalidates cache for wall post comments and the wall post itself
func (i *Invalidator) InvalidateForWallComment(commentID string, postID string) error {
	if err := i.InvalidateForTable("profile_wall_post_comments", map[string]string{
		"id": commentID, "post_id": postID,
	}); err != nil {
		return err
	}
	// Also invalidate the wall post itself
	if postID != "" {
		return i.InvalidateForTable("profile_wall_posts", map[string]string{"id": postID, "post_id": postID})
	}
	return nil
}

// InvalidateForChatConversation invalidates cache for chat conversations, members, and messages
func (i *Invalidator) InvalidateForChatConversation(conversationID string, userID string) error {
	values := map[string]string{"id": conversationID}
	if userID != "" {
		values["user_id"] = userID
	}
	if err := i.InvalidateForTable("chat_conversations", values); err != nil {
		return err
	}
	// Also invalidate related tables
	if err := i.InvalidateForTable("chat_conversation_members", map[string]string{"conversation_id": conversationID}); err != nil {
		return err
	}
	return i.InvalidateForTable("chat_messages", map[string]string{"conversation_id": conversationID})
}

// InvalidateForChatMessage invalidates cache for chat messages, conversations, members, and receipts
func (i *Invalidator) InvalidateForChatMessage(messageID string, conversationID string) error {
	if err := i.InvalidateForTable("chat_messages", map[string]string{
		"id": messageID, "conversation_id": conversationID,
	}); err != nil {
		return err
	}
	// Also invalidate conversation cache
	if conversationID != "" {
		if err := i.InvalidateForTable("chat_conversations", map[string]string{"id": conversationID}); err != nil {
			return err
		}
		if err := i.InvalidateForTable("chat_conversation_members", map[string]string{"conversation_id": conversationID}); err != nil {
			return err
		}
		return i.InvalidateForTable("chat_receipts", map[string]string{"conversation_id": conversationID})
	}
	return nil
}

// InvalidateForPostLike invalidates cache when a post is liked/unliked
func (i *Invalidator) InvalidateForPostLike(postID string, threadID string) error {
	if err := i.InvalidateForTable("post_likes", map[string]string{
		"post_id": postID, "id": postID, "thread_id": threadID,
	}); err != nil {
		return err
	}
	// Also invalidate the post itself
	return i.InvalidateForTable("posts", map[string]string{"id": postID, "thread_id": threadID})
}

// InvalidateForThreadLike invalidates cache when a thread is liked/unliked
func (i *Invalidator) InvalidateForThreadLike(threadID string, boardID string) error {
	values := map[string]string{"thread_id": threadID, "id": threadID}
	if boardID != "" {
		values["board_id"] = boardID
	}
	if err := i.InvalidateForTable("thread_likes", values); err != nil {
		return err
	}
	// Also invalidate the thread itself
	return i.InvalidateForTable("threads", map[string]string{"id": threadID})
}

// Global invalidator instance for convenience
var globalInvalidator *Invalidator

// SetGlobalInvalidator sets the global invalidator instance
func SetGlobalInvalidator(redis *redis.Client) {
	globalInvalidator = NewInvalidator(redis)
}

// GetGlobalInvalidator returns the global invalidator instance
func GetGlobalInvalidator() *Invalidator {
	return globalInvalidator
}

// Convenience functions using global invalidator

func InvalidateForPost(redis *redis.Client, postID string, threadID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForPost(postID, threadID); err != nil {
		log.Printf("[Cache] Error invalidating post cache: %v", err)
	}
}

func InvalidateForThread(redis *redis.Client, threadID string, boardID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForThread(threadID, boardID); err != nil {
		log.Printf("[Cache] Error invalidating thread cache: %v", err)
	}
}

func InvalidateForBoard(redis *redis.Client, boardID string, slug string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForBoard(boardID, slug); err != nil {
		log.Printf("[Cache] Error invalidating board cache: %v", err)
	}
}

func InvalidateForProfile(redis *redis.Client, userID string, username string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForProfile(userID, username); err != nil {
		log.Printf("[Cache] Error invalidating profile cache: %v", err)
	}
}

func InvalidateForNotification(redis *redis.Client, userID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForNotification(userID); err != nil {
		log.Printf("[Cache] Error invalidating notification cache: %v", err)
	}
}

func InvalidateForWallPost(redis *redis.Client, postID string, userID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForWallPost(postID, userID); err != nil {
		log.Printf("[Cache] Error invalidating wall post cache: %v", err)
	}
}

func InvalidateForWallComment(redis *redis.Client, commentID string, postID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForWallComment(commentID, postID); err != nil {
		log.Printf("[Cache] Error invalidating wall comment cache: %v", err)
	}
}

func InvalidateForChatMessage(redis *redis.Client, messageID string, conversationID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForChatMessage(messageID, conversationID); err != nil {
		log.Printf("[Cache] Error invalidating chat message cache: %v", err)
	}
}

func InvalidateForChatConversation(redis *redis.Client, conversationID string, userID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForChatConversation(conversationID, userID); err != nil {
		log.Printf("[Cache] Error invalidating chat conversation cache: %v", err)
	}
}

func InvalidateForPostLike(redis *redis.Client, postID string, threadID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForPostLike(postID, threadID); err != nil {
		log.Printf("[Cache] Error invalidating post like cache: %v", err)
	}
}

func InvalidateForThreadLike(redis *redis.Client, threadID string, boardID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForThreadLike(threadID, boardID); err != nil {
		log.Printf("[Cache] Error invalidating thread like cache: %v", err)
	}
}

func InvalidateForTable(redis *redis.Client, table string, values map[string]string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForTable(table, values); err != nil {
		log.Printf("[Cache] Error invalidating table %s cache: %v", table, err)
	}
}

func InvalidateKeys(redis *redis.Client, keys ...string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateKeys(keys...); err != nil {
		log.Printf("[Cache] Error invalidating keys: %v", err)
	}
}

func InvalidateByPattern(redis *redis.Client, pattern string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateByPattern(pattern); err != nil {
		log.Printf("[Cache] Error invalidating pattern %s: %v", pattern, err)
	}
}
