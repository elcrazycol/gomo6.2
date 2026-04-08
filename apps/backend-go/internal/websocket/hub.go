package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// Message types
	MessageTypeNewPost        = "new_post"
	MessageTypeNewThread      = "new_thread"
	MessageTypeNewReply       = "new_reply"
	MessageTypeLike           = "like"
	MessageTypeUnlike         = "unlike"
	MessageTypeTyping         = "typing"
	MessageTypePresence       = "presence"
	MessageTypeSubscribe      = "subscribe"
	MessageTypeUnsubscribe    = "unsubscribe"
	MessageTypePing           = "ping"
	MessageTypeNewWallPost    = "new_wall_post"
	MessageTypeUpdateWallPost = "update_wall_post"
	MessageTypeDeleteWallPost = "delete_wall_post"
	MessageTypeNewChatMessage = "new_chat_message"

	// Redis channels
	RedisChannelPosts   = "realtime:posts"
	RedisChannelThreads = "realtime:threads"
	RedisChannelLikes   = "realtime:likes"
	RedisChannelWall    = "realtime:wall"
	RedisChannelChat    = "realtime:chat"
)

// Message represents a WebSocket message
type Message struct {
	Type      string          `json:"type"`
	Room      string          `json:"room,omitempty"`
	Data      json.RawMessage `json:"data"`
	UserID    string          `json:"user_id,omitempty"`
	Username  string          `json:"username,omitempty"`
	Timestamp int64           `json:"timestamp"`
}

// RealtimeEvent represents an event published to Redis
type RealtimeEvent struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// Hub maintains the set of active clients and broadcasts messages
type Hub struct {
	clients        map[*Client]bool
	broadcast      chan []byte
	register       chan *Client
	unregister     chan *Client
	rooms          map[string]map[*Client]bool
	presence       map[string]*Client
	mu             sync.RWMutex
	redis          *redis.Client
	ctx            context.Context
	cancel         context.CancelFunc
	allowedOrigins []string
	rateLimiter    *RateLimiter
}

// NewHub creates a new Hub with Redis integration
func NewHub(redisClient *redis.Client, allowedOrigins []string) *Hub {
	ctx, cancel := context.WithCancel(context.Background())
	if allowedOrigins == nil {
		allowedOrigins = []string{"http://localhost:5173", "http://localhost:8080"}
	}
	return &Hub{
		clients:        make(map[*Client]bool),
		broadcast:      make(chan []byte),
		register:       make(chan *Client),
		unregister:     make(chan *Client),
		rooms:          make(map[string]map[*Client]bool),
		presence:       make(map[string]*Client),
		redis:          redisClient,
		ctx:            ctx,
		cancel:         cancel,
		allowedOrigins: allowedOrigins,
		rateLimiter:    NewRateLimiter(60, time.Minute), // 60 messages per minute
	}
}

