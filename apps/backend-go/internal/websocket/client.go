package websocket

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/auth"
	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// Send pings to peer with this period (must be less than pongWait)
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer
	maxMessageSize = 65536

	// Send buffer size
	sendBufferSize = 256

	// Time allowed for the client to authenticate after connecting
	authTimeout = 5 * time.Second
)

// Client represents a WebSocket connection
type Client struct {
	Hub           *Hub
	Conn          *websocket.Conn
	Send          chan []byte
	UserID        string
	Username      string
	Rooms         map[string]bool
	authenticated bool
	authService   *auth.AuthService
}

// readPump pumps messages from the WebSocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Set initial deadline for auth
	c.Conn.SetReadDeadline(time.Now().Add(authTimeout))

	for {
		_, messageBytes, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WebSocket] Unexpected close error: %v", err)
			}
			break
		}

		// Parse incoming message
		var message Message
		if err := json.Unmarshal(messageBytes, &message); err != nil {
			log.Printf("[WebSocket] Error parsing message: %v", err)
			continue
		}

		// Handle auth message — must be the first message
		if message.Type == "auth" {
			if err := c.handleAuth(message.Data); err != nil {
				log.Printf("[WebSocket] Auth failed: %v", err)
				c.sendError("Authentication failed: " + err.Error())
				return
			}
			c.authenticated = true
			// Reset deadline to normal pong wait after successful auth
			c.Conn.SetReadDeadline(time.Now().Add(pongWait))

			// Send connected confirmation
			connMsg := Message{
				Type:      "connected",
				Data:      mustMarshalJSON(map[string]string{"user_id": c.UserID, "username": c.Username}),
				UserID:    c.UserID,
				Username:  c.Username,
				Timestamp: time.Now().Unix(),
			}
			if msgBytes, err := json.Marshal(connMsg); err == nil {
				c.Send <- msgBytes
			}

			// Auto-subscribe to notification room
			c.Hub.SubscribeToRoom(c, fmt.Sprintf("notifications_%s", c.UserID))
			continue
		}

		// Require authentication for all other message types
		if !c.authenticated {
			c.sendError("Authentication required — send auth message first")
			return
		}

		// Apply rate limiting (except for ping messages)
		if message.Type != MessageTypePing {
			if !c.Hub.rateLimiter.Allow(c.UserID) {
				log.Printf("[WebSocket] Rate limit exceeded for user %s", c.UserID)
				c.sendError("Rate limit exceeded. Please slow down.")
				continue
			}
		}

		// Handle different message types
		switch message.Type {
		case MessageTypeSubscribe:
			if room, ok := parseRoomFromData(message.Data); ok && room != "" {
				c.Hub.SubscribeToRoom(c, room)
				c.sendConfirmation(MessageTypeSubscribe, room)
			}

		case MessageTypeUnsubscribe:
			if room, ok := parseRoomFromData(message.Data); ok && room != "" {
				c.Hub.UnsubscribeFromRoom(c, room)
				c.sendConfirmation(MessageTypeUnsubscribe, room)
			}

		case MessageTypeTyping:
			if room, ok := parseRoomFromData(message.Data); ok && room != "" {
				typingMsg := Message{
					Type: MessageTypeTyping,
					Room: room,
					Data: mustMarshalJSON(map[string]interface{}{
						"user_id":  c.UserID,
						"username": c.Username,
						"typing":   true,
					}),
					UserID:    c.UserID,
					Username:  c.Username,
					Timestamp: time.Now().Unix(),
				}

				if msgBytes, err := json.Marshal(typingMsg); err == nil {
					c.Hub.BroadcastToRoom(room, msgBytes)
				}
			}

		case MessageTypeChatTyping:
			if message.Room != "" {
				isTyping := true
				var typingPayload struct {
					IsTyping bool `json:"is_typing"`
				}
				if err := json.Unmarshal(message.Data, &typingPayload); err == nil {
					isTyping = typingPayload.IsTyping
				}

				typingMsg := Message{
					Type: MessageTypeChatTyping,
					Room: message.Room,
					Data: mustMarshalJSON(map[string]interface{}{
						"user_id":   c.UserID,
						"username":  c.Username,
						"is_typing": isTyping,
					}),
					UserID:    c.UserID,
					Username:  c.Username,
					Timestamp: time.Now().Unix(),
				}

				if msgBytes, err := json.Marshal(typingMsg); err == nil {
					c.Hub.BroadcastToRoom(message.Room, msgBytes)
				}
			}

		case MessageTypePing:
			pongMsg := Message{
				Type:      "pong",
				Data:      mustMarshalJSON(map[string]string{"timestamp": fmt.Sprintf("%d", time.Now().Unix())}),
				UserID:    c.UserID,
				Username:  c.Username,
				Timestamp: time.Now().Unix(),
			}

			if msgBytes, err := json.Marshal(pongMsg); err == nil {
				select {
				case c.Send <- msgBytes:
				default:
				}
			}

		default:
			log.Printf("[WebSocket] Unknown message type: %s", message.Type)
		}
	}
}

