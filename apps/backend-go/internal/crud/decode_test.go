package crud

import "testing"

// ─── DecodeJSONB ─────────────────────────────────────────────────────────────

func TestDecodeJSONB_Nil(t *testing.T) {
	result := DecodeJSONB(nil)
	if result != nil {
		t.Fatalf("expected nil, got %v", result)
	}
}

func TestDecodeJSONB_ByteSliceJSON(t *testing.T) {
	input := []byte(`{"key": "value", "num": 42}`)
	result := DecodeJSONB(input)

	parsed, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map[string]interface{}, got %T: %v", result, result)
	}
	if parsed["key"] != "value" {
		t.Fatalf("expected 'value', got %v", parsed["key"])
	}
	if parsed["num"] != float64(42) {
		t.Fatalf("expected 42.0, got %v (%T)", parsed["num"], parsed["num"])
	}
}

func TestDecodeJSONB_ByteSlicePlain(t *testing.T) {
	input := []byte(`plain text, not json`)
	result := DecodeJSONB(input)
	if result != "plain text, not json" {
		t.Fatalf("expected 'plain text, not json', got %q", result)
	}
}

func TestDecodeJSONB_ByteSliceEmpty(t *testing.T) {
	input := []byte{}
	result := DecodeJSONB(input)
	if result != "" {
		t.Fatalf("expected empty string, got %q", result)
	}
}

func TestDecodeJSONB_StringJSON(t *testing.T) {
	input := `{"array": [1, 2, 3], "nested": {"a": 1}}`
	result := DecodeJSONB(input)

	parsed, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map[string]interface{}, got %T: %v", result, result)
	}

	arr, ok := parsed["array"].([]interface{})
	if !ok || len(arr) != 3 || arr[0] != float64(1) {
		t.Fatalf("unexpected array: %v", parsed["array"])
	}
}

func TestDecodeJSONB_StringPlain(t *testing.T) {
	input := `just a regular string`
	result := DecodeJSONB(input)
	if result != "just a regular string" {
		t.Fatalf("expected 'just a regular string', got %q", result)
	}
}

func TestDecodeJSONB_StringNumber(t *testing.T) {
	input := `42`
	result := DecodeJSONB(input)
	expected := float64(42)
	if result != expected {
		t.Fatalf("expected %v (float64), got %v (%T)", expected, result, result)
	}
}

func TestDecodeJSONB_StringBool(t *testing.T) {
	input := `true`
	result := DecodeJSONB(input)
	if result != true && result != "true" {
		t.Fatalf("expected true (bool) or 'true' (string), got %v (%T)", result, result)
	}
}

func TestDecodeJSONB_StringArray(t *testing.T) {
	input := `[1, "two", 3.0]`
	result := DecodeJSONB(input)

	parsed, ok := result.([]interface{})
	if !ok {
		t.Fatalf("expected []interface{}, got %T: %v", result, result)
	}
	if len(parsed) != 3 {
		t.Fatalf("expected 3 elements, got %d", len(parsed))
	}
}

func TestDecodeJSONB_OtherTypeInt(t *testing.T) {
	result := DecodeJSONB(42)
	if result != 42 {
		t.Fatalf("expected 42, got %v", result)
	}
}

func TestDecodeJSONB_OtherTypeMap(t *testing.T) {
	input := map[string]string{"already": "parsed"}
	result := DecodeJSONB(input)
	m, ok := result.(map[string]string)
	if !ok || m["already"] != "parsed" {
		t.Fatalf("expected original map, got %v", result)
	}
}

// ─── DecodeJSONBMap ──────────────────────────────────────────────────────────

func TestDecodeJSONBMap_Object(t *testing.T) {
	m := DecodeJSONBMap([]byte(`{"a": 1, "b": "x"}`))
	if m["a"] != float64(1) || m["b"] != "x" {
		t.Fatalf("unexpected map: %v", m)
	}
}

func TestDecodeJSONBMap_Fallbacks(t *testing.T) {
	if m := DecodeJSONBMap(nil); len(m) != 0 {
		t.Fatalf("expected empty map for nil, got %v", m)
	}
	if m := DecodeJSONBMap([]byte("not json")); len(m) != 0 {
		t.Fatalf("expected empty map for garbage, got %v", m)
	}
	if m := DecodeJSONBMap([]byte(`[1,2]`)); len(m) != 0 {
		t.Fatalf("expected empty map for array, got %v", m)
	}
	if m := DecodeJSONBMap(""); len(m) != 0 {
		t.Fatalf("expected empty map for empty string, got %v", m)
	}
	if m := DecodeJSONBMap(42); len(m) != 0 {
		t.Fatalf("expected empty map for non-string value, got %v", m)
	}
	if m := DecodeJSONBMap([]byte("null")); len(m) != 0 {
		t.Fatalf("expected empty map for JSON null, got %v", m)
	}
}

func TestDecodeJSONBMap_StringInput(t *testing.T) {
	m := DecodeJSONBMap(`{"user": "u1"}`)
	if m["user"] != "u1" {
		t.Fatalf("unexpected map: %v", m)
	}
}
