package websocket

import (
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// newTestClient creates a Client for testing without a real WebSocket connection.
func newTestClient(hub *Hub, userID, username string) *Client {
	return &Client{
		Hub:      hub,
		Conn:     nil, // not needed for most hub operations
		Send:     make(chan []byte, sendBufferSize),
		UserID:   userID,
		Username: username,
		Rooms:    make(map[string]bool),
	}
}

func waitForBuffer() {
	time.Sleep(10 * time.Millisecond)
}

// =============================================================================
// NewHub
// =============================================================================

func TestNewHub_DefaultAllowedOrigins(t *testing.T) {
	hub := NewHub(nil, nil)

	if len(hub.allowedOrigins) != 2 {
		t.Errorf("expected 2 default allowed origins, got %d", len(hub.allowedOrigins))
	}
	if hub.allowedOrigins[0] != "http://localhost:5173" {
		t.Errorf("expected first origin 'http://localhost:5173', got %q", hub.allowedOrigins[0])
	}
	if hub.allowedOrigins[1] != "http://localhost:8080" {
		t.Errorf("expected second origin 'http://localhost:8080', got %q", hub.allowedOrigins[1])
	}
	if hub.rateLimiter == nil {
		t.Error("rateLimiter should be initialized")
	}
	if hub.redis != nil {
		t.Error("redis should be nil when nil passed")
	}
}

func TestNewHub_CustomAllowedOrigins(t *testing.T) {
	custom := []string{"https://example.com"}
	hub := NewHub(nil, custom)

	if len(hub.allowedOrigins) != 1 {
		t.Errorf("expected 1 allowed origin, got %d", len(hub.allowedOrigins))
	}
	if hub.allowedOrigins[0] != "https://example.com" {
		t.Errorf("expected 'https://example.com', got %q", hub.allowedOrigins[0])
	}
}

func TestNewHub_InitialState(t *testing.T) {
	hub := NewHub(nil, nil)

	if len(hub.clients) != 0 {
		t.Errorf("expected empty clients, got %d", len(hub.clients))
	}
	if len(hub.rooms) != 0 {
		t.Errorf("expected empty rooms, got %d", len(hub.rooms))
	}
	if len(hub.presence) != 0 {
		t.Errorf("expected empty presence, got %d", len(hub.presence))
	}
}

// =============================================================================
// Register / Unregister
// =============================================================================

func TestHub_RegisterClient(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	go hub.Run()
	defer hub.Stop()

	hub.register <- client
	waitForBuffer()

	hub.mu.RLock()
	_, exists := hub.clients[client]
	hub.mu.RUnlock()
	if !exists {
		t.Error("client should be registered")
	}

	hub.mu.RLock()
	presenceClient, exists := hub.presence["user-1"]
	hub.mu.RUnlock()
	if !exists {
		t.Error("user should be in presence map")
	}
	if presenceClient != client {
		t.Error("presence should point to the same client")
	}
}

func TestHub_UnregisterClient(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	go hub.Run()
	defer hub.Stop()

	hub.register <- client
	waitForBuffer()

	hub.unregister <- client
	waitForBuffer()

	hub.mu.RLock()
	_, exists := hub.clients[client]
	hub.mu.RUnlock()
	if exists {
		t.Error("client should be removed after unregister")
	}

	// Send channel should be closed
	_, ok := <-client.Send
	if ok {
		t.Error("client.Send channel should be closed after unregister")
	}
}

func TestHub_RegisterMultipleClients(t *testing.T) {
	hub := NewHub(nil, nil)

	go hub.Run()
	defer hub.Stop()

	client1 := newTestClient(hub, "user-1", "Alice")
	client2 := newTestClient(hub, "user-2", "Bob")

	hub.register <- client1
	hub.register <- client2
	waitForBuffer()

	hub.mu.RLock()
	count := len(hub.clients)
	hub.mu.RUnlock()
	if count != 2 {
		t.Errorf("expected 2 clients, got %d", count)
	}
}

// =============================================================================
// Broadcast
// =============================================================================

func TestHub_BroadcastToAllClients(t *testing.T) {
	hub := NewHub(nil, nil)

	go hub.Run()
	defer hub.Stop()

	client1 := newTestClient(hub, "user-1", "Alice")
	client2 := newTestClient(hub, "user-2", "Bob")
	hub.register <- client1
	hub.register <- client2
	waitForBuffer()

	msg := []byte(`{"type":"test","data":{}}`)
	hub.broadcast <- msg
	waitForBuffer()

	select {
	case received := <-client1.Send:
		if string(received) != string(msg) {
			t.Errorf("client1 expected %q, got %q", string(msg), string(received))
		}
	default:
		t.Error("client1 should have received the message")
	}

	select {
	case received := <-client2.Send:
		if string(received) != string(msg) {
			t.Errorf("client2 expected %q, got %q", string(msg), string(received))
		}
	default:
		t.Error("client2 should have received the message")
	}
}

func TestHub_BroadcastToAll_FullBuffer_ClientRemoved(t *testing.T) {
	hub := NewHub(nil, nil)

	go hub.Run()
	defer hub.Stop()

	// Client with very small buffer to make it full
	client := &Client{
		Hub:      hub,
		Conn:     nil,
		Send:     make(chan []byte, 1),
		UserID:   "user-1",
		Username: "Alice",
		Rooms:    make(map[string]bool),
	}

	// Fill the buffer
	client.Send <- []byte(`{"type":"prev"}`)

	hub.register <- client
	waitForBuffer()

	hub.broadcast <- []byte(`{"type":"test"}`)
	waitForBuffer()

	// When a client's send buffer is full, the hub closes the channel
	// and removes the client — verify client was removed
	hub.mu.RLock()
	_, exists := hub.clients[client]
	hub.mu.RUnlock()
	if exists {
		t.Error("client should be removed when send buffer is full")
	}

	// Drain the buffered item first (channel is closed but buffered items are readable)
	<-client.Send

	// Now reading from closed channel with empty buffer returns zero value, ok=false
	_, ok := <-client.Send
	if ok {
		t.Error("client.Send should be closed after buffer overflow")
	}
}

// =============================================================================
// Rooms — Subscribe / Unsubscribe / BroadcastToRoom
// =============================================================================

func TestHub_SubscribeToRoom(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	hub.SubscribeToRoom(client, "room-1")

	hub.mu.RLock()
	roomClients, exists := hub.rooms["room-1"]
	hub.mu.RUnlock()
	if !exists {
		t.Fatal("room-1 should exist")
	}
	if !roomClients[client] {
		t.Error("client should be in room-1")
	}
	if !client.Rooms["room-1"] {
		t.Error("client.Rooms should contain room-1")
	}
}

func TestHub_UnsubscribeFromRoom(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	hub.SubscribeToRoom(client, "room-1")
	hub.UnsubscribeFromRoom(client, "room-1")

	hub.mu.RLock()
	_, exists := hub.rooms["room-1"]
	hub.mu.RUnlock()
	if exists {
		t.Error("room-1 should be deleted after last client unsubscribes")
	}
	if client.Rooms["room-1"] {
		t.Error("client.Rooms should not contain room-1")
	}
}

// H1: revoking a friendship must tear down live wall-room subscriptions, so an
// ex-friend stops receiving private wall events without reconnecting.
func TestHub_ForceUnsubscribeFromWallRooms(t *testing.T) {
	hub := NewHub(nil, nil)
	exFriend := newTestClient(hub, "user-b", "Bob")
	otherViewer := newTestClient(hub, "user-c", "Carol")
	owner := newTestClient(hub, "user-a", "Alice")

	// Both Bob and Carol are subscribed to Alice's wall room.
	hub.SubscribeToRoom(exFriend, "profile_wall_user-a")
	hub.SubscribeToRoom(otherViewer, "profile_wall_user-a")
	// Alice subscribed to Bob's wall room (reverse direction).
	hub.SubscribeToRoom(owner, "profile_wall_user-b")

	// Alice removes Bob from friends.
	hub.ForceUnsubscribeFromWallRooms("user-b", "user-a")
	hub.ForceUnsubscribeFromWallRooms("user-a", "user-b")

	hub.mu.RLock()
	_, exInRoom := hub.rooms["profile_wall_user-a"][exFriend]
	_, otherInRoom := hub.rooms["profile_wall_user-a"][otherViewer]
	_, ownerInReverse := hub.rooms["profile_wall_user-b"][owner]
	hub.mu.RUnlock()

	if exInRoom {
		t.Error("ex-friend Bob must be removed from Alice's wall room")
	}
	if !otherInRoom {
		t.Error("Carol (still authorized) must remain subscribed to Alice's wall room")
	}
	if ownerInReverse {
		t.Error("Alice must be removed from Bob's wall room after unfriending Bob")
	}
	if exFriend.Rooms["profile_wall_user-a"] {
		t.Error("client.Rooms must not keep the revoked room")
	}
	if !otherViewer.Rooms["profile_wall_user-a"] {
		t.Error("Carol's client.Rooms must keep the room")
	}
}

// M1: revoking a friendship must also tear down live now-playing room
// subscriptions, so an ex-friend stops receiving a private-profile user's
// realtime Spotify now-playing events without reconnecting.
func TestHub_ForceUnsubscribeFromNowPlayingRooms(t *testing.T) {
	hub := NewHub(nil, nil)
	exFriend := newTestClient(hub, "user-b", "Bob")
	otherViewer := newTestClient(hub, "user-c", "Carol")
	owner := newTestClient(hub, "user-a", "Alice")

	// Both Bob and Carol are subscribed to Alice's now-playing room; Alice is
	// subscribed to Bob's now-playing room (reverse direction).
	hub.SubscribeToRoom(exFriend, "profile_now_playing_user-a")
	hub.SubscribeToRoom(otherViewer, "profile_now_playing_user-a")
	hub.SubscribeToRoom(owner, "profile_now_playing_user-b")

	// Alice removes Bob from friends.
	hub.ForceUnsubscribeFromNowPlayingRooms("user-b", "user-a")
	hub.ForceUnsubscribeFromNowPlayingRooms("user-a", "user-b")

	hub.mu.RLock()
	_, exInRoom := hub.rooms["profile_now_playing_user-a"][exFriend]
	_, otherInRoom := hub.rooms["profile_now_playing_user-a"][otherViewer]
	_, ownerInReverse := hub.rooms["profile_now_playing_user-b"][owner]
	hub.mu.RUnlock()

	if exInRoom {
		t.Error("ex-friend Bob must be removed from Alice's now-playing room")
	}
	if !otherInRoom {
		t.Error("Carol (still authorized) must remain subscribed to Alice's now-playing room")
	}
	if ownerInReverse {
		t.Error("Alice must be removed from Bob's now-playing room after unfriending Bob")
	}
	if exFriend.Rooms["profile_now_playing_user-a"] {
		t.Error("client.Rooms must not keep the revoked now-playing room")
	}
	if !otherViewer.Rooms["profile_now_playing_user-a"] {
		t.Error("Carol's client.Rooms must keep the now-playing room")
	}
}

func TestHub_ForceUnsubscribeFromNowPlayingRooms_UnknownUsersNoop(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-b", "Bob")
	hub.SubscribeToRoom(client, "profile_now_playing_user-a")

	// Empty or unrelated IDs must not panic or remove anything.
	hub.ForceUnsubscribeFromNowPlayingRooms("", "user-a")
	hub.ForceUnsubscribeFromNowPlayingRooms("user-b", "")
	hub.ForceUnsubscribeFromNowPlayingRooms("user-x", "user-a")

	hub.mu.RLock()
	_, stillIn := hub.rooms["profile_now_playing_user-a"][client]
	hub.mu.RUnlock()
	if !stillIn {
		t.Error("Bob must remain subscribed when the call targets other users")
	}
}

func TestHub_ForceUnsubscribeFromWallRooms_UnknownUsersNoop(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-b", "Bob")
	hub.SubscribeToRoom(client, "profile_wall_user-a")

	// Empty or unrelated IDs must not panic or remove anything.
	hub.ForceUnsubscribeFromWallRooms("", "user-a")
	hub.ForceUnsubscribeFromWallRooms("user-b", "")
	hub.ForceUnsubscribeFromWallRooms("user-x", "user-a")

	hub.mu.RLock()
	_, stillIn := hub.rooms["profile_wall_user-a"][client]
	hub.mu.RUnlock()
	if !stillIn {
		t.Error("Bob must remain subscribed when the call targets other users")
	}
}

// H1-chat: leaving a conversation / being removed from a group must tear down
// the live chat-room subscription, so the ex-member stops receiving decrypted
// chat messages without reconnecting.
func TestHub_ForceUnsubscribeFromChatRooms(t *testing.T) {
	hub := NewHub(nil, nil)
	leaver := newTestClient(hub, "user-b", "Bob")
	otherMember := newTestClient(hub, "user-c", "Carol")

	// Bob and Carol are subscribed to the group chat room; Bob also has another
	// unrelated chat room subscription that must survive.
	hub.SubscribeToRoom(leaver, "chat_conv-abc")
	hub.SubscribeToRoom(otherMember, "chat_conv-abc")
	hub.SubscribeToRoom(leaver, "chat_conv-other")

	// Bob leaves / is removed from conv-abc.
	hub.ForceUnsubscribeFromChatRooms("user-b", "conv-abc")

	hub.mu.RLock()
	_, leaverInRoom := hub.rooms["chat_conv-abc"][leaver]
	_, otherInRoom := hub.rooms["chat_conv-abc"][otherMember]
	hub.mu.RUnlock()

	if leaverInRoom {
		t.Error("ex-member Bob must be removed from chat_conv-abc")
	}
	if !otherInRoom {
		t.Error("Carol (still a member) must remain subscribed to chat_conv-abc")
	}
	if leaver.Rooms["chat_conv-abc"] {
		t.Error("client.Rooms must not keep the revoked chat room")
	}
	if !leaver.Rooms["chat_conv-other"] {
		t.Error("unrelated chat room subscription must survive")
	}
}

func TestHub_ForceUnsubscribeFromChatRooms_EmptyIDsNoop(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-b", "Bob")
	hub.SubscribeToRoom(client, "chat_conv-abc")

	// Empty or unrelated IDs must not panic or remove anything.
	hub.ForceUnsubscribeFromChatRooms("", "conv-abc")
	hub.ForceUnsubscribeFromChatRooms("user-b", "")
	hub.ForceUnsubscribeFromChatRooms("user-x", "conv-abc")
	hub.ForceUnsubscribeFromChatRooms("user-b", "conv-other")

	hub.mu.RLock()
	_, stillIn := hub.rooms["chat_conv-abc"][client]
	hub.mu.RUnlock()
	if !stillIn {
		t.Error("Bob must remain subscribed when the call targets other conversations")
	}
}

func TestHub_BroadcastToRoom(t *testing.T) {
	hub := NewHub(nil, nil)
	client1 := newTestClient(hub, "user-1", "Alice")
	client2 := newTestClient(hub, "user-2", "Bob")

	hub.SubscribeToRoom(client1, "room-1")
	hub.SubscribeToRoom(client2, "room-1")

	msg := []byte(`{"type":"room_msg"}`)
	hub.BroadcastToRoom("room-1", msg)
	waitForBuffer()

	select {
	case received := <-client1.Send:
		if string(received) != string(msg) {
			t.Errorf("client1 expected %q, got %q", string(msg), string(received))
		}
	default:
		t.Error("client1 should have received room message")
	}

	select {
	case received := <-client2.Send:
		if string(received) != string(msg) {
			t.Errorf("client2 expected %q, got %q", string(msg), string(received))
		}
	default:
		t.Error("client2 should have received room message")
	}
}

func TestHub_BroadcastToRoom_OnlySubscribedClients(t *testing.T) {
	hub := NewHub(nil, nil)
	subscribed := newTestClient(hub, "user-1", "Alice")
	unsubscribed := newTestClient(hub, "user-2", "Bob")

	hub.SubscribeToRoom(subscribed, "room-1")
	// unsubscribed is not in room-1

	msg := []byte(`{"type":"room_msg"}`)
	hub.BroadcastToRoom("room-1", msg)
	waitForBuffer()

	select {
	case <-subscribed.Send:
		// expected
	default:
		t.Error("subscribed client should receive the message")
	}

	select {
	case <-unsubscribed.Send:
		t.Error("unsubscribed client should NOT receive the message")
	default:
		// expected — no message
	}
}

func TestHub_BroadcastToRoom_NonExistentRoom(t *testing.T) {
	hub := NewHub(nil, nil)

	// Should not panic
	hub.BroadcastToRoom("nonexistent", []byte(`{"type":"test"}`))
}

func TestHub_MultipleRooms(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	hub.SubscribeToRoom(client, "room-a")
	hub.SubscribeToRoom(client, "room-b")

	hub.mu.RLock()
	roomAClients := hub.rooms["room-a"]
	roomBClients := hub.rooms["room-b"]
	hub.mu.RUnlock()

	if !roomAClients[client] {
		t.Error("client should be in room-a")
	}
	if !roomBClients[client] {
		t.Error("client should be in room-b")
	}
}

// =============================================================================
// Presence — GetOnlineUsers / GetClientByUserID
// =============================================================================

func TestHub_GetOnlineUsers_Empty(t *testing.T) {
	hub := NewHub(nil, nil)

	users := hub.GetOnlineUsers()
	if len(users) != 0 {
		t.Errorf("expected 0 online users, got %d", len(users))
	}
}

func TestHub_GetOnlineUsers_AfterRegister(t *testing.T) {
	hub := NewHub(nil, nil)

	go hub.Run()
	defer hub.Stop()

	client := newTestClient(hub, "user-1", "Alice")
	hub.register <- client
	waitForBuffer()

	users := hub.GetOnlineUsers()
	if len(users) != 1 {
		t.Errorf("expected 1 online user, got %d", len(users))
	}
	if users[0] != "user-1" {
		t.Errorf("expected 'user-1', got %q", users[0])
	}
}

func TestHub_GetOnlineUsers_AfterUnregister(t *testing.T) {
	hub := NewHub(nil, nil)

	go hub.Run()
	defer hub.Stop()

	client := newTestClient(hub, "user-1", "Alice")
	hub.register <- client
	waitForBuffer()

	hub.unregister <- client
	waitForBuffer()

	users := hub.GetOnlineUsers()
	if len(users) != 0 {
		t.Errorf("expected 0 online users after unregister, got %d", len(users))
	}
}

func TestHub_GetClientByUserID_Exists(t *testing.T) {
	hub := NewHub(nil, nil)

	go hub.Run()
	defer hub.Stop()

	client := newTestClient(hub, "user-42", "Alice")
	hub.register <- client
	waitForBuffer()

	found := hub.GetClientByUserID("user-42")
	if found == nil {
		t.Fatal("client should be found")
	}
	if found != client {
		t.Error("should return the same client pointer")
	}
}

func TestHub_GetClientByUserID_NotExists(t *testing.T) {
	hub := NewHub(nil, nil)

	found := hub.GetClientByUserID("nonexistent")
	if found != nil {
		t.Error("should return nil for nonexistent user")
	}
}

// =============================================================================
// CheckOrigin
// =============================================================================

func TestCheckOrigin_AllowedOrigin(t *testing.T) {
	hub := NewHub(nil, []string{"https://example.com"})

	r := httptest.NewRequest("GET", "/ws", nil)
	r.Header.Set("Origin", "https://example.com")

	if !hub.CheckOrigin(r) {
		t.Error("origin should be allowed")
	}
}

func TestCheckOrigin_DisallowedOrigin(t *testing.T) {
	hub := NewHub(nil, []string{"https://example.com"})

	r := httptest.NewRequest("GET", "/ws", nil)
	r.Header.Set("Origin", "https://evil.com")

	if hub.CheckOrigin(r) {
		t.Error("origin should NOT be allowed")
	}
}

func TestCheckOrigin_EmptyOrigin(t *testing.T) {
	hub := NewHub(nil, []string{"https://example.com"})

	r := httptest.NewRequest("GET", "/ws", nil)

	if !hub.CheckOrigin(r) {
		t.Error("empty origin should be allowed (non-browser clients)")
	}
}

func TestCheckOrigin_DefaultAllowedOrigins(t *testing.T) {
	hub := NewHub(nil, nil)

	tests := []struct {
		origin  string
		allowed bool
	}{
		{"http://localhost:5173", true},
		{"http://localhost:8080", true},
		{"http://evil.com", false},
		{"https://example.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.origin, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/ws", nil)
			r.Header.Set("Origin", tt.origin)

			result := hub.CheckOrigin(r)
			if result != tt.allowed {
				t.Errorf("origin %q: expected allowed=%v, got %v", tt.origin, tt.allowed, result)
			}
		})
	}
}

