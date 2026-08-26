// Package crud holds the pure machinery of the generic CRUD surface
// (UniversalHandler in internal/api/handlers): row decoding, result-map
// helpers and emoji write validation. These functions have no dependency on
// the handlers package, so they can live here and be shared by the universal
// subsystem as it is gradually extracted from the api/handlers god package
// (F1). Nothing in this package may import internal/api/handlers — keep it a
// leaf.
package crud

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// DecodeColumnValue converts a database column value to a JSON-safe
// representation. JSONB columns come as []byte from the driver — they are
// parsed into proper JSON objects/arrays. Other []byte values (UUIDs, text)
// are returned as strings.
func DecodeColumnValue(val interface{}) interface{} {
	b, ok := val.([]byte)
	if !ok {
		return val
	}
	// Only try JSON parsing for values that look like JSON objects or arrays.
	s := strings.TrimSpace(string(b))
	if len(s) > 0 && (s[0] == '{' || s[0] == '[') {
		var jsonVal interface{}
		if err := json.Unmarshal(b, &jsonVal); err == nil {
			return jsonVal
		}
	}
	return string(b)
}

// ScanRowToMap scans a single row of rows into a map keyed by column name,
// running every value through DecodeColumnValue so JSONB columns arrive as
// JSON values and byte columns as strings.
func ScanRowToMap(rows *sql.Rows) (map[string]interface{}, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}
	if err := rows.Scan(valuePtrs...); err != nil {
		return nil, err
	}
	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		if b, ok := val.([]byte); ok {
			result[col] = DecodeColumnValue(b)
		} else {
			result[col] = val
		}
	}
	return result, nil
}

// WallResultString returns the string value of a generic result-map cell, or "".
func WallResultString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// WallIDPtr returns nil for an empty string, else a pointer to it.
func WallIDPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ValidateCustomEmojiAsset rejects image_url values that do not reference the
// authenticated user's own emoji storage (security: a forged URL could point
// at arbitrary buckets/keys).
func ValidateCustomEmojiAsset(data map[string]interface{}, userID string) error {
	value, ok := data["image_url"]
	if !ok {
		return nil
	}
	imageURL, ok := value.(string)
	if userID == "" || !ok || imageURL == "" || strings.Contains(imageURL, "://") || !strings.HasPrefix(imageURL, userID+"/") {
		return fmt.Errorf("image_url must reference the authenticated user's emoji storage")
	}
	return nil
}

// ValidateCustomEmojiTriggers enforces the unicode_triggers contract: a JSON
// array of 1-3 emoji-only strings, each at most 16 runes.
func ValidateCustomEmojiTriggers(data map[string]interface{}) error {
	raw, ok := data["unicode_triggers"]
	if !ok {
		return fmt.Errorf("unicode_triggers must contain 1 to 3 emoji")
	}
	var encoded []byte
	switch value := raw.(type) {
	case []byte:
		encoded = value
	case string:
		encoded = []byte(value)
	default:
		return fmt.Errorf("unicode_triggers must be an array")
	}
	var triggers []string
	if err := json.Unmarshal(encoded, &triggers); err != nil || len(triggers) < 1 || len(triggers) > 3 {
		return fmt.Errorf("unicode_triggers must contain 1 to 3 emoji")
	}
	for _, trigger := range triggers {
		if !utf8.ValidString(trigger) || strings.TrimSpace(trigger) == "" || len([]rune(trigger)) > 16 {
			return fmt.Errorf("invalid unicode emoji trigger")
		}
		containsEmoji := false
		for _, r := range trigger {
			if unicode.In(r, unicode.So) || r == '\u200d' || r == '\ufe0f' {
				containsEmoji = true
				break
			}
		}
		if !containsEmoji {
			return fmt.Errorf("unicode_triggers must contain emoji characters")
		}
	}
	return nil
}
