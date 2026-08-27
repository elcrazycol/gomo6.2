package main

import (
	"encoding/json"
	"testing"
)

func TestHealthResponse(t *testing.T) {
	version = "2.0.0"
	commit = "deadbeef"

	var got map[string]string
	if err := json.Unmarshal([]byte(healthResponse()), &got); err != nil {
		t.Fatalf("healthResponse() is not valid JSON: %v", err)
	}
	if got["status"] != "ok" {
		t.Errorf("status = %q, want ok", got["status"])
	}
	if got["version"] != "2.0.0" {
		t.Errorf("version = %q, want 2.0.0", got["version"])
	}
	if got["commit"] != "deadbeef" {
		t.Errorf("commit = %q, want deadbeef", got["commit"])
	}
}

func TestHealthResponseDefaults(t *testing.T) {
	version = "dev"
	commit = "unknown"

	var got map[string]string
	if err := json.Unmarshal([]byte(healthResponse()), &got); err != nil {
		t.Fatalf("healthResponse() is not valid JSON: %v", err)
	}
	if got["version"] != "dev" || got["commit"] != "unknown" {
		t.Errorf("defaults = %v, want dev/unknown", got)
	}
}