// =============================================================================
// Publish helpers (with nil redis — should be no-ops)
// =============================================================================

func TestHub_PublishToRedis_NilRedis(t *testing.T) {
	hub := NewHub(nil, nil)

	err := hub.PublishToRedis("test:channel", RealtimeEvent{
		Type:    "test",
		Payload: "hello",
	})
	if err != nil {
		t.Errorf("expected nil error with nil redis, got %v", err)
	}
}

func TestHub_PublishNewPost_NilRedis(t *testing.T) {
	hub := NewHub(nil, nil)

	err := hub.PublishNewPost(map[string]string{"id": "post-1"})
	if err != nil {
		t.Errorf("expected nil error with nil redis, got %v", err)
	}
}

func TestHub_PublishNewThread_NilRedis(t *testing.T) {
	hub := NewHub(nil, nil)
	err := hub.PublishNewThread(map[string]string{"id": "thread-1"})
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestHub_PublishNewChatMessage_NilRedis(t *testing.T) {
	hub := NewHub(nil, nil)
	err := hub.PublishNewChatMessage(map[string]string{"id": "msg-1"})
	if err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

// =============================================================================
// SetDB
// =============================================================================

func TestHub_SetDB(t *testing.T) {
	hub := NewHub(nil, nil)

	if hub.db != nil {
		t.Error("db should be nil initially")
	}

	hub.SetDB(nil)
	if hub.db != nil {
		t.Errorf("expected nil, got %v", hub.db)
	}
}

// =============================================================================
// Concurrent room operations
// =============================================================================

func TestHub_ConcurrentRoomOperations(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "shared-room")

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hub.SubscribeToRoom(newTestClient(hub, "user-x", "X"), "shared-room")
		}()
	}
	wg.Wait()
	waitForBuffer()

	hub.mu.RLock()
	count := len(hub.rooms["shared-room"])
	hub.mu.RUnlock()
	if count != 21 {
		t.Errorf("expected 21 clients in shared-room, got %d", count)
	}
}

