package crud

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestWallResultString(t *testing.T) {
	if got := WallResultString(nil); got != "" {
		t.Errorf("WallResultString(nil) = %q, want empty", got)
	}
	if got := WallResultString("x"); got != "x" {
		t.Errorf("WallResultString(\"x\") = %q, want \"x\"", got)
	}
	if got := WallResultString(42); got != "" {
		t.Errorf("WallResultString(42) = %q, want empty", got)
	}
}

func TestWallIDPtr(t *testing.T) {
	if WallIDPtr("") != nil {
		t.Error("WallIDPtr(\"\") should be nil")
	}
	if p := WallIDPtr("id-1"); p == nil || *p != "id-1" {
		t.Errorf("WallIDPtr(\"id-1\") = %v, want pointer to \"id-1\"", p)
	}
}

func TestScanRowToMap_DecodesJSONBAndBytes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	mock.ExpectQuery("SELECT").WillReturnRows(sqlmock.NewRows([]string{"id", "meta", "name"}).
		AddRow("row-1", []byte(`{"a":1}`), []byte("plain")))

	rows, err := db.Query("SELECT id, meta, name FROM t")
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	defer rows.Close()

	if !rows.Next() {
		t.Fatal("expected one row")
	}
	got, err := ScanRowToMap(rows)
	if err != nil {
		t.Fatalf("ScanRowToMap: %v", err)
	}

	if got["id"] != "row-1" {
		t.Errorf("id = %#v, want \"row-1\"", got["id"])
	}
	// JSONB arrives as a decoded JSON value, not raw bytes.
	meta, ok := got["meta"].(map[string]interface{})
	if !ok || meta["a"] != float64(1) {
		t.Errorf("meta = %#v, want decoded JSON object", got["meta"])
	}
	if got["name"] != "plain" {
		t.Errorf("name = %#v, want \"plain\"", got["name"])
	}
}

func TestValidateCustomEmojiAsset(t *testing.T) {
	// Missing image_url is fine (no asset in this write).
	if err := ValidateCustomEmojiAsset(map[string]interface{}{}, "u1"); err != nil {
		t.Errorf("missing image_url should be allowed, got %v", err)
	}
	// Own storage path is allowed.
	if err := ValidateCustomEmojiAsset(map[string]interface{}{"image_url": "u1/emoji.png"}, "u1"); err != nil {
		t.Errorf("own storage URL should be allowed, got %v", err)
	}
	rejects := []struct {
		name   string
		data   map[string]interface{}
		userID string
	}{
		{"absolute URL", map[string]interface{}{"image_url": "https://evil.example/x.png"}, "u1"},
		{"foreign storage", map[string]interface{}{"image_url": "u2/emoji.png"}, "u1"},
		{"anonymous caller", map[string]interface{}{"image_url": "u1/emoji.png"}, ""},
	}
	for _, tc := range rejects {
		if err := ValidateCustomEmojiAsset(tc.data, tc.userID); err == nil {
			t.Errorf("%s: ValidateCustomEmojiAsset(%#v, %q) should reject", tc.name, tc.data, tc.userID)
		}
	}
}

func TestValidateCustomEmojiTriggers(t *testing.T) {
	valid := map[string]interface{}{"unicode_triggers": []byte(`["😀","🔥"]`)}
	if err := ValidateCustomEmojiTriggers(valid); err != nil {
		t.Errorf("valid triggers rejected: %v", err)
	}
	for name, bad := range map[string]map[string]interface{}{
		"missing":      {},
		"empty":        {"unicode_triggers": []byte(`[]`)},
		"too many":     {"unicode_triggers": []byte(`["😀","🔥","❤️","⭐"]`)},
		"non-emoji":    {"unicode_triggers": []byte(`["abc"]`)},
		"not an array": {"unicode_triggers": []byte(`"😀"`)},
	} {
		if err := ValidateCustomEmojiTriggers(bad); err == nil {
			t.Errorf("%s: should reject %#v", name, bad)
		}
	}
}
