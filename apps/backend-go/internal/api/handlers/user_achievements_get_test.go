package handlers

import (
	"testing"
)

func TestDecodeJSONColumn(t *testing.T) {
	tests := []struct {
		name string
		val  interface{}
		want map[string]interface{}
	}{
		{
			"valid bytes",
			[]byte(`{"id":"1","name":"test"}`),
			map[string]interface{}{"id": "1", "name": "test"},
		},
		{
			"valid string",
			`{"key":"val"}`,
			map[string]interface{}{"key": "val"},
		},
		{
			"empty bytes",
			[]byte{},
			map[string]interface{}{},
		},
		{
			"nil",
			nil,
			map[string]interface{}{},
		},
		{
			"invalid json bytes",
			[]byte(`not json`),
			map[string]interface{}{},
		},
		{
			"empty object",
			[]byte(`{}`),
			map[string]interface{}{},
		},
		{
			"null json",
			[]byte(`null`),
			map[string]interface{}{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := decodeJSONColumn(tt.val)
			if len(got) != len(tt.want) {
				t.Errorf("got %d keys, want %d", len(got), len(tt.want))
			}
			for k, v := range tt.want {
				if got[k] != v {
					t.Errorf("key %q: got %v, want %v", k, got[k], v)
				}
			}
		})
	}
}