// =============================================================================
// extractRoomID — unit tests (no hub needed)
// =============================================================================

func TestExtractRoomID_StringValue(t *testing.T) {
	payload := map[string]interface{}{"thread_id": "thread-123"}
	result := extractRoomID(payload, "thread_id")
	if result != "thread-123" {
		t.Errorf("expected 'thread-123', got %q", result)
	}
}

func TestExtractRoomID_MissingKey(t *testing.T) {
	payload := map[string]interface{}{"other_key": "value"}
	result := extractRoomID(payload, "thread_id")
	if result != "" {
		t.Errorf("expected empty string for missing key, got %q", result)
	}
}

func TestExtractRoomID_ValueNotString(t *testing.T) {
	payload := map[string]interface{}{"thread_id": 12345}
	result := extractRoomID(payload, "thread_id")
	if result != "" {
		t.Errorf("expected empty string when value is not string, got %q", result)
	}
}

func TestExtractRoomID_NonMapPayload(t *testing.T) {
	result := extractRoomID("string payload", "thread_id")
	if result != "" {
		t.Errorf("expected empty string for non-map payload, got %q", result)
	}
}

func TestExtractRoomID_NilPayload(t *testing.T) {
	result := extractRoomID(nil, "thread_id")
	if result != "" {
		t.Errorf("expected empty string for nil payload, got %q", result)
	}
}