// handleAuth validates the auth token from a client's first message.
func (c *Client) handleAuth(data json.RawMessage) error {
	var authPayload struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(data, &authPayload); err != nil || authPayload.Token == "" {
		return fmt.Errorf("invalid auth payload")
	}

	// Try bot token auth first
	if strings.HasPrefix(authPayload.Token, "gomo6_bot_") && c.Hub.db != nil {
		h := sha256.Sum256([]byte(authPayload.Token))
		tokenHash := hex.EncodeToString(h[:])

		var botID, ownerID, userID, username string
		err := c.Hub.db.QueryRow(
			`SELECT b.id, b.owner_id, b.user_id, u.username
			 FROM bots b JOIN users u ON u.id = b.user_id
			 WHERE b.token_hash = $1 AND b.is_active = true`, tokenHash,
		).Scan(&botID, &ownerID, &userID, &username)
		if err == nil {
			c.UserID = userID
			c.Username = username

			c.Hub.mu.Lock()
			c.Hub.presence[c.UserID] = c
			c.Hub.mu.Unlock()

			go c.Hub.updateUserOnlineStatus(c.UserID, true)
			go c.Hub.broadcastUserStatus(c.UserID, c.Username, true)

			log.Printf("[WebSocket] Authenticated bot: %s (%s)", c.Username, c.UserID)

			// Auto-subscribe bot to all its chat rooms
			go c.autoSubscribeBotsChats()

			return nil
		}
		// Bot token invalid — fall through to JWT
	}

	claims, err := c.authService.ValidateToken(authPayload.Token)
	if err != nil {
		return fmt.Errorf("invalid token")
	}

	c.UserID = claims.UserID
	c.Username = claims.Username
	if c.Username == "" {
		c.Username = claims.UserID[:8]
	}

	// Add to presence map now that we have a UserID
	c.Hub.mu.Lock()
	c.Hub.presence[c.UserID] = c
	c.Hub.mu.Unlock()

	// Broadcast online status and update DB
	go c.Hub.updateUserOnlineStatus(c.UserID, true)
	go c.Hub.broadcastUserStatus(c.UserID, c.Username, true)

	log.Printf("[WebSocket] Authenticated user: %s (%s)", c.Username, c.UserID)
	return nil
}

// autoSubscribeBotsChats fetches all conversations for the bot user
// and subscribes to their chat rooms so the bot receives messages.
func (c *Client) autoSubscribeBotsChats() {
	if c.Hub.db == nil {
		return
	}

	rows, err := c.Hub.db.Query(`
		SELECT cm.conversation_id
		FROM conversation_members cm
		WHERE cm.user_id = $1`, c.UserID)
	if err != nil {
		log.Printf("[WebSocket] Failed to fetch bot conversations: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var convID string
		if err := rows.Scan(&convID); err != nil {
			continue
		}
		room := fmt.Sprintf("chat_%s", convID)
		c.Hub.SubscribeToRoom(c, room)
	}
	log.Printf("[WebSocket] Bot %s auto-subscribed to chat rooms", c.Username)
}

// sendError sends an error message to the client and then closes the connection.
func (c *Client) sendError(msg string) {
	errMsg := Message{
		Type:      "error",
		Data:      mustMarshalJSON(map[string]string{"error": msg}),
		Timestamp: time.Now().Unix(),
	}
	if msgBytes, err := json.Marshal(errMsg); err == nil {
		c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
		c.Conn.WriteMessage(websocket.TextMessage, msgBytes)
	}
}

// writePump pumps messages from the hub to the WebSocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("[WebSocket] Write error: %v", err)
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("[WebSocket] Ping error: %v", err)
				return
			}
		}
	}
}

// sendConfirmation sends a confirmation message to the client
func (c *Client) sendConfirmation(messageType string, room string) {
	confirmation := Message{
		Type:      "confirmation",
		Data:      mustMarshalJSON(map[string]string{"action": messageType, "room": room}),
		Timestamp: time.Now().Unix(),
	}

	if msgBytes, err := json.Marshal(confirmation); err == nil {
		select {
		case c.Send <- msgBytes:
		default:
			// Send buffer full
		}
	}
}

// parseRoomFromData extracts room ID from message data
func parseRoomFromData(data json.RawMessage) (string, bool) {
	if len(data) == 0 {
		return "", false
	}

	// Try parsing as string
	var roomStr string
	if err := json.Unmarshal(data, &roomStr); err == nil {
		return roomStr, true
	}

	// Try parsing as object with "room" field
	var roomObj struct {
		Room string `json:"room"`
	}
	if err := json.Unmarshal(data, &roomObj); err == nil {
		return roomObj.Room, true
	}

	return "", false
}

// mustMarshalJSON marshals data to JSON or panics (used for internal data)
func mustMarshalJSON(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("{}")
	}
	return data
}

// Upgrader configures the WebSocket upgrader
// Note: CheckOrigin is set per-request in ServeWs to use config
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// ServeWs handles WebSocket requests from the peer.
// Authentication is deferred to the first message (type: "auth").
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request, authService *auth.AuthService) {
	// Set CheckOrigin based on hub's allowed origins
	upgrader.CheckOrigin = func(req *http.Request) bool {
		return hub.CheckOrigin(req)
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade error: %v", err)
		return
	}

	client := &Client{
		Hub:           hub,
		Conn:          conn,
		Send:          make(chan []byte, sendBufferSize),
		UserID:        "",
		Username:      "",
		Rooms:         make(map[string]bool),
		authenticated: false,
		authService:   authService,
	}

	client.Hub.register <- client

	// Start goroutines for reading and writing.
	// The client must authenticate within authTimeout or be disconnected.
	go client.writePump()
	go client.readPump()
}
