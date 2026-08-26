package crud

import "encoding/json"

// DecodeJSONB converts a JSONB column value to its JSON-safe representation.
// The driver returns JSONB either as []byte or as a string depending on the
// query path, so both are handled: a JSON document becomes the parsed value
// (map, slice, number, bool), anything else is returned as its string form.
// This is the looser sibling of DecodeColumnValue: it additionally accepts
// string cells (DecodeColumnValue only sees []byte) and parses scalar JSON
// (numbers/bools), which is why the wall read path uses it — its queries pull
// JSONB through the pq driver and must decode attachment arrays verbatim.
func DecodeJSONB(val interface{}) interface{} {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case []byte:
		var out interface{}
		if json.Unmarshal(v, &out) == nil {
			return out
		}
		return string(v)
	case string:
		var out interface{}
		if json.Unmarshal([]byte(v), &out) == nil {
			return out
		}
		return v
	default:
		return val
	}
}

// DecodeJSONBMap decodes a JSONB cell that is expected to be a JSON object,
// returning an empty map when the value is nil, not JSON, or not an object.
// Used for the embedded author/achievements objects of the specialized wall
// and achievements queries, where a missing or corrupt embed must degrade to
// an empty object instead of failing the whole read.
func DecodeJSONBMap(val interface{}) map[string]interface{} {
	var raw []byte
	switch v := val.(type) {
	case []byte:
		raw = v
	case string:
		raw = []byte(v)
	default:
		return map[string]interface{}{}
	}
	if len(raw) == 0 {
		return map[string]interface{}{}
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return map[string]interface{}{}
	}
	return m
}
