package websocket

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

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
)

// Client represents a WebSocket connection
type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan []byte
	UserID   string
	Username string
	Rooms    map[string]bool
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

		// Apply rate limiting (except for ping messages)
		if message.Type != MessageTypePing {
			if !c.Hub.rateLimiter.Allow(c.UserID) {
				log.Printf("[WebSocket] Rate limit exceeded for user %s", c.UserID)
				// Send rate limit error to client
				errorMsg := Message{
					Type:      "error",
					Data:      mustMarshalJSON(map[string]string{"error": "Rate limit exceeded. Please slow down."}),
					Timestamp: time.Now().Unix(),
				}
				if msgBytes, err := json.Marshal(errorMsg); err == nil {
					select {
					case c.Send <- msgBytes:
					default:
					}
				}
				continue
			}
		}

		// Handle different message types
		switch message.Type {
		case MessageTypeSubscribe:
			if room, ok := parseRoomFromData(message.Data); ok && room != "" {
				c.Hub.SubscribeToRoom(c, room)
				// Send confirmation
				c.sendConfirmation(MessageTypeSubscribe, room)
			}

		case MessageTypeUnsubscribe:
			if room, ok := parseRoomFromData(message.Data); ok && room != "" {
				c.Hub.UnsubscribeFromRoom(c, room)
				// Send confirmation
				c.sendConfirmation(MessageTypeUnsubscribe, room)
			}

		case MessageTypeTyping:
			// Broadcast typing indicator to room
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
			// Broadcast chat typing indicator to room
			if room, ok := parseRoomFromData(message.Data); ok && room != "" {
				typingMsg := Message{
					Type: MessageTypeChatTyping,
					Room: room,
					Data: mustMarshalJSON(map[string]interface{}{
						"user_id":   c.UserID,
						"username":  c.Username,
						"is_typing": true,
					}),
					UserID:    c.UserID,
					Username:  c.Username,
					Timestamp: time.Now().Unix(),
				}

				if msgBytes, err := json.Marshal(typingMsg); err == nil {
					c.Hub.BroadcastToRoom(room, msgBytes)
				}
			}

		case MessageTypePing:
			// Respond with pong
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
					// Send buffer full
				}
			}

		default:
			// Echo back unknown message types for debugging
			log.Printf("[WebSocket] Unknown message type: %s", message.Type)
		}
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

// ServeWs handles WebSocket requests from the peer
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request, userID, username string) {
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
		Hub:      hub,
		Conn:     conn,
		Send:     make(chan []byte, sendBufferSize),
		UserID:   userID,
		Username: username,
		Rooms:    make(map[string]bool),
	}

	client.Hub.register <- client

	// Send initial connection success message
	connMsg := Message{
		Type:      "connected",
		Data:      mustMarshalJSON(map[string]string{"user_id": userID, "username": username}),
		UserID:    userID,
		Username:  username,
		Timestamp: time.Now().Unix(),
	}

	if msgBytes, err := json.Marshal(connMsg); err == nil {
		client.Send <- msgBytes
	}

	// Auto-subscribe user to their notification room
	hub.SubscribeToRoom(client, fmt.Sprintf("notifications_%s", userID))

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}
