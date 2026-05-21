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

// InvalidateByPattern removes cache keys matching a pattern
func (i *Invalidator) InvalidateByPattern(pattern string) error {
	if i.redis == nil || pattern == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Find all keys matching pattern
	keys, err := i.redis.Keys(ctx, pattern).Result()
	if err != nil {
		log.Printf("[CacheInvalidator] Failed to get keys for pattern %s: %v", pattern, err)
		return err
	}

	if len(keys) > 0 {
		err = i.redis.Del(ctx, keys...).Err()
		if err != nil {
			log.Printf("[CacheInvalidator] Failed to delete keys for pattern %s: %v", pattern, err)
			return err
		}
		log.Printf("[CacheInvalidator] Deleted %d keys for pattern %s", len(keys), pattern)
	}

	return nil
}

// InvalidateForTable invalidates cache for a table based on primary key and foreign keys
func (i *Invalidator) InvalidateForTable(table string, values map[string]string) error {
	if i.redis == nil {
		return nil
	}

	keys := BuildCacheKeys(table, values)
	if len(keys) == 0 {
		return nil
	}

	return i.InvalidateKeys(keys...)
}

// InvalidateForPost invalidates cache for a post
func (i *Invalidator) InvalidateForPost(postID string, threadID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id":        postID,
		"post_id":   postID,
		"thread_id": threadID,
	}

	keys := BuildCacheKeys("posts", values)

	// Also invalidate the thread's post list
	if threadID != "" {
		threadKeys := BuildCacheKeys("threads", map[string]string{"id": threadID})
		keys = append(keys, threadKeys...)
	}

	return i.InvalidateKeys(keys...)
}

// InvalidateForThread invalidates cache for a thread
func (i *Invalidator) InvalidateForThread(threadID string, boardID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id":        threadID,
		"thread_id": threadID,
	}

	if boardID != "" {
		values["board_id"] = boardID
	}

	keys := BuildCacheKeys("threads", values)

	// Also invalidate posts in this thread
	postKeys := BuildCacheKeys("posts", map[string]string{"thread_id": threadID})
	keys = append(keys, postKeys...)

	// Invalidate board threads list
	if boardID != "" {
		boardKeys := BuildCacheKeys("boards", map[string]string{"id": boardID})
		keys = append(keys, boardKeys...)
	}

	return i.InvalidateKeys(keys...)
}

// InvalidateForBoard invalidates cache for a board
func (i *Invalidator) InvalidateForBoard(boardID string, slug string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id": boardID,
	}
	if slug != "" {
		values["slug"] = slug
	}

	keys := BuildCacheKeys("boards", values)
	return i.InvalidateKeys(keys...)
}

// InvalidateForProfile invalidates cache for a user profile
func (i *Invalidator) InvalidateForProfile(userID string, username string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id": userID,
	}
	if username != "" {
		values["username"] = username
	}

	keys := BuildCacheKeys("profiles", values)
	return i.InvalidateKeys(keys...)
}

// InvalidateForNotification invalidates cache for notifications
func (i *Invalidator) InvalidateForNotification(userID string) error {
	if i.redis == nil {
		return nil
	}

	keys := BuildCacheKeys("notifications", map[string]string{"user_id": userID})
	return i.InvalidateKeys(keys...)
}

// InvalidateForWallPost invalidates cache for profile wall posts
func (i *Invalidator) InvalidateForWallPost(postID string, userID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id":      postID,
		"post_id": postID,
	}
	if userID != "" {
		values["user_id"] = userID
	}

	keys := BuildCacheKeys("profile_wall_posts", values)
	return i.InvalidateKeys(keys...)
}

// InvalidateForWallComment invalidates cache for wall post comments
func (i *Invalidator) InvalidateForWallComment(commentID string, postID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id":      commentID,
		"post_id": postID,
	}

	keys := BuildCacheKeys("profile_wall_post_comments", values)

	// Also invalidate the wall post itself
	if postID != "" {
		wallPostKeys := BuildCacheKeys("profile_wall_posts", map[string]string{"id": postID, "post_id": postID})
		keys = append(keys, wallPostKeys...)
	}

	return i.InvalidateKeys(keys...)
}

// InvalidateForChatConversation invalidates cache for chat conversations
func (i *Invalidator) InvalidateForChatConversation(conversationID string, userID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id": conversationID,
	}
	if userID != "" {
		values["user_id"] = userID
	}

	keys := BuildCacheKeys("chat_conversations", values)

	// Also invalidate related tables
	memberKeys := BuildCacheKeys("chat_conversation_members", map[string]string{"conversation_id": conversationID})
	keys = append(keys, memberKeys...)

	messageKeys := BuildCacheKeys("chat_messages", map[string]string{"conversation_id": conversationID})
	keys = append(keys, messageKeys...)

	return i.InvalidateKeys(keys...)
}

// InvalidateForChatMessage invalidates cache for chat messages
func (i *Invalidator) InvalidateForChatMessage(messageID string, conversationID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"id":              messageID,
		"conversation_id": conversationID,
	}

	keys := BuildCacheKeys("chat_messages", values)

	// Also invalidate conversation cache
	if conversationID != "" {
		convKeys := BuildCacheKeys("chat_conversations", map[string]string{"id": conversationID})
		keys = append(keys, convKeys...)

		// Invalidate conversation members
		memberKeys := BuildCacheKeys("chat_conversation_members", map[string]string{"conversation_id": conversationID})
		keys = append(keys, memberKeys...)

		// Invalidate receipts
		receiptKeys := BuildCacheKeys("chat_receipts", map[string]string{"conversation_id": conversationID})
		keys = append(keys, receiptKeys...)
	}

	return i.InvalidateKeys(keys...)
}

// InvalidateForPostLike invalidates cache when a post is liked/unliked
func (i *Invalidator) InvalidateForPostLike(postID string, threadID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"post_id":   postID,
		"id":        postID,
		"thread_id": threadID,
	}

	keys := BuildCacheKeys("post_likes", values)

	// Also invalidate the post itself
	postKeys := BuildCacheKeys("posts", map[string]string{"id": postID, "thread_id": threadID})
	keys = append(keys, postKeys...)

	return i.InvalidateKeys(keys...)
}

// InvalidateForThreadLike invalidates cache when a thread is liked/unliked
func (i *Invalidator) InvalidateForThreadLike(threadID string, boardID string) error {
	if i.redis == nil {
		return nil
	}

	values := map[string]string{
		"thread_id": threadID,
		"id":        threadID,
	}
	if boardID != "" {
		values["board_id"] = boardID
	}

	keys := BuildCacheKeys("thread_likes", values)

	// Also invalidate the thread itself
	threadKeys := BuildCacheKeys("threads", map[string]string{"id": threadID})
	keys = append(keys, threadKeys...)

	return i.InvalidateKeys(keys...)
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

func InvalidateForBoard(redis *redis.Client, boardID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForBoard(boardID, ""); err != nil {
		log.Printf("[Cache] Error invalidating board cache: %v", err)
	}
}

func InvalidateForProfile(redis *redis.Client, userID string) {
	inv := NewInvalidator(redis)
	if err := inv.InvalidateForProfile(userID, ""); err != nil {
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
