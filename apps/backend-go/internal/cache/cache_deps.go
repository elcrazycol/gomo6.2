package cache

import (
	"fmt"
)

// BuildCachePatterns generates wildcard patterns for cache invalidation.
// These patterns use * wildcards to match real cache keys that include extra
// query params like select, order, limit, etc.
// Example: "data:/api/v1/posts*thread_id=eq.123*" matches
// "data:/api/v1/posts?thread_id=eq.123&select=id,...&order=created_at.desc"
// Uses ?* and /* boundaries to avoid prefix collisions (e.g., "posts*" matching "post_comments")
func BuildCachePatterns(table string, values map[string]string) []string {
	var patterns []string

	// Only generate table-level wildcards for explicit full-table flushes (no specific values)
	// This prevents targeted invalidations from becoming global cache wipes
	if len(values) == 0 {
		patterns = append(patterns, fmt.Sprintf("data:/api/v1/%s?*", table))
		patterns = append(patterns, fmt.Sprintf("data:/api/v1/%s/*", table))
		return patterns
	}

	// Add patterns for each key value
	for key, value := range values {
		if value == "" {
			continue
		}
		// Pattern to match this specific value anywhere in the query string
		// e.g., "data:/api/v1/posts*thread_id=eq.123*"
		patterns = append(patterns, fmt.Sprintf("data:/api/v1/%s*%s=eq.%s*", table, key, value))
		// Also match by key value as a resource path segment: /api/v1/boards/shroom, /api/v1/posts/123
		// This covers endpoints that use slug/id/username in the URL path instead of query params
		patterns = append(patterns, fmt.Sprintf("data:/api/v1/%s/%s?*", table, value))
	}

	return patterns
}
