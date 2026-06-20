package storage

import (
	"os"
	"sync"
	"testing"
)

func TestValidateObjectKey(t *testing.T) {
	tests := []struct {
		name    string
		key     string
		wantErr bool
	}{
		{"valid simple", "file.txt", false},
		{"valid with path", "images/photo.jpg", false},
		{"valid with underscore", "user_123/avatar.png", false},
		{"empty", "", true},
		{"path traversal", "../etc/passwd", true},
		{"starts with slash", "/absolute/path", true},
		{"dots in middle", "dir/../../file", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateObjectKey(tt.key)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateObjectKey(%q) error = %v, wantErr %v", tt.key, err, tt.wantErr)
			}
		})
	}

	t.Run("exactly 2048 chars", func(t *testing.T) {
		key := make([]byte, 2048)
		for i := range key {
			key[i] = 'a'
		}
		if err := ValidateObjectKey(string(key)); err != nil {
			t.Errorf("2048 chars should be valid, got error: %v", err)
		}
	})

	t.Run("2049 chars too long", func(t *testing.T) {
		key := make([]byte, 2049)
		for i := range key {
			key[i] = 'a'
		}
		if err := ValidateObjectKey(string(key)); err == nil {
			t.Error("2049 chars should be invalid")
		}
	})
}

func resetBuckets() {
	allowedBucketsOnce = sync.Once{}
	allowedBucketsMap = nil
}

func TestIsAllowedBucket(t *testing.T) {
	resetBuckets()
	os.Setenv("GARAGE_S3_BUCKETS", "content,avatars,uploads")
	defer os.Unsetenv("GARAGE_S3_BUCKETS")
	resetBuckets()

	if !IsAllowedBucket("content") {
		t.Error("content should be allowed")
	}
	if !IsAllowedBucket("avatars") {
		t.Error("avatars should be allowed")
	}
	if IsAllowedBucket("private") {
		t.Error("private should not be allowed")
	}
	if IsAllowedBucket("") {
		t.Error("empty should not be allowed")
	}
}

func TestIsAllowedBucketDefault(t *testing.T) {
	os.Unsetenv("GARAGE_S3_BUCKETS")
	resetBuckets()

	if !IsAllowedBucket("content") {
		t.Error("content should be in default buckets")
	}
	if !IsAllowedBucket("avatars") {
		t.Error("avatars should be in default buckets")
	}
	if IsAllowedBucket("nonexistent") {
		t.Error("nonexistent should not be in default buckets")
	}
}