func TestExtractRoomID_EmptyMap(t *testing.T) {
	payload := map[string]interface{}{}
	result := extractRoomID(payload, "thread_id")
	if result != "" {
		t.Errorf("expected empty string for empty map, got %q", result)
	}
}

func TestExtractRoomID_EmptyStringValue(t *testing.T) {
	payload := map[string]interface{}{"thread_id": ""}
	result := extractRoomID(payload, "thread_id")
	if result != "" {
		t.Errorf("expected empty string for empty value, got %q", result)
	}
}

// =============================================================================
// handleRedisEvent — tests event routing through hub rooms
// =============================================================================

func TestHandleRedisEvent_NewThread(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "feed")

	event := RealtimeEvent{
		Type: MessageTypeNewThread,
		Payload: map[string]interface{}{
			"id":    "thread-1",
			"title": "Hello",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "new_thread") {
			t.Errorf("expected message type 'new_thread', got: %s", string(msg))
		}
		if !containsStr(string(msg), "thread-1") {
			t.Errorf("expected payload with thread-1, got: %s", string(msg))
		}
	default:
		t.Error("client in 'feed' room should receive NewThread event")
	}
}

// H3: a thread created on a private board must never reach the global feed
// room (any authenticated client can subscribe to "feed"), even though the
// board room still receives the event to refresh that board's page.
func TestHandleRedisEvent_NewThread_PrivateVisibilitySkipsFeed(t *testing.T) {
	hub := NewHub(nil, nil)
	feedClient := newTestClient(hub, "user-1", "Alice")
	boardClient := newTestClient(hub, "user-2", "Bob")
	hub.SubscribeToRoom(feedClient, "feed")
	hub.SubscribeToRoom(boardClient, "board_board-priv")

	event := RealtimeEvent{
		Type: MessageTypeNewThread,
		Payload: map[string]interface{}{
			"id":         "thread-1",
			"board_id":   "board-priv",
			"title":      "Secret private thread",
			"visibility": "private",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case <-feedClient.Send:
		t.Error("feed client must NOT receive a private board thread event")
	default:
		// expected — private board content must not leak to the global feed
	}

	select {
	case msg := <-boardClient.Send:
		if !containsStr(string(msg), "new_thread") {
			t.Errorf("expected 'new_thread' in board room, got: %s", string(msg))
		}
	default:
		t.Error("board room client should receive the event")
	}
}

func TestHandleRedisEvent_NewThread_PublicVisibilityReachesFeed(t *testing.T) {
	hub := NewHub(nil, nil)
	feedClient := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(feedClient, "feed")

	event := RealtimeEvent{
		Type: MessageTypeNewThread,
		Payload: map[string]interface{}{
			"id":         "thread-1",
			"board_id":   "board-pub",
			"title":      "Public thread",
			"visibility": "public",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-feedClient.Send:
		if !containsStr(string(msg), "new_thread") {
			t.Errorf("expected 'new_thread', got: %s", string(msg))
		}
	default:
		t.Error("public board thread should reach the feed room")
	}
}

func TestHandleRedisEvent_NewPost_ToThreadAndFeed(t *testing.T) {
	hub := NewHub(nil, nil)
	clientFeed := newTestClient(hub, "user-1", "Alice")
	clientThread := newTestClient(hub, "user-2", "Bob")
	hub.SubscribeToRoom(clientFeed, "feed")
	hub.SubscribeToRoom(clientThread, "thread_thread-42")

	event := RealtimeEvent{
		Type: MessageTypeNewPost,
		Payload: map[string]interface{}{
			"id":        "post-1",
			"thread_id": "thread-42",
			"content":   "Test post",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	// Client in 'feed' should receive
	select {
	case msg := <-clientFeed.Send:
		if !containsStr(string(msg), "new_post") {
			t.Errorf("feed client expected 'new_post', got: %s", string(msg))
		}
	default:
		t.Error("feed client should receive NewPost event")
	}

	// Client in 'thread-42' should receive
	select {
	case msg := <-clientThread.Send:
		if !containsStr(string(msg), "new_post") {
			t.Errorf("thread client expected 'new_post', got: %s", string(msg))
		}
	default:
		t.Error("thread client should receive NewPost event")
	}
}

func TestHandleRedisEvent_NewPost_NoThreadID(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "feed")

	event := RealtimeEvent{
		Type: MessageTypeNewPost,
		Payload: map[string]interface{}{
			"id":      "post-1",
			"content": "No thread id",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	// Should still broadcast to feed even without thread_id
	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "new_post") {
			t.Errorf("expected 'new_post', got: %s", string(msg))
		}
	default:
		t.Error("feed client should receive NewPost even without thread_id")
	}
}

func TestHandleRedisEvent_Like(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "thread_thread-99")

	event := RealtimeEvent{
		Type: MessageTypeLike,
		Payload: map[string]interface{}{
			"post_id":   "post-5",
			"thread_id": "thread-99",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "like") {
			t.Errorf("expected 'like', got: %s", string(msg))
		}
	default:
		t.Error("client in thread-99 should receive Like event")
	}
}

func TestHandleRedisEvent_Unlike(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "thread_thread-99")

	event := RealtimeEvent{
		Type: MessageTypeUnlike,
		Payload: map[string]interface{}{
			"post_id":   "post-5",
			"thread_id": "thread-99",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "unlike") {
			t.Errorf("expected 'unlike', got: %s", string(msg))
		}
	default:
		t.Error("client in thread-99 should receive Unlike event")
	}
}

func TestHandleRedisEvent_NewWallPost(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "profile_wall_user-42")

	event := RealtimeEvent{
		Type: MessageTypeNewWallPost,
		Payload: map[string]interface{}{
			"id":      "wall-1",
			"user_id": "user-42",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "new_wall_post") {
			t.Errorf("expected 'new_wall_post', got: %s", string(msg))
		}
	default:
		t.Error("client in profile_wall_user-42 should receive NewWallPost event")
	}
}

