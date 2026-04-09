package websocket

import (
	"encoding/json"
	"log"
	"sync"
)

// Message types
const (
	MessageTypeNewPost   = "new_post"
	MessageTypeNewThread = "new_thread"
	MessageTypeLike      = "like"
	MessageTypeUnlike    = "unlike"
	MessageTypetyping    = "typing"
	MessageTypePresence  = "presence"
)

// WebSocket message structure
type Message struct {
	Type      string      `json:"type"`
	Room      string      `json:"room,omitempty"`
	Data      interface{} `json:"data"`
	UserID    string      `json:"user_id,omitempty"`
	Username  string      `json:"username,omitempty"`
	Timestamp int64       `json:"timestamp"`
}

// Hub maintains the set of active clients and broadcasts messages to the clients.
type Hub struct {
	// Registered clients.
	clients map[*Client]bool

	// Inbound messages from the clients.
	broadcast chan []byte

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	// Room subscriptions
	rooms map[string]map[*Client]bool

	// User presence
	presence map[string]*Client

	// Mutex for thread safety
	mu sync.RWMutex
}

// NewHub creates a new Hub
func NewHub() *Hub {
	return &Hub{
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		rooms:      make(map[string]map[*Client]bool),
		presence:   make(map[string]*Client),
	}
}

// Run starts the hub
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.presence[client.UserID] = client
			h.mu.Unlock()
			log.Printf("Client connected: %s (%s)", client.Username, client.UserID)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				delete(h.presence, client.UserID)

				// Remove from all rooms
				for room, roomClients := range h.rooms {
					if _, ok := roomClients[client]; ok {
						delete(roomClients, client)
						// Notify room about user leaving
						h.broadcastToRoom(room, Message{
							Type:      MessageTypePresence,
							Data:      map[string]interface{}{"user_id": client.UserID, "online": false},
							Timestamp: getCurrentTimestamp(),
						})
					}
				}

				close(client.Send)
				log.Printf("Client disconnected: %s (%s)", client.Username, client.UserID)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
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

	log.Printf("Client %s subscribed to room %s", client.Username, room)
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

	log.Printf("Client %s unsubscribed from room %s", client.Username, room)
}

// BroadcastToRoom sends a message to all clients in a room
func (h *Hub) BroadcastToRoom(room string, message Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if roomClients, ok := h.rooms[room]; ok {
		messageJSON, err := json.Marshal(message)
		if err != nil {
			log.Printf("Error marshaling message: %v", err)
			return
		}

		for client := range roomClients {
			select {
			case client.Send <- messageJSON:
			default:
				close(client.Send)
				delete(h.clients, client)
			}
		}
	}
}

// broadcastToRoom is the internal method that doesn't lock (for use within already locked contexts)
func (h *Hub) broadcastToRoom(room string, message Message) {
	if roomClients, ok := h.rooms[room]; ok {
		messageJSON, err := json.Marshal(message)
		if err != nil {
			log.Printf("Error marshaling message: %v", err)
			return
		}

		for client := range roomClients {
			select {
			case client.Send <- messageJSON:
			default:
				close(client.Send)
				delete(h.clients, client)
			}
		}
	}
}

// GetOnlineUsers returns a list of online users in a room
func (h *Hub) GetOnlineUsers(room string) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var users []string
	if roomClients, ok := h.rooms[room]; ok {
		for client := range roomClients {
			users = append(users, client.UserID)
		}
	}
	return users
}

// GetClientByUserID returns a client by user ID
func (h *Hub) GetClientByUserID(userID string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return h.presence[userID]
}

func getCurrentTimestamp() int64 {
	return 0 // TODO: implement proper timestamp
}
