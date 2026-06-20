package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseJSONObjectBody_Object(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `{"name": "test", "value": 42}`
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	result, err := parseJSONObjectBody(c)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["name"] != "test" {
		t.Errorf("name: got %v, want 'test'", result["name"])
	}
	if result["value"].(float64) != 42 {
		t.Errorf("value: got %v, want 42", result["value"])
	}
}

func TestParseJSONObjectBody_Array(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `[{"name": "single"}]`
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	result, err := parseJSONObjectBody(c)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["name"] != "single" {
		t.Errorf("name: got %v, want 'single'", result["name"])
	}
}

func TestParseJSONObjectBody_EmptyArray(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `[]`
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	_, err := parseJSONObjectBody(c)
	if err == nil {
		t.Fatal("expected error for empty array")
	}
}

func TestParseJSONObjectBody_MultipleArray(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `[{"a":1},{"b":2}]`
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	_, err := parseJSONObjectBody(c)
	if err == nil {
		t.Fatal("expected error for multiple objects in array")
	}
}

func TestParseJSONObjectBody_InvalidJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `not json`
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	_, err := parseJSONObjectBody(c)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseJSONObjectBody_StringValue(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `"just a string"`
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	_, err := parseJSONObjectBody(c)
	if err == nil {
		t.Fatal("expected error for string value")
	}
}

func TestNormalizeJSONValuesForDB(t *testing.T) {
	data := map[string]interface{}{
		"name":   "simple string",
		"nested": map[string]interface{}{"key": "value"},
		"list":   []interface{}{1, 2, 3},
		"null":   nil,
	}

	err := normalizeJSONValuesForDB(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if data["name"] != "simple string" {
		t.Errorf("string should remain unchanged")
	}
	if data["null"] != nil {
		t.Errorf("nil should remain nil")
	}

	// nested object should become []byte
	if _, ok := data["nested"].([]byte); !ok {
		t.Errorf("nested object should be []byte, got %T", data["nested"])
	}

	// array should become []byte
	if _, ok := data["list"].([]byte); !ok {
		t.Errorf("array should be []byte, got %T", data["list"])
	}

	// Verify the []byte values are valid JSON
	nestedBytes := data["nested"].([]byte)
	var m map[string]interface{}
	if err := json.Unmarshal(nestedBytes, &m); err != nil {
		t.Errorf("nested bytes not valid JSON: %v", err)
	}
	if m["key"] != "value" {
		t.Errorf("nested value wrong: %v", m["key"])
	}
}
