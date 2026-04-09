package storage

import (
	"fmt"
	"os"
	"strings"
	"sync"
)

// DefaultBuckets is aligned with docker-compose garage-init (content, post-images) plus app buckets.
const defaultBuckets = "content,post-images,avatars,uploads"

var (
	allowedBucketsOnce sync.Once
	allowedBucketsMap  map[string]struct{}
)

func loadAllowedBuckets() map[string]struct{} {
	allowedBucketsOnce.Do(func() {
		raw := os.Getenv("GARAGE_S3_BUCKETS")
		if strings.TrimSpace(raw) == "" {
			raw = defaultBuckets
		}
		m := make(map[string]struct{})
		for _, p := range strings.Split(raw, ",") {
			b := strings.TrimSpace(p)
			if b == "" {
				continue
			}
			m[b] = struct{}{}
		}
		allowedBucketsMap = m
	})
	return allowedBucketsMap
}

// IsAllowedBucket reports whether the bucket may be used for uploads / presigned URLs.
func IsAllowedBucket(bucket string) bool {
	if bucket == "" {
		return false
	}
	_, ok := loadAllowedBuckets()[bucket]
	return ok
}

// ValidateObjectKey rejects path traversal and absurdly long keys.
func ValidateObjectKey(key string) error {
	if key == "" || len(key) > 2048 {
		return fmt.Errorf("invalid key")
	}
	if strings.Contains(key, "..") || strings.HasPrefix(key, "/") {
		return fmt.Errorf("invalid key")
	}
	return nil
}
