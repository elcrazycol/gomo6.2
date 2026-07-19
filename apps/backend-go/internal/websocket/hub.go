package websocket

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// Message types
	MessageTypeNewPost         = "new_post"
	MessageTypeNewThread       = "new_thread"
	MessageTypeNewReply        = "new_reply"
	MessageTypeLike            = "like"
	MessageTypeUnlike          = "unlike"
	MessageTypeTyping          = "typing"
	MessageTypePresence        = "presence"
	MessageTypeSubscribe       = "subscribe"
	MessageTypeUnsubscribe     = "unsubscribe"
	MessageTypePing            = "ping"
	MessageTypeNewWallPost     = "new_wall_post"
	MessageTypeUpdateWallPost  = "update_wall_post"
	MessageTypeDeleteWallPost  = "delete_wall_post"
	MessageTypeNewChatMessage  = "new_chat_message"
	MessageTypeUserOnline      = "user_online"
	MessageTypeUserOffline     = "user_offline"
	MessageTypeNewNotification = "new_notification"
	MessageTypeNowPlaying      = "now_playing"
	// Messenger-specific events
	MessageTypeMessageEdited  = "message_edited"
	MessageTypeMessageDeleted = "message_deleted"
	MessageTypeReadReceipt    = "read_receipt"
	MessageTypeChatTyping     = "chat_typing"

	// Redis channels
	RedisChannelPosts         = "realtime:posts"
	RedisChannelThreads       = "realtime:threads"
	RedisChannelLikes         = "realtime:likes"
	RedisChannelWall          = "realtime:wall"
	RedisChannelChat          = "realtime:chat"
	RedisChannelStatus        = "realtime:status"
	RedisChannelNotifications = "realtime:notifications"
	RedisChannelSpotify       = "realtime:spotify"
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
	clients              map[*Client]bool
	broadcast            chan []byte
	register             chan *Client
	unregister           chan *Client
	rooms                map[string]map[*Client]bool
	presence             map[string]*Client
	mu                   sync.RWMutex
	redis                *redis.Client
	db                   *sql.DB
	ctx                  context.Context
	cancel               context.CancelFunc
	allowedOrigins       []string
	rateLimiter          *RateLimiter
	statusUpdateDebounce map[string]*time.Timer
	statusUpdateMu       sync.Mutex
}

// NewHub creates a new Hub with Redis integration
func NewHub(redisClient *redis.Client, allowedOrigins []string) *Hub {
	ctx, cancel := context.WithCancel(context.Background())
	if allowedOrigins == nil {
		allowedOrigins = []string{"http://localhost:5173", "http://localhost:8080"}
	}
	return &Hub{
		clients:              make(map[*Client]bool),
		broadcast:            make(chan []byte),
		register:             make(chan *Client),
		unregister:           make(chan *Client),
		rooms:                make(map[string]map[*Client]bool),
		presence:             make(map[string]*Client),
		redis:                redisClient,
		db:                   nil, // will be set via SetDB method
		ctx:                  ctx,
		cancel:               cancel,
		allowedOrigins:       allowedOrigins,
		rateLimiter:          NewRateLimiter(60, time.Minute), // 60 messages per minute
		statusUpdateDebounce: make(map[string]*time.Timer),
	}
}

// SetDB sets the database connection for the Hub
func (h *Hub) SetDB(db *sql.DB) {
	h.db = db
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
			// Only track in presence if already authenticated (post-auth message)
			if client.UserID != "" {
				h.presence[client.UserID] = client
			}
			h.mu.Unlock()

			// Only update status if the client has authenticated
			if client.UserID != "" {
				go h.updateUserOnlineStatus(client.UserID, true)
				go h.broadcastUserStatus(client.UserID, client.Username, true)
				log.Printf("[WebSocket] Client connected: %s (%s)", client.Username, client.UserID)
			} else {
				log.Printf("[WebSocket] Client connected (unauthenticated) — waiting for auth message")
			}

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

			// Update user offline status in database
			go h.updateUserOnlineStatus(client.UserID, false)

			// Broadcast user offline event
			go h.broadcastUserStatus(client.UserID, client.Username, false)

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
		if client.Conn != nil {
			client.Conn.Close()
		}
	}
}