func TestHandleRedisEvent_UpdateWallPost(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "profile_wall_user-42")

	event := RealtimeEvent{
		Type: MessageTypeUpdateWallPost,
		Payload: map[string]interface{}{
			"id":      "wall-1",
			"user_id": "user-42",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "update_wall_post") {
			t.Errorf("expected 'update_wall_post', got: %s", string(msg))
		}
	default:
		t.Error("client in profile_wall_user-42 should receive UpdateWallPost event")
	}
}

func TestHandleRedisEvent_DeleteWallPost(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "profile_wall_user-42")

	event := RealtimeEvent{
		Type: MessageTypeDeleteWallPost,
		Payload: map[string]interface{}{
			"id":      "wall-1",
			"user_id": "user-42",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "delete_wall_post") {
			t.Errorf("expected 'delete_wall_post', got: %s", string(msg))
		}
	default:
		t.Error("client in profile_wall_user-42 should receive DeleteWallPost event")
	}
}

func TestHandleRedisEvent_NewChatMessage(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "chat_conv-abc")

	event := RealtimeEvent{
		Type: MessageTypeNewChatMessage,
		Payload: map[string]interface{}{
			"id":              "msg-1",
			"conversation_id": "conv-abc",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "new_chat_message") {
			t.Errorf("expected 'new_chat_message', got: %s", string(msg))
		}
	default:
		t.Error("client in chat_conv-abc should receive NewChatMessage event")
	}
}