// Run starts the Hub and begins listening for Redis messages
func (h *Hub) Run() {
	// Start Redis subscriber in a separate goroutine
	go h.subscribeToRedis()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.presence[client.UserID] = client
			h.mu.Unlock()
			log.Printf("[WebSocket] Client connected: %s (%s)", client.Username, client.UserID)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				delete(h.presence, client.UserID)

				// Remove from all rooms
				for room, roomClients := range h.rooms {
					if _, ok := roomClients[client]; ok {
						delete(roomClients, client)
						// Clean up empty rooms
						if len(roomClients) == 0 {
							delete(h.rooms, room)
						}
					}
				}

				close(client.Send)
				log.Printf("[WebSocket] Client disconnected: %s (%s)", client.Username, client.UserID)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.Send <- message:
				default:
					// Client's send channel is full, close and remove
					close(client.Send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Stop gracefully shuts down the Hub
func (h *Hub) Stop() {
	h.cancel()
	h.mu.Lock()
	defer h.mu.Unlock()

	for client := range h.clients {
		close(client.Send)
		client.Conn.Close()
	}
}

// subscribeToRedis listens for messages from Redis Pub/Sub
func (h *Hub) subscribeToRedis() {
	if h.redis == nil {
		log.Println("[WebSocket] Redis not available, skipping Redis subscription")
		return
	}

	pubsub := h.redis.Subscribe(h.ctx, RedisChannelPosts, RedisChannelThreads, RedisChannelLikes, RedisChannelWall, RedisChannelChat)
	defer pubsub.Close()

	log.Println("[WebSocket] Subscribed to Redis channels:", RedisChannelPosts, RedisChannelThreads, RedisChannelLikes, RedisChannelWall, RedisChannelChat)

	ch := pubsub.Channel()

	for {
		select {
		case <-h.ctx.Done():
			log.Println("[WebSocket] Redis subscriber shutting down")
			return

		case msg := <-ch:
			if msg == nil {
				continue
			}

			var event RealtimeEvent
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Printf("[WebSocket] Error unmarshaling Redis message: %v", err)
				continue
			}

			h.handleRedisEvent(event)
		}
	}
}

// handleRedisEvent processes events from Redis and broadcasts to clients
func (h *Hub) handleRedisEvent(event RealtimeEvent) {
	data, err := json.Marshal(event.Payload)
	if err != nil {
		log.Printf("[WebSocket] Error marshaling event payload: %v", err)
		return
	}

	message := Message{
		Type:      event.Type,
		Data:      data,
		Timestamp: time.Now().Unix(),
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("[WebSocket] Error marshaling message: %v", err)
		return
	}

	// Determine which room to broadcast to based on event type
	switch event.Type {
	case MessageTypeNewPost, MessageTypeNewReply:
		// Extract thread_id from payload for room-based broadcasting
		if roomID := extractRoomID(event.Payload, "thread_id"); roomID != "" {
			h.BroadcastToRoom(roomID, messageBytes)
		}
		// Also broadcast to global feed room
		h.BroadcastToRoom("feed", messageBytes)

	case MessageTypeNewThread:
		// Broadcast to global feed room
		h.BroadcastToRoom("feed", messageBytes)

	case MessageTypeLike, MessageTypeUnlike:
		// Broadcast to relevant thread room
		if roomID := extractRoomID(event.Payload, "thread_id"); roomID != "" {
			h.BroadcastToRoom(roomID, messageBytes)
		}

	case MessageTypeNewWallPost, MessageTypeUpdateWallPost, MessageTypeDeleteWallPost:
		// Extract user_id from payload for profile wall broadcasting
		if userID := extractRoomID(event.Payload, "user_id"); userID != "" {
			wallRoom := fmt.Sprintf("profile_wall_%s", userID)
			h.BroadcastToRoom(wallRoom, messageBytes)
		}

	case MessageTypeNewChatMessage:
		// Extract conversation_id from payload for chat broadcasting
		if conversationID := extractRoomID(event.Payload, "conversation_id"); conversationID != "" {
			chatRoom := fmt.Sprintf("chat_%s", conversationID)
			h.BroadcastToRoom(chatRoom, messageBytes)
		}

	default:
		// Broadcast to all clients for unknown types
		h.broadcast <- messageBytes
	}
}

// extractRoomID extracts a room ID from event payload
func extractRoomID(payload interface{}, key string) string {
	if payloadMap, ok := payload.(map[string]interface{}); ok {
		if roomID, ok := payloadMap[key].(string); ok {
			return roomID
		}
	}
	return ""
}

// SubscribeToRoom adds a client to a room
func (h *Hub) SubscribeToRoom(client *Client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.rooms[room] == nil {
		h.rooms[room] = make(map[*Client]bool)
	}
	h.rooms[room][client] = true
	client.Rooms[room] = true

	log.Printf("[WebSocket] Client %s subscribed to room %s", client.Username, room)
}

// UnsubscribeFromRoom removes a client from a room
func (h *Hub) UnsubscribeFromRoom(client *Client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if roomClients, ok := h.rooms[room]; ok {
		delete(roomClients, client)
		delete(client.Rooms, room)

		// Clean up empty rooms
		if len(roomClients) == 0 {
			delete(h.rooms, room)
		}
	}

	log.Printf("[WebSocket] Client %s unsubscribed from room %s", client.Username, room)
}

// BroadcastToRoom sends a message to all clients in a specific room
func (h *Hub) BroadcastToRoom(room string, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if roomClients, ok := h.rooms[room]; ok {
		for client := range roomClients {
			select {
			case client.Send <- message:
			default:
				// Client's send channel is full, will be cleaned up on next broadcast
				log.Printf("[WebSocket] Client %s send buffer full", client.Username)
			}
		}
		log.Printf("[WebSocket] Broadcasted to room %s (%d clients)", room, len(roomClients))
	}
}

// PublishToRedis publishes an event to Redis for cross-server communication
func (h *Hub) PublishToRedis(channel string, event RealtimeEvent) error {
	if h.redis == nil {
		return nil // Redis not available, skip
	}

	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return h.redis.Publish(ctx, channel, data).Err()
}

// PublishNewPost publishes a new post event to Redis
func (h *Hub) PublishNewPost(post interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeNewPost,
		Payload: post,
	}
	return h.PublishToRedis(RedisChannelPosts, event)
}

// PublishNewThread publishes a new thread event to Redis
func (h *Hub) PublishNewThread(thread interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeNewThread,
		Payload: thread,
	}
	return h.PublishToRedis(RedisChannelThreads, event)
}

// PublishNewWallPost publishes a new wall post event to Redis
func (h *Hub) PublishNewWallPost(post interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeNewWallPost,
		Payload: post,
	}
	return h.PublishToRedis(RedisChannelWall, event)
}

// PublishUpdateWallPost publishes an update wall post event to Redis
func (h *Hub) PublishUpdateWallPost(post interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeUpdateWallPost,
		Payload: post,
	}
	return h.PublishToRedis(RedisChannelWall, event)
}

// PublishDeleteWallPost publishes a delete wall post event to Redis
func (h *Hub) PublishDeleteWallPost(post interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeDeleteWallPost,
		Payload: post,
	}
	return h.PublishToRedis(RedisChannelWall, event)
}

// PublishNewChatMessage publishes a new chat message event to Redis
func (h *Hub) PublishNewChatMessage(message interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeNewChatMessage,
		Payload: message,
	}
	return h.PublishToRedis(RedisChannelChat, event)
}

// GetOnlineUsers returns a list of online user IDs
func (h *Hub) GetOnlineUsers() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	users := make([]string, 0, len(h.presence))
	for userID := range h.presence {
		users = append(users, userID)
	}
	return users
}

// GetClientByUserID returns a client by user ID
func (h *Hub) GetClientByUserID(userID string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.presence[userID]
}

// CheckOrigin validates WebSocket origin against allowed origins
func (h *Hub) CheckOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Allow requests without Origin header (e.g., non-browser clients)
		return true
	}

	// Check if origin is in allowed list
	for _, allowed := range h.allowedOrigins {
		if origin == allowed {
			return true
		}
	}

	log.Printf("[WebSocket] Rejected connection from unauthorized origin: %s", origin)
	return false
}