// subscribeToRedis listens for messages from Redis Pub/Sub
func (h *Hub) subscribeToRedis() {
	if h.redis == nil {
		log.Println("[WebSocket] Redis not available, skipping Redis subscription")
		return
	}

	pubsub := h.redis.Subscribe(h.ctx, RedisChannelPosts, RedisChannelThreads, RedisChannelLikes, RedisChannelWall, RedisChannelChat, RedisChannelStatus, RedisChannelNotifications, RedisChannelSpotify)
	defer pubsub.Close()

	log.Println("[WebSocket] Subscribed to Redis channels:", RedisChannelPosts, RedisChannelThreads, RedisChannelLikes, RedisChannelWall, RedisChannelChat, RedisChannelStatus, RedisChannelNotifications)

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
		// Also broadcast to board-specific room so board pages update in realtime
		if boardID := extractRoomID(event.Payload, "board_id"); boardID != "" {
			h.BroadcastToRoom(fmt.Sprintf("board_%s", boardID), messageBytes)
		}

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
			// Auto-subscribe bot members to this chat room
			go h.autoSubscribeBotsToChat(conversationID, chatRoom)
		}

	case MessageTypeMessageEdited, MessageTypeMessageDeleted, MessageTypeReadReceipt, MessageTypeChatTyping:
		// These messenger events carry conversation_id in their payload
		if conversationID := extractRoomID(event.Payload, "conversation_id"); conversationID != "" {
			chatRoom := fmt.Sprintf("chat_%s", conversationID)
			h.BroadcastToRoom(chatRoom, messageBytes)
		}

	case "member_left":
		// Member left event carries conversation_id
		if conversationID := extractRoomID(event.Payload, "conversation_id"); conversationID != "" {
			chatRoom := fmt.Sprintf("chat_%s", conversationID)
			h.BroadcastToRoom(chatRoom, messageBytes)
		}

	case MessageTypeNewNotification:
		// Broadcast to specific user's notification room
		if userID := extractRoomID(event.Payload, "user_id"); userID != "" {
			notifRoom := fmt.Sprintf("notifications_%s", userID)
			h.BroadcastToRoom(notifRoom, messageBytes)
		}

	case MessageTypeUserOnline, MessageTypeUserOffline:
		// Broadcast user status to all connected clients
		h.broadcast <- messageBytes

	case "now_playing":
		// Broadcast to the user's profile room so visitors see live updates
		if userID := extractRoomID(event.Payload, "user_id"); userID != "" {
			room := fmt.Sprintf("profile_now_playing_%s", userID)
			h.BroadcastToRoom(room, messageBytes)
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

// autoSubscribeBotsToChat finds bot users who are members of a conversation
// and subscribes their connected clients to the chat room.
func (h *Hub) autoSubscribeBotsToChat(conversationID, chatRoom string) {
	if h.db == nil {
		return
	}

	rows, err := h.db.Query(`
		SELECT cm.user_id
		FROM chat_members cm
		INNER JOIN bots b ON b.user_id = cm.user_id
		WHERE cm.conversation_id = $1 AND b.is_active = true`, conversationID)
	if err != nil {
		return
	}
	defer rows.Close()

	// Collect bot user IDs first, then subscribe outside the query loop
	var botUserIDs []string
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			continue
		}
		botUserIDs = append(botUserIDs, userID)
	}

	for _, userID := range botUserIDs {
		h.mu.RLock()
		client, ok := h.presence[userID]
		needsSubscribe := ok && !client.Rooms[chatRoom]
		h.mu.RUnlock()

		if needsSubscribe {
			h.SubscribeToRoom(client, chatRoom)
		}
	}
}

