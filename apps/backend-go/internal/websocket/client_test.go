package websocket

import (
	"encoding/json"
	"testing"
)

// =============================================================================
// parseRoomFromData
// =============================================================================

func TestParseRoomFromData_String(t *testing.T) {
	data := json.RawMessage(`"room-42"`)
	room, ok := parseRoomFromData(data)

	if !ok {
		t.Fatal("should parse successfully")
	}
	if room != "room-42" {
		t.Errorf("expected 'room-42', got %q", room)
	}
}

func TestParseRoomFromData_ObjectWithRoomField(t *testing.T) {
	data := json.RawMessage(`{"room":"room-99","extra":"value"}`)
	room, ok := parseRoomFromData(data)

	if !ok {
		t.Fatal("should parse successfully")
	}
	if room != "room-99" {
		t.Errorf("expected 'room-99', got %q", room)
	}
}

func TestParseRoomFromData_EmptyData(t *testing.T) {
	data := json.RawMessage{}
	room, ok := parseRoomFromData(data)

	if ok {
		t.Error("should return false for empty data")
	}
	if room != "" {
		t.Errorf("expected empty room, got %q", room)
	}
}

func TestParseRoomFromData_NilData(t *testing.T) {
	var data json.RawMessage
	// nil RawMessage has len 0
	room, ok := parseRoomFromData(data)

	if ok {
		t.Error("should return false for nil data")
	}
	if room != "" {
		t.Errorf("expected empty room, got %q", room)
	}
}

func TestParseRoomFromData_InvalidJSON(t *testing.T) {
	data := json.RawMessage(`not json`)
	room, ok := parseRoomFromData(data)

	if ok {
		t.Error("should return false for invalid JSON")
	}
	if room != "" {
		t.Errorf("expected empty room, got %q", room)
	}
}

func TestParseRoomFromData_ObjectWithoutRoomField(t *testing.T) {
	data := json.RawMessage(`{"other":"value"}`)
	room, ok := parseRoomFromData(data)

	if !ok {
		t.Error("should parse successfully (valid JSON object)")
	}
	if room != "" {
		t.Errorf("expected empty room (no room field), got %q", room)
	}
}

func TestParseRoomFromData_EmptyRoomString(t *testing.T) {
	data := json.RawMessage(`""`)
	room, ok := parseRoomFromData(data)

	if !ok {
		t.Fatal("should parse successfully for empty string")
	}
	if room != "" {
		t.Errorf("expected empty room, got %q", room)
	}
}

// =============================================================================
// mustMarshalJSON
// =============================================================================

func TestMustMarshalJSON_ValidData(t *testing.T) {
	result := mustMarshalJSON(map[string]string{"key": "value"})

	var decoded map[string]string
	if err := json.Unmarshal(result, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded["key"] != "value" {
		t.Errorf("expected 'value', got %q", decoded["key"])
	}
}

func TestMustMarshalJSON_NilData(t *testing.T) {
	result := mustMarshalJSON(nil)

	if string(result) != "null" {
		t.Errorf("expected 'null', got %q", string(result))
	}
}

func TestMustMarshalJSON_Array(t *testing.T) {
	result := mustMarshalJSON([]string{"a", "b", "c"})

	var decoded []string
	if err := json.Unmarshal(result, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded) != 3 {
		t.Errorf("expected 3 items, got %d", len(decoded))
	}
}

func TestMustMarshalJSON_Integer(t *testing.T) {
	result := mustMarshalJSON(42)

	var decoded int
	if err := json.Unmarshal(result, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded != 42 {
		t.Errorf("expected 42, got %d", decoded)
	}
}

// =============================================================================
// sendConfirmation
// =============================================================================

func TestSendConfirmation_Subscribe(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	client.sendConfirmation("subscribe", "room-1")
	waitForBuffer()

	select {
	case msg := <-client.Send:
		var result Message
		if err := json.Unmarshal(msg, &result); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if result.Type != "confirmation" {
			t.Errorf("expected type 'confirmation', got %q", result.Type)
		}
		var action struct {
			Action string `json:"action"`
			Room   string `json:"room"`
		}
		if err := json.Unmarshal(result.Data, &action); err != nil {
			t.Fatalf("unmarshal data: %v", err)
		}
		if action.Action != "subscribe" {
			t.Errorf("expected action 'subscribe', got %q", action.Action)
		}
		if action.Room != "room-1" {
			t.Errorf("expected room 'room-1', got %q", action.Room)
		}
	default:
		t.Error("should have received confirmation message")
	}
}

func TestSendConfirmation_Unsubscribe(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	client.sendConfirmation("unsubscribe", "room-42")

	select {
	case msg := <-client.Send:
		var result Message
		if err := json.Unmarshal(msg, &result); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		var action struct {
			Action string `json:"action"`
			Room   string `json:"room"`
		}
		if err := json.Unmarshal(result.Data, &action); err != nil {
			t.Fatalf("unmarshal data: %v", err)
		}
		if action.Action != "unsubscribe" {
			t.Errorf("expected action 'unsubscribe', got %q", action.Action)
		}
		if action.Room != "room-42" {
			t.Errorf("expected room 'room-42', got %q", action.Room)
		}
	default:
		t.Error("should have received confirmation message")
	}
}

// =============================================================================
// Client creation
// =============================================================================

func TestNewClient_DefaultFields(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")

	if client.Hub != hub {
		t.Error("client.Hub should be set")
	}
	if client.UserID != "user-1" {
		t.Errorf("expected 'user-1', got %q", client.UserID)
	}
	if client.Username != "Alice" {
		t.Errorf("expected 'Alice', got %q", client.Username)
	}
	if client.Send == nil {
		t.Error("Send channel should be initialized")
	}
	if client.Rooms == nil {
		t.Error("Rooms map should be initialized")
	}
}
