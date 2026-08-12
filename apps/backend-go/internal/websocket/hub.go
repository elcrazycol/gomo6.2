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

	"github.com/gomo6/backend/internal/crypto"
	"github.com/gomo6/backend/internal/metrics"
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
	MessageTypeSessionRevoked = "session_revoked"

	// Redis channels
	RedisChannelPosts         = "realtime:posts"
	RedisChannelThreads       = "realtime:threads"
	RedisChannelLikes         = "realtime:likes"
	RedisChannelWall          = "realtime:wall"
	RedisChannelChat          = "realtime:chat"
	RedisChannelStatus        = "realtime:status"
	RedisChannelNotifications = "realtime:notifications"
	RedisChannelSpotify       = "realtime:spotify"
	RedisChannelUserRevoke    = "user:revoke"
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
	stopped              bool
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
		rateLimiter:          NewRateLimiter(redisClient, 60, time.Minute), // 60 messages per minute, Redis-backed
		statusUpdateDebounce: make(map[string]*time.Timer),
	}
}

// SetDB sets the database connection for the Hub
func (h *Hub) SetDB(db *sql.DB) {
	h.db = db
}

// withUserTx runs fn inside a short transaction whose RLS binding
// (app.current_user_id) is scoped with SET LOCAL. The old approach executed
// set_config via Exec on a pooled connection: with no transaction in progress,
// set_config(..., true) persists on the session, so the setting leaked to
// unrelated queries on that connection. Scoping it to one transaction prevents
// cross-user RLS contamination.
func (h *Hub) withUserTx(userID string, fn func(tx *sql.Tx) error) error {
	if h.db == nil {
		return fmt.Errorf("websocket hub has no database")
	}
	tx, err := h.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("SELECT set_config('app.current_user_id', $1, true)", userID); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Run starts the Hub and begins listening for Redis messages
func (h *Hub) Run() {
	// Start Redis subscriber in a separate goroutine
	go h.subscribeToRedis()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if h.stopped || h.ctx.Err() != nil {
				h.mu.Unlock()
				client.closeSend()
				if client.Conn != nil {
					_ = client.Conn.Close()
				}
				continue
			}
			h.clients[client] = true
			metrics.Messenger.WSConnected()
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
			removed := h.removeClientLocked(client)
			h.mu.Unlock()
			if removed {
				log.Printf("[WebSocket] Client disconnected: %s (%s)", client.Username, client.UserID)
				go h.updateUserOnlineStatus(client.UserID, false)
				go h.broadcastUserStatus(client.UserID, client.Username, false)
			}

		case message := <-h.broadcast:
			broadcastStarted := time.Now()
			// This is a write path: use Lock, never mutate clients while holding
			// RLock. trySend/closeSend serialize channel access with disconnects.
			h.mu.Lock()
			for client := range h.clients {
				if client.trySend(message) {
					client.failedSends = 0
					continue
				}
				client.failedSends++
				// A full non-blocking buffer means this client is not keeping up.
				// Disconnect immediately instead of retaining unbounded pressure.
				h.removeClientLocked(client)
			}
			h.mu.Unlock()
			metrics.Messenger.RecordBroadcast(time.Since(broadcastStarted))

		case <-h.ctx.Done():
			h.mu.Lock()
			for client := range h.clients {
				h.removeClientLocked(client)
			}
			h.mu.Unlock()
			return
		}
	}
}

// removeClientLocked removes a client from every hub index and closes its send
// channel exactly once. The caller must hold h.mu.Lock().
func (h *Hub) removeClientLocked(client *Client) bool {
	if _, ok := h.clients[client]; !ok {
		return false
	}
	delete(h.clients, client)
	metrics.Messenger.WSDisconnected()
	if current, ok := h.presence[client.UserID]; ok && current == client {
		delete(h.presence, client.UserID)
	}
	for room, roomClients := range h.rooms {
		if _, ok := roomClients[client]; !ok {
			continue
		}
		delete(roomClients, client)
		delete(client.Rooms, room)
		if len(roomClients) == 0 {
			delete(h.rooms, room)
		}
	}
	client.closeSend()
	if client.Conn != nil {
		_ = client.Conn.Close()
	}
	// Clear the per-session online marker and record the last activity time —
	// but only when no OTHER connection of the same session remains (the same
	// device may legitimately hold several tabs/connections).
	if client.SessionID != "" && !h.sessionStillConnected(client.UserID, client.SessionID) {
		go h.markSessionOffline(client.UserID, client.SessionID)
	}
	return true
}

