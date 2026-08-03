package handlers

import "testing"

func TestIsPreviewKey(t *testing.T) {
	tests := []struct {
		key     string
		preview bool
	}{
		{key: "user/messenger/photo.jpg.preview.jpg", preview: true},
		{key: "user/messenger/photo.jpg.PREVIEW.JPG", preview: true},
		{key: "user/messenger/photo.jpg", preview: false},
		{key: "user/messenger/photo.preview.jpg.backup", preview: false},
	}

	for _, tt := range tests {
		if got := isPreviewKey(tt.key); got != tt.preview {
			t.Errorf("isPreviewKey(%q) = %v, want %v", tt.key, got, tt.preview)
		}
	}
}

func TestAttachmentKeyForLookup(t *testing.T) {
	if got := attachmentKeyForLookup("user/messenger/photo.jpg.preview.jpg"); got != "user/messenger/photo.jpg" {
		t.Fatalf("unexpected original key: %q", got)
	}
	if got := attachmentKeyForLookup("user/messenger/photo.jpg"); got != "user/messenger/photo.jpg" {
		t.Fatalf("unexpected unchanged key: %q", got)
	}
}
