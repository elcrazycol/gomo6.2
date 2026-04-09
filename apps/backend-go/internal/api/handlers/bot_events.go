package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/redis/go-redis/v9"
)

// BotEventPublisher handles publishing events to bots via Redis
type BotEventPublisher struct {
	redis *redis.Client
	db    *sql.DB
}

// NewBotEventPublisher creates a new bot event publisher
func NewBotEventPublisher(redis *redis.Client) *BotEventPublisher {
	return &BotEventPublisher{
		redis: redis,
	}
}

// SetDB sets the database connection for decrypting messages
func (p *BotEventPublisher) SetDB(db *sql.DB) {
	p.db = db
}

// PublishWallPost publishes a wall post event to bots
func (p *BotEventPublisher) PublishWallPost(post map[string]interface{}) {
	if p.redis == nil {
		return
	}

	event := map[string]interface{}{
		"type": "wall_post",
		"data": post,
	}

	p.publish(event)
}

// PublishWallComment publishes a wall comment event to bots
func (p *BotEventPublisher) PublishWallComment(comment map[string]interface{}) {
	if p.redis == nil {
		return
	}

	event := map[string]interface{}{
		"type": "wall_comment",
		"data": comment,
	}

	p.publish(event)
}

// PublishThread publishes a thread creation event to bots
func (p *BotEventPublisher) PublishThread(thread map[string]interface{}) {
	if p.redis == nil {
		return
	}

	event := map[string]interface{}{
		"type": "thread",
		"data": thread,
	}

	p.publish(event)
}

// PublishThreadPost publishes a thread post event to bots
func (p *BotEventPublisher) PublishThreadPost(post map[string]interface{}) {
	if p.redis == nil {
		return
	}

	event := map[string]interface{}{
		"type": "thread_post",
		"data": post,
	}

	p.publish(event)
}

// PublishChatMessage publishes a chat message event to bots
func (p *BotEventPublisher) PublishChatMessage(message map[string]interface{}) {
	if p.redis == nil {
		return
	}

	// Extract plaintext from BOT_PLAINTEXT: prefix if present
	var plaintext string
	if ciphertext, ok := message["ciphertext"].(string); ok {
		if strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:") {
			plaintext = strings.TrimPrefix(ciphertext, "BOT_PLAINTEXT:")
			// Add plaintext to message data for bots
			message["plaintext"] = plaintext
			log.Printf("[BotEvents] Extracted plaintext for bot: %s", plaintext)
		}
	}

	event := map[string]interface{}{
		"type": "chat_message",
		"data": message,
	}

	p.publish(event)
}

// publish sends an event to the bot:events Redis channel
func (p *BotEventPublisher) publish(event map[string]interface{}) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("[BotEvents] Failed to marshal bot event: %v", err)
		return
	}

	ctx := context.Background()
	if err := p.redis.Publish(ctx, "bot:events", data).Err(); err != nil {
		log.Printf("[BotEvents] Failed to publish bot event: %v", err)
	} else {
		log.Printf("[BotEvents] Published event type=%s to bot:events channel", event["type"])
	}
}