// sessionStillConnected reports whether any other client of the same session
// is still registered. The caller must hold h.mu.
func (h *Hub) sessionStillConnected(userID, sessionID string) bool {
	for c := range h.clients {
		if c.UserID == userID && c.SessionID == sessionID {
			return true
		}
	}
	return false
}

// Stop gracefully shuts down the Hub.
func (h *Hub) Stop() {
	h.cancel()
	h.mu.Lock()
	h.stopped = true
	for client := range h.clients {
		h.removeClientLocked(client)
	}
	h.mu.Unlock()
}

// subscribeToRedis listens for messages from Redis Pub/Sub
func (h *Hub) subscribeToRedis() {
	if h.redis == nil {
		log.Println("[WebSocket] Redis not available, skipping Redis subscription")
		return
	}

	pubsub := h.redis.Subscribe(h.ctx, RedisChannelPosts, RedisChannelThreads, RedisChannelLikes, RedisChannelWall, RedisChannelChat, RedisChannelStatus, RedisChannelNotifications, RedisChannelSpotify, RedisChannelUserRevoke)
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
			if msg.Channel == RedisChannelUserRevoke {
				h.handleRevoke(msg.Payload)
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

// handleRevoke processes a session-revocation event from Redis. The payload is
// either a JSON object {"user_id": ..., "session_id": ...} (session-scoped
// kick) or a bare user id (legacy full-user kick).
func (h *Hub) handleRevoke(payload string) {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return
	}
	var evt struct {
		UserID    string `json:"user_id"`
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal([]byte(payload), &evt); err == nil && evt.UserID != "" {
		if evt.SessionID != "" {
			h.disconnectSession(evt.UserID, evt.SessionID)
		} else {
			h.disconnectUser(evt.UserID)
		}
		return
	}
	// Legacy payload: a bare user id.
	h.disconnectUser(payload)
}

// disconnectUser closes every local WebSocket owned by a revoked user.
// The hub lock protects all indexes; Client.closeSend is idempotent.
func (h *Hub) disconnectUser(userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	h.mu.Lock()
	for client := range h.clients {
		if client.UserID == userID {
			h.removeClientLocked(client)
		}
	}
	h.mu.Unlock()
}

// disconnectSession closes every local WebSocket belonging to one exact session
// (device). Before disconnecting, the kicked device receives a
// session_revoked message so the app can force-logout immediately instead of
// silently reconnecting with a dead token.
func (h *Hub) disconnectSession(userID, sessionID string) {
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	if userID == "" || sessionID == "" {
		return
	}
	h.mu.Lock()
	for client := range h.clients {
		if client.UserID != userID || client.SessionID != sessionID {
			continue
		}
		msg := Message{
			Type:      MessageTypeSessionRevoked,
			Data:      mustMarshalJSON(map[string]string{"session_id": sessionID}),
			Timestamp: time.Now().Unix(),
		}
		if b, err := json.Marshal(msg); err == nil {
			client.trySend(b)
		}
		h.removeClientLocked(client)
	}
	h.mu.Unlock()
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
			h.BroadcastToRoom(fmt.Sprintf("thread_%s", roomID), messageBytes)
		}
		// Also broadcast to global feed room
		h.BroadcastToRoom("feed", messageBytes)

	case MessageTypeNewThread:
		// Private boards must not leak into the global feed room: any authenticated
		// client can subscribe to "feed", so a thread created on a private board
		// would otherwise broadcast its title/creator to everyone online even
		// though it is invisible to non-members via REST. The board room still
		// receives the event (it only triggers a refetch on that board's page).
		if visibility := extractRoomID(event.Payload, "visibility"); visibility != "private" {
			h.BroadcastToRoom("feed", messageBytes)
		}
		// Also broadcast to board-specific room so board pages update in realtime
		if boardID := extractRoomID(event.Payload, "board_id"); boardID != "" {
			h.BroadcastToRoom(fmt.Sprintf("board_%s", boardID), messageBytes)
		}

	case MessageTypeLike, MessageTypeUnlike:
		// Broadcast to relevant thread room
		if roomID := extractRoomID(event.Payload, "thread_id"); roomID != "" {
			h.BroadcastToRoom(fmt.Sprintf("thread_%s", roomID), messageBytes)
		}

	case MessageTypeNewWallPost, MessageTypeUpdateWallPost, MessageTypeDeleteWallPost:
		// Extract user_id from payload for profile wall broadcasting
		if userID := extractRoomID(event.Payload, "user_id"); userID != "" {
			wallRoom := fmt.Sprintf("profile_wall_%s", userID)
			h.BroadcastToRoom(wallRoom, messageBytes)
		}

	case MessageTypeNewChatMessage:
		if payload, ok := event.Payload.(map[string]interface{}); ok {
			messageBytes = decryptChatPayloadForBroadcast(payload, message, messageBytes, event.Type)
		}
		// Extract conversation_id from payload for chat broadcasting
		if conversationID := extractRoomID(event.Payload, "conversation_id"); conversationID != "" {
			chatRoom := fmt.Sprintf("chat_%s", conversationID)
			h.BroadcastToRoom(chatRoom, messageBytes)
			// Auto-subscribe bot members to this chat room
			go h.autoSubscribeBotsToChat(conversationID, chatRoom)
		}

	case MessageTypeMessageEdited:
		if payload, ok := event.Payload.(map[string]interface{}); ok {
			messageBytes = decryptChatPayloadForBroadcast(payload, message, messageBytes, event.Type)
		}
		if conversationID := extractRoomID(event.Payload, "conversation_id"); conversationID != "" {
			chatRoom := fmt.Sprintf("chat_%s", conversationID)
			h.BroadcastToRoom(chatRoom, messageBytes)
		}

	case MessageTypeMessageDeleted, MessageTypeReadReceipt, MessageTypeChatTyping:
		// These events don't carry encrypted content
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

// decryptChatPayloadForBroadcast tries to decrypt a chat payload's
// encrypted_content using the per-conversation key, falling back to the master
// key for legacy messages. It returns updated message bytes with the decrypted
// content and the encrypted_content key removed. If decryption fails, the
// content is replaced with crypto.DecryptionFailedPlaceholder — the raw
// ciphertext must never be forwarded to clients.
func decryptChatPayloadForBroadcast(payload map[string]interface{}, message Message, messageBytes []byte, eventType string) []byte {
	enc, ok := payload["encrypted_content"].(string)
	if !ok || enc == "" {
		return messageBytes
	}

	conversationID := extractRoomID(payload, "conversation_id")
	if conversationID == "" {
		log.Printf("[WebSocket] WARNING: encrypted %s missing conversation_id, falling back to master key decryption", eventType)
	}

	decrypted := ""
	var err error
	if conversationID != "" {
		decrypted, err = crypto.DecryptForConversation(conversationID, enc)
	}
	if err != nil {
		decrypted, err = crypto.DecryptMaster(enc)
	}
	if err != nil {
		// Do not leak ciphertext: forward a neutral placeholder instead.
		decrypted = crypto.DecryptionFailedPlaceholder
	}

	payload["content"] = decrypted
	delete(payload, "encrypted_content")
	if newData, err := json.Marshal(payload); err == nil {
		message.Data = newData
		if newMessageBytes, err := json.Marshal(message); err == nil {
			return newMessageBytes
		}
	}
	return messageBytes
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
//
// The lookup runs through a SECURITY DEFINER function because it is a
// system-level operation: the Redis event handler has no per-request user
// context, and chat_members is FORCE RLS, so a plain query would be filtered
// out (current_setting returns NULL outside a bound transaction).
func (h *Hub) autoSubscribeBotsToChat(conversationID, chatRoom string) {
	if h.db == nil {
		return
	}

	rows, err := h.db.Query(
		"SELECT user_id FROM get_active_bot_members($1)", conversationID)
	if err != nil {
		log.Printf("[WebSocket] failed to query active bot members: %v", err)
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
// The query runs inside a transaction scoped to userID so the chat_members RLS
// policy (which reads app.current_user_id) admits the row without leaking the
// setting to pooled connections. Returns false if DB is unavailable (fail-closed).
func (h *Hub) isMemberOfConversation(userID, conversationID string) bool {
	if h.db == nil {
		return false
	}
	var ok bool
	err := h.withUserTx(userID, func(tx *sql.Tx) error {
		return tx.QueryRow(
			"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
			conversationID, userID,
		).Scan(&ok)
	})
	if err != nil {
		log.Printf("[WebSocket] membership check error: %v", err)
		return false
	}
	return ok
}

// canAccessRoom is the single authorization gate for client-requested rooms.
// Public realtime rooms remain intentionally narrow; user-specific and chat
// rooms are always bound to the authenticated identity.
func (h *Hub) canAccessRoom(userID, room string) bool {
	room = strings.TrimSpace(room)
	if room == "" || userID == "" {
		return false
	}
	switch {
	case strings.HasPrefix(room, "notifications_"):
		return strings.TrimPrefix(room, "notifications_") == userID
	case strings.HasPrefix(room, "chat_"):
		conversationID := strings.TrimPrefix(room, "chat_")
		return conversationID != "" && h.isMemberOfConversation(userID, conversationID)
	case room == "feed":
		return true
	case strings.HasPrefix(room, "profile_wall_"):
		targetID := strings.TrimPrefix(room, "profile_wall_")
		return targetID != "" && h.canViewWallRoom(userID, targetID)
	case strings.HasPrefix(room, "profile_now_playing_"):
		targetID := strings.TrimPrefix(room, "profile_now_playing_")
		return targetID != "" && h.canViewNowPlayingRoom(userID, targetID)
	default:
		// Thread/board rooms are public realtime content, but arbitrary room
		// names must not become an implicit broadcast subscription primitive.
		return isPublicRoom(room)
	}
}

// canViewWallRoom reports whether userID may receive realtime events for a
// profile wall. Walls of public profiles are open to any authenticated user
// unless the owner hid the wall (private_hide_wall); private walls require
// ownership or a mutual friendship. This mirrors the REST visibility predicate
// (profileWallFinishSelectQuery) so a stranger cannot subscribe to hidden or
// private wall events (new/update/delete posts carry full content + image URLs).
func (h *Hub) canViewWallRoom(userID, targetID string) bool {
	if h.db == nil {
		return false
	}
	if userID == targetID {
		return true
	}
	var private, hideWall bool
	err := h.db.QueryRow(
		"SELECT COALESCE(private_profile, false), COALESCE(private_hide_wall, false) FROM privacy_settings WHERE user_id = $1", targetID,
	).Scan(&private, &hideWall)
	if err != nil {
		if err == sql.ErrNoRows {
			// No privacy settings row means the profile is public and the wall
			// is not hidden.
			return true
		}
		return false
	}
	if !private && !hideWall {
		return true
	}
	return h.areFriends(userID, targetID)
}

// canViewNowPlayingRoom reports whether userID may receive realtime Spotify
// now-playing events for targetID. The owner is always allowed; other users
// may subscribe while the target profile is public, and friends of a private
// profile stay allowed (mirroring wall visibility). A stranger must not be
// able to track the music listening of a private-profile user in real time.
func (h *Hub) canViewNowPlayingRoom(userID, targetID string) bool {
	if h.db == nil {
		return false
	}
	if userID == targetID {
		return true
	}
	var private bool
	err := h.db.QueryRow(
		"SELECT COALESCE(private_profile, false) FROM privacy_settings WHERE user_id = $1", targetID,
	).Scan(&private)
	if err != nil {
		if err == sql.ErrNoRows {
			// No privacy settings row means the profile is public.
			return true
		}
		return false
	}
	if !private {
		return true
	}
	return h.areFriends(userID, targetID)
}

// areFriends reports whether a bidirectional friendship exists between userID
// and targetID. Returns false on DB error or nil DB (fail-closed). Shared by
// the wall and now-playing room visibility rules so friendship semantics stay
// consistent in both.
func (h *Hub) areFriends(userID, targetID string) bool {
	if h.db == nil {
		return false
	}
	var friend bool
	err := h.db.QueryRow(`SELECT EXISTS(
		SELECT 1 FROM friendships
		WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
	)`, userID, targetID).Scan(&friend)
	if err != nil {
		return false
	}
	return friend
}

func isPublicRoom(room string) bool {
	if room == "" {
		return false
	}
	for _, prefix := range []string{"board_", "thread_"} {
		if strings.HasPrefix(room, prefix) && len(strings.TrimPrefix(room, prefix)) > 0 {
			return true
		}
	}
	return false
}

// SubscribeToRoom adds a client to a room
func (h *Hub) SubscribeToRoom(client *Client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.stopped || h.ctx.Err() != nil {
		return
	}
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

// ForceUnsubscribeFromWallRooms revokes every live subscription of viewerID to
// the private wall rooms of targetID (profile_wall_<targetID>). A wall-room
// subscription is authorized once at subscribe time based on the friendship
// that existed then; when that friendship is destroyed (RemoveFriend) the
// subscription must be torn down, otherwise the ex-friend keeps receiving
// new/update/delete wall events with full content and image URLs.
func (h *Hub) ForceUnsubscribeFromWallRooms(viewerID, targetID string) {
	if viewerID == "" || targetID == "" {
		return
	}
	room := fmt.Sprintf("profile_wall_%s", targetID)
	h.mu.Lock()
	defer h.mu.Unlock()

	roomClients, ok := h.rooms[room]
	if !ok {
		return
	}
	for client := range roomClients {
		if client.UserID != viewerID {
			continue
		}
		delete(roomClients, client)
		delete(client.Rooms, room)
		log.Printf("[WebSocket] Client %s force-unsubscribed from %s (friendship revoked)", client.Username, room)
	}
	if len(roomClients) == 0 {
		delete(h.rooms, room)
	}
}

// ForceUnsubscribeFromNowPlayingRooms revokes every live subscription of
// viewerID to the now-playing room of targetID (profile_now_playing_<targetID>).
// A now-playing subscription is authorized once at subscribe time based on the
// friendship that existed then; when that friendship is destroyed (RemoveFriend)
// the subscription must be torn down, otherwise the ex-friend keeps receiving
// realtime Spotify now-playing events of a private-profile user until they
// reconnect.
func (h *Hub) ForceUnsubscribeFromNowPlayingRooms(viewerID, targetID string) {
	if viewerID == "" || targetID == "" {
		return
	}
	room := fmt.Sprintf("profile_now_playing_%s", targetID)
	h.mu.Lock()
	defer h.mu.Unlock()

	roomClients, ok := h.rooms[room]
	if !ok {
		return
	}
	for client := range roomClients {
		if client.UserID != viewerID {
			continue
		}
		delete(roomClients, client)
		delete(client.Rooms, room)
		log.Printf("[WebSocket] Client %s force-unsubscribed from %s (friendship revoked)", client.Username, room)
	}
	if len(roomClients) == 0 {
		delete(h.rooms, room)
	}
}

// RevokeProfileRoomSubscriptionsFromNonFriends revokes live subscriptions to
// targetID's profile_wall_ and/or profile_now_playing_ rooms from every viewer
// who is not the owner and not a mutual friend. Called when privacy settings
// make those rooms friends-only (private_profile / private_hide_wall), so
// viewers who subscribed while the profile was public stop receiving wall /
// now-playing events without reconnecting — a subscription authorized once at
// subscribe time must not outlive the privacy change. The caller (privacy
// settings write handler) invokes this only after the privacy change has
// committed, so any viewer who (re)subscribes concurrently is already denied
// by canAccessRoom at subscribe time. Rooms that carry no such viewers are
// left untouched; the method is a no-op when the hub has no DB or no matching
// rooms.
func (h *Hub) RevokeProfileRoomSubscriptionsFromNonFriends(targetID string, revokeWall, revokeNowPlaying bool) {
	if targetID == "" || (!revokeWall && !revokeNowPlaying) {
		return
	}
	rooms := make([]string, 0, 2)
	if revokeWall {
		rooms = append(rooms, fmt.Sprintf("profile_wall_%s", targetID))
	}
	if revokeNowPlaying {
		rooms = append(rooms, fmt.Sprintf("profile_now_playing_%s", targetID))
	}

	// Phase 1: snapshot candidate viewers (excluding the owner) under a short
	// read lock.
	h.mu.RLock()
	type roomClient struct {
		room   string
		client *Client
	}
	var candidates []roomClient
	for _, room := range rooms {
		for client := range h.rooms[room] {
			if client.UserID != "" && client.UserID != targetID {
				candidates = append(candidates, roomClient{room: room, client: client})
			}
		}
	}
	h.mu.RUnlock()

	if len(candidates) == 0 {
		return
	}

	// Phase 2: decide friendship outside the hub lock (DB round trips).
	keep := make(map[*Client]bool, len(candidates))
	for _, rc := range candidates {
		if h.areFriends(rc.client.UserID, targetID) {
			keep[rc.client] = true
		}
	}

	// Phase 3: remove the non-friends under the write lock. A viewer who was
	// already removed (disconnect/re-subscribe race) is skipped.
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, rc := range candidates {
		if keep[rc.client] {
			continue
		}
		roomClients, ok := h.rooms[rc.room]
		if !ok {
			continue
		}
		if _, present := roomClients[rc.client]; !present {
			continue
		}
		delete(roomClients, rc.client)
		delete(rc.client.Rooms, rc.room)
		log.Printf("[WebSocket] Client %s force-unsubscribed from %s (privacy settings restrict this content)", rc.client.Username, rc.room)
		if len(roomClients) == 0 {
			delete(h.rooms, rc.room)
		}
	}
}

// ForceUnsubscribeFromChatRooms revokes the live subscription of userID to the
// chat room chat_<conversationID>. A chat-room subscription is authorized once
// at subscribe time based on membership in chat_members; when that membership
// is destroyed (LeaveConversation / RemoveGroupMember) the subscription must be
// torn down, otherwise the ex-member keeps receiving new decrypted chat
// messages with full content until they reconnect.
func (h *Hub) ForceUnsubscribeFromChatRooms(userID, conversationID string) {
	if userID == "" || conversationID == "" {
		return
	}
	room := fmt.Sprintf("chat_%s", conversationID)
	h.mu.Lock()
	defer h.mu.Unlock()

	roomClients, ok := h.rooms[room]
	if !ok {
		return
	}
	for client := range roomClients {
		if client.UserID != userID {
			continue
		}
		delete(roomClients, client)
		delete(client.Rooms, room)
		log.Printf("[WebSocket] Client %s force-unsubscribed from %s (membership revoked)", client.Username, room)
	}
	if len(roomClients) == 0 {
		delete(h.rooms, room)
	}
}

// BroadcastToRoom sends a message to all clients in a specific room
func (h *Hub) BroadcastToRoom(room string, message []byte) {
	started := time.Now()
	defer func() { metrics.Messenger.RecordBroadcast(time.Since(started)) }()
	h.mu.Lock()
	defer h.mu.Unlock()

	roomClients, ok := h.rooms[room]
	if !ok {
		return
	}
	for client := range roomClients {
		if client.trySend(message) {
			client.failedSends = 0
			continue
		}
		client.failedSends++
		log.Printf("[WebSocket] Client %s send buffer full, disconnecting", client.Username)
		h.removeClientLocked(client)
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

// markSessionOnline flags this exact session as online in Redis and refreshes
// its last_active_at. The marker carries a 5-minute TTL which is refreshed by
// app-level pings, so a server crash never leaves a ghost "online" device.
func (h *Hub) markSessionOnline(userID, sessionID string) {
	if sessionID == "" {
		return
	}
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
		h.redis.Set(ctx, fmt.Sprintf("ws:online:%s:%s", userID, sessionID), "1", 5*time.Minute)
		cancel()
	}
	h.touchSessionActivity(userID, sessionID)
}

// touchSessionOnline refreshes the TTL of the per-session online marker.
func (h *Hub) touchSessionOnline(userID, sessionID string) {
	if h.redis == nil || sessionID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	h.redis.Expire(ctx, fmt.Sprintf("ws:online:%s:%s", userID, sessionID), 5*time.Minute)
	cancel()
}

// markSessionOffline clears the per-session online marker and records the last
// activity time ("последняя активность" in the devices list).
func (h *Hub) markSessionOffline(userID, sessionID string) {
	if sessionID == "" {
		return
	}
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
		h.redis.Del(ctx, fmt.Sprintf("ws:online:%s:%s", userID, sessionID))
		cancel()
	}
	h.touchSessionActivity(userID, sessionID)
}

// touchSessionActivity bumps user_sessions.last_active_at for a session.
func (h *Hub) touchSessionActivity(userID, sessionID string) {
	if h.db == nil || sessionID == "" {
		return
	}
	if _, err := h.db.Exec(`UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1 AND user_id = $2`, sessionID, userID); err != nil {
		log.Printf("[WebSocket] failed to update session activity: %v", err)
	}
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
	// M3: private profiles must not leak online state to everyone on the
	// platform. The status events carry user_id + username and are broadcast
	// to every connected client, so for a private profile the safest behavior
	// is to not publish the event at all — friends still learn the status via
	// the authenticated /users/:id/status and /users/status/bulk endpoints
	// (which now apply the same privacy rule).
	if h.db != nil {
		var private bool
		if err := h.db.QueryRow("SELECT COALESCE(private_profile, false) FROM privacy_settings WHERE user_id = $1", userID).Scan(&private); err == nil && private {
			return
		}
	}

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