// isMemberOfConversation checks if a user is a member of a chat conversation.
// Returns false if DB is unavailable (fail-closed).
func (h *Hub) isMemberOfConversation(userID, conversationID string) bool {
	if h.db == nil {
		return false
	}
	var ok bool
	err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
		conversationID, userID,
	).Scan(&ok)
	if err != nil {
		log.Printf("[WebSocket] membership check error: %v", err)
		return false
	}
	return ok
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
				client.failedSends = 0 // Reset on success
			default:
				client.failedSends++
				if client.failedSends > 10 {
					log.Printf("[WebSocket] Client %s too many failed sends, disconnecting", client.Username)
					close(client.Send)
					delete(roomClients, client)
				} else {
					log.Printf("[WebSocket] Client %s send buffer full (%d/10)", client.Username, client.failedSends)
				}
			}
		}
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

// PublishNewNotification publishes a notification event to Redis
func (h *Hub) PublishNewNotification(notification interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeNewNotification,
		Payload: notification,
	}
	return h.PublishToRedis(RedisChannelNotifications, event)
}

// PublishNewChatMessage publishes a new chat message event to Redis
func (h *Hub) PublishNewChatMessage(message interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeNewChatMessage,
		Payload: message,
	}
	return h.PublishToRedis(RedisChannelChat, event)
}

// PublishNowPlaying publishes a Spotify now-playing event to Redis
func (h *Hub) PublishNowPlaying(payload interface{}) error {
	event := RealtimeEvent{
		Type:    MessageTypeNowPlaying,
		Payload: payload,
	}
	return h.PublishToRedis(RedisChannelSpotify, event)
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

// updateUserOnlineStatus updates user's online status in database with debouncing
func (h *Hub) updateUserOnlineStatus(userID string, isOnline bool) {
	if h.db == nil {
		return
	}

	// Debounce status updates to prevent rapid DB writes
	h.statusUpdateMu.Lock()

	// Cancel existing timer for this user
	if timer, exists := h.statusUpdateDebounce[userID]; exists {
		timer.Stop()
	}

	// Create new debounced update
	h.statusUpdateDebounce[userID] = time.AfterFunc(500*time.Millisecond, func() {
		query := "UPDATE users SET is_online = $1, last_seen_at = NOW() WHERE id = $2"
		_, err := h.db.Exec(query, isOnline, userID)
		if err != nil {
			log.Printf("[WebSocket] Error updating user online status: %v", err)
		}

		// Clean up timer
		h.statusUpdateMu.Lock()
		delete(h.statusUpdateDebounce, userID)
		h.statusUpdateMu.Unlock()
	})

	h.statusUpdateMu.Unlock()
}

// broadcastUserStatus broadcasts user online/offline status to all clients
func (h *Hub) broadcastUserStatus(userID, username string, isOnline bool) {
	var messageType string
	if isOnline {
		messageType = MessageTypeUserOnline
	} else {
		messageType = MessageTypeUserOffline
	}

	event := RealtimeEvent{
		Type: messageType,
		Payload: map[string]interface{}{
			"user_id":   userID,
			"username":  username,
			"is_online": isOnline,
			"timestamp": time.Now().Unix(),
		},
	}

	// Publish to Redis for cross-server communication
	if err := h.PublishToRedis(RedisChannelStatus, event); err != nil {
		log.Printf("[WebSocket] Error publishing user status: %v", err)
	}
}

// CheckOrigin validates WebSocket origin against allowed origins
func (h *Hub) CheckOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Allow requests without Origin header (e.g., non-browser clients)
		return true
	}

	// Check if origin is in allowed list
	trimmedOrigin := strings.TrimRight(origin, "/")
	for _, allowed := range h.allowedOrigins {
		if trimmedOrigin == strings.TrimRight(allowed, "/") {
			return true
		}
	}

	log.Printf("[WebSocket] Rejected connection from unauthorized origin: %s", origin)
	return false
}
