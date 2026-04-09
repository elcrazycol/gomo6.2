package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"

	"github.com/gin-gonic/gin"
)

// parseJSONObjectBody reads POST/PUT JSON: either `{...}` or `[{...}]` (Supabase insert batch).
func parseJSONObjectBody(c *gin.Context) (map[string]interface{}, error) {
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil, err
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(raw))

	var generic interface{}
	if err := json.Unmarshal(raw, &generic); err != nil {
		return nil, err
	}
	switch v := generic.(type) {
	case map[string]interface{}:
		return v, nil
	case []interface{}:
		if len(v) == 1 {
			if m, ok := v[0].(map[string]interface{}); ok {
				return m, nil
			}
		}
		return nil, fmt.Errorf("expected one object in array")
	default:
		return nil, fmt.Errorf("expected JSON object or array of one object")
	}
}

// normalizeJSONValuesForDB converts nested JSON objects/arrays to []byte so database/sql + pq can bind JSONB.
func normalizeJSONValuesForDB(data map[string]interface{}) error {
	for k, v := range data {
		if v == nil {
			continue
		}
		switch val := v.(type) {
		case map[string]interface{}:
			b, err := json.Marshal(val)
			if err != nil {
				return fmt.Errorf("%s: %w", k, err)
			}
			data[k] = b
		case []interface{}:
			b, err := json.Marshal(val)
			if err != nil {
				return fmt.Errorf("%s: %w", k, err)
			}
			data[k] = b
		}
	}
	return nil
}