// M2: presence events are room-scoped. Only subscribers of the target's
// presence room receive them — there is no global presence feed anymore.
func TestHandleRedisEvent_UserOnline_RoomTargeted(t *testing.T) {
	hub := NewHub(nil, nil)
	subscribed := newTestClient(hub, "user-1", "Alice")
	unrelated := newTestClient(hub, "user-2", "Bob")
	hub.SubscribeToRoom(subscribed, "presence_user-42")

	go hub.Run()
	defer hub.Stop()

	hub.register <- subscribed
	hub.register <- unrelated
	waitForBuffer()

	event := RealtimeEvent{
		Type: MessageTypeUserOnline,
		Payload: map[string]interface{}{
			"user_id":  "user-42",
			"username": "Bob",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-subscribed.Send:
		if !containsStr(string(msg), "user_online") {
			t.Errorf("expected 'user_online', got: %s", string(msg))
		}
	default:
		t.Error("presence room subscriber should receive UserOnline event")
	}

	select {
	case <-unrelated.Send:
		t.Error("client not subscribed to the presence room must NOT receive the event")
	default:
		// expected — presence delivery is subscription-only
	}
}

func TestHandleRedisEvent_UserOffline_RoomTargeted(t *testing.T) {
	hub := NewHub(nil, nil)
	subscribed := newTestClient(hub, "user-1", "Alice")
	unrelated := newTestClient(hub, "user-2", "Bob")
	hub.SubscribeToRoom(subscribed, "presence_user-42")

	go hub.Run()
	defer hub.Stop()

	hub.register <- subscribed
	hub.register <- unrelated
	waitForBuffer()

	event := RealtimeEvent{
		Type: MessageTypeUserOffline,
		Payload: map[string]interface{}{
			"user_id":  "user-42",
			"username": "Bob",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-subscribed.Send:
		if !containsStr(string(msg), "user_offline") {
			t.Errorf("expected 'user_offline', got: %s", string(msg))
		}
	default:
		t.Error("presence room subscriber should receive UserOffline event")
	}

	select {
	case <-unrelated.Send:
		t.Error("client not subscribed to the presence room must NOT receive the event")
	default:
		// expected — presence delivery is subscription-only
	}
}

func TestHandleRedisEvent_UnknownType_BroadcastAll(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	go hub.Run()
	defer hub.Stop()

	hub.register <- client
	waitForBuffer()

	event := RealtimeEvent{
		Type: "custom_event",
		Payload: map[string]interface{}{
			"data": "test",
		},
	}

	hub.handleRedisEvent(event)
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "custom_event") {
			t.Errorf("expected 'custom_event', got: %s", string(msg))
		}
	default:
		t.Error("client should receive unknown events via broadcast")
	}
}

