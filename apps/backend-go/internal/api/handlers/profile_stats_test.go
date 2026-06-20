package handlers

import "testing"

func TestRowUserID(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
		want  string
	}{
		{"string", "user-123", "user-123"},
		{"bytes", []byte("user-456"), "user-456"},
		{"int", 42, "42"},
		{"nil", nil, ""},
		{"float", 3.14, "3.14"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := rowUserID(tt.input)
			if got != tt.want {
				t.Errorf("rowUserID(%v) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
