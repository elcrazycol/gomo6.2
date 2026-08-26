package universal

import (
	"strings"
	"testing"
)

func TestProfileCustomizationUpsertIncludesLanguage(t *testing.T) {
	query, args, ok := upsertInsertQuery("profile_customization", map[string]interface{}{
		"user_id":  "u1",
		"language": "uk",
	})
	if !ok {
		t.Fatal("expected profile customization language update to use partial upsert")
	}
	if !strings.Contains(query, "language") || !strings.Contains(query, "ON CONFLICT (user_id) DO UPDATE") {
		t.Fatalf("expected language upsert query, got %s", query)
	}
	if len(args) != 2 || args[0] != "u1" || args[1] != "uk" {
		t.Fatalf("unexpected upsert args: %#v", args)
	}
}