func TestHandleRedisEvent_WallPost_NoUserID(t *testing.T) {
	hub := NewHub(nil, nil)

	event := RealtimeEvent{
		Type: MessageTypeNewWallPost,
		Payload: map[string]interface{}{
			"id": "wall-1",
			// no user_id
		},
	}

	// Should not panic, just no broadcast (no client subscribed without user_id)
	hub.handleRedisEvent(event)
}

func TestHandleRedisEvent_ChatMessage_NoConversationID(t *testing.T) {
	hub := NewHub(nil, nil)

	event := RealtimeEvent{
		Type: MessageTypeNewChatMessage,
		Payload: map[string]interface{}{
			"id": "msg-1",
			// no conversation_id
		},
	}

	// Should not panic
	hub.handleRedisEvent(event)
}

func TestHandleRedisEvent_JSONMarshalError(t *testing.T) {
	hub := NewHub(nil, nil)

	// Payload with a channel (can't be marshaled) should be handled gracefully
	event := RealtimeEvent{
		Type:    MessageTypeNewThread,
		Payload: make(chan int),
	}

	// Should not panic
	hub.handleRedisEvent(event)
}

// containsStr is a helper to check substring in handleRedisEvent tests
func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// TestHub_SlowClientsStress verifies that repeatedly broadcasting to clients
// that never drain their buffers removes them promptly and leaves every room
// index clean. Run with -race to exercise the close/send synchronization.
func TestHub_SlowClientsStress(t *testing.T) {
	hub := NewHub(nil, nil)
	go hub.Run()
	defer hub.Stop()

	const clientCount = 32
	clients := make([]*Client, 0, clientCount)
	for i := 0; i < clientCount; i++ {
		client := &Client{
			Hub:      hub,
			Send:     make(chan []byte, 2),
			UserID:   "slow-user",
			Username: "slow",
			Rooms:    make(map[string]bool),
		}
		client.Send <- []byte("already queued")
		client.Send <- []byte("still queued")
		hub.SubscribeToRoom(client, "slow-room")
		hub.register <- client
		deadline := time.Now().Add(time.Second)
		for {
			hub.mu.RLock()
			_, registered := hub.clients[client]
			hub.mu.RUnlock()
			if registered {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("client %d was not registered", i)
			}
			time.Sleep(time.Millisecond)
		}
		clients = append(clients, client)
	}

	// Exercise the shared broadcast channel handled by Hub.Run.
	hub.broadcast <- []byte("overflow-all")
	deadline := time.Now().Add(time.Second)
	for {
		hub.mu.RLock()
		registered := len(hub.clients)
		hub.mu.RUnlock()
		if registered == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("shared broadcast did not remove slow clients: %d remain", registered)
		}
		time.Sleep(time.Millisecond)
	}

	// Exercise the room-specific path with a separately registered slow client.
	roomClient := &Client{
		Hub:      hub,
		Send:     make(chan []byte, 1),
		UserID:   "slow-room-user",
		Username: "slow-room",
		Rooms:    make(map[string]bool),
	}
	roomClient.Send <- []byte("queued")
	hub.SubscribeToRoom(roomClient, "slow-room")
	hub.register <- roomClient
	deadline = time.Now().Add(time.Second)
	for {
		hub.mu.RLock()
		_, registered := hub.clients[roomClient]
		hub.mu.RUnlock()
		if registered {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("room client was not registered")
		}
		time.Sleep(time.Millisecond)
	}
	hub.BroadcastToRoom("slow-room", []byte("overflow-room"))
	hub.BroadcastToRoom("slow-room", []byte("after-cleanup"))

	hub.mu.RLock()
	remaining := len(hub.rooms["slow-room"])
	registered := len(hub.clients)
	hub.mu.RUnlock()
	if remaining != 0 || registered != 0 {
		t.Fatalf("slow clients were not fully removed: room=%d clients=%d", remaining, registered)
	}

	for _, client := range clients {
		for range client.Send {
		}
	}
	for range roomClient.Send {
	}
}

// precommit_test: this comment is here to test the pre-commit hook
