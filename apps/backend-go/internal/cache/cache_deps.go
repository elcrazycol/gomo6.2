package cache

import (
	"fmt"
)

// CacheDependencyMap defines cache key patterns for each table
// Keys are cache key patterns with placeholders like {id}, {user_id}, etc.
type CacheDependencyMap map[string][]string

// TableCacheDeps maps table names to their cache key patterns
var TableCacheDeps = CacheDependencyMap{
	"posts": {
		"data:/api/v1/posts",
		"data:/api/v1/posts?id=eq.{id}",
		"data:/api/v1/posts?thread_id=eq.{thread_id}",
		"data:/api/v1/posts/{id}",
	},
	"threads": {
		"data:/api/v1/threads",
		"data:/api/v1/threads?id=eq.{id}",
		"data:/api/v1/threads/{id}",
		"data:/api/v1/threads?board_id=eq.{board_id}",
	},
	"boards": {
		"data:/api/v1/boards",
		"data:/api/v1/boards?id=eq.{id}",
		"data:/api/v1/boards/{id}",
		"data:/api/v1/boards/{slug}",
		"data:/api/v1/boards?slug=eq.{slug}",
	},
	"profiles": {
		"data:/api/v1/profiles",
		"data:/api/v1/profiles?id=eq.{id}",
		"data:/api/v1/profiles/{id}",
		"data:/api/v1/profiles/{username}",
		"data:/api/v1/profiles?username=eq.{username}",
	},
	"users": {
		"data:/api/v1/profiles",
		"data:/api/v1/profiles?id=eq.{id}",
		"data:/api/v1/profiles/{id}",
	},
	"notifications": {
		"data:/api/v1/notifications",
		"data:/api/v1/notifications?user_id=eq.{user_id}",
	},
	"profile_wall_posts": {
		"data:/api/v1/profile_wall_posts",
		"data:/api/v1/profile_wall_posts?id=eq.{id}",
		"data:/api/v1/profile_wall_posts?user_id=eq.{user_id}",
	},
	"profile_wall_post_comments": {
		"data:/api/v1/profile_wall_post_comments",
		"data:/api/v1/profile_wall_post_comments?id=eq.{id}",
		"data:/api/v1/profile_wall_post_comments?post_id=eq.{post_id}",
	},
	"profile_wall_post_likes": {
		"data:/api/v1/profile_wall_post_likes",
		"data:/api/v1/profile_wall_post_likes?post_id=eq.{post_id}",
	},
	"profile_wall_post_reposts": {
		"data:/api/v1/profile_wall_post_reposts",
		"data:/api/v1/profile_wall_post_reposts?post_id=eq.{post_id}",
	},
	"chat_messages": {
		"data:/api/v1/chat_messages",
		"data:/api/v1/chat_messages?id=eq.{id}",
		"data:/api/v1/chat_messages?conversation_id=eq.{conversation_id}",
	},
	"chat_conversations": {
		"data:/api/v1/chat_conversations",
		"data:/api/v1/chat_conversations?id=eq.{id}",
	},
	"chat_conversation_members": {
		"data:/api/v1/chat_conversation_members",
		"data:/api/v1/chat_conversation_members?conversation_id=eq.{conversation_id}",
		"data:/api/v1/chat_conversation_members?user_id=eq.{user_id}",
	},
	"chat_receipts": {
		"data:/api/v1/chat_receipts",
		"data:/api/v1/chat_receipts?conversation_id=eq.{conversation_id}",
	},
	"post_likes": {
		"data:/api/v1/posts?id=eq.{post_id}",
		"data:/api/v1/posts/{post_id}",
		"data:/api/v1/posts?thread_id=eq.{thread_id}",
	},
	"thread_likes": {
		"data:/api/v1/threads?id=eq.{thread_id}",
		"data:/api/v1/threads/{thread_id}",
	},
	"polls": {
		"data:/api/v1/polls",
		"data:/api/v1/polls?id=eq.{id}",
	},
	"poll_votes": {
		"data:/api/v1/polls",
		"data:/api/v1/polls?id=eq.{poll_id}",
		"data:/api/v1/poll_votes?poll_id=eq.{poll_id}",
	},
	"gomosub_rules_acceptance": {
		"data:/api/v1/gomosub_rules_acceptance",
		"data:/api/v1/gomosub_rules_acceptance?user_id=eq.{user_id}",
		"data:/api/v1/gomosub_rules_acceptance?board_id=eq.{board_id}",
	},
	"gomosub_invites": {
		"data:/api/v1/gomosub_invites",
		"data:/api/v1/gomosub_invites?board_id=eq.{board_id}",
	},
}

// BuildCacheKeys generates cache key patterns with actual values
func BuildCacheKeys(table string, values map[string]string) []string {
	patterns, ok := TableCacheDeps[table]
	if !ok {
		return nil
	}

	var keys []string
	for _, pattern := range patterns {
		key := pattern
		for placeholder, value := range values {
			key = replacePlaceholder(key, placeholder, value)
		}
		keys = append(keys, key)
	}
	return keys
}

// BuildCachePatterns generates wildcard patterns for cache invalidation.
// Unlike BuildCacheKeys (exact match), these patterns use * wildcards to match
// real cache keys that include extra query params like select, order, limit, etc.
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

// replacePlaceholder replaces {placeholder} with actual value
func replacePlaceholder(pattern, placeholder, value string) string {
	return replaceAll(pattern, "{"+placeholder+"}", value)
}

// replaceAll replaces all occurrences of old with new
func replaceAll(s, old, new string) string {
	result := s
	for {
		idx := 0
		found := false
		for i := 0; i <= len(result)-len(old); i++ {
			if result[i:i+len(old)] == old {
				idx = i
				found = true
				break
			}
		}
		if !found {
			break
		}
		result = result[:idx] + new + result[idx+len(old):]
	}
	return result
}

// GetPrimaryKeyColumn returns the primary key column name for a table
func GetPrimaryKeyColumn(table string) string {
	switch table {
	case "posts", "threads", "boards", "users", "notifications",
		"profile_wall_posts", "profile_wall_post_comments",
		"chat_messages", "chat_conversations", "polls":
		return "id"
	case "post_likes", "thread_likes":
		return "id"
	case "chat_conversation_members":
		return "id"
	case "chat_receipts":
		return "id"
	default:
		return "id"
	}
}

// GetForeignKeyColumns returns foreign key columns that affect cache for a table
func GetForeignKeyColumns(table string) []string {
	switch table {
	case "posts":
		return []string{"thread_id", "user_id"}
	case "threads":
		return []string{"board_id", "user_id"}
	case "profile_wall_posts":
		return []string{"user_id"}
	case "profile_wall_post_comments":
		return []string{"post_id", "user_id"}
	case "profile_wall_post_likes", "profile_wall_post_reposts":
		return []string{"post_id"}
	case "chat_messages":
		return []string{"conversation_id", "sender_user_id"}
	case "chat_conversation_members":
		return []string{"conversation_id", "user_id"}
	case "chat_receipts":
		return []string{"message_id", "user_id", "conversation_id"}
	case "notifications":
		return []string{"user_id"}
	case "post_likes":
		return []string{"post_id", "user_id"}
	case "thread_likes":
		return []string{"thread_id", "user_id"}
	case "poll_votes":
		return []string{"poll_id", "user_id"}
	case "gomosub_rules_acceptance":
		return []string{"user_id", "board_id"}
	case "gomosub_invites":
		return []string{"board_id"}
	default:
		return nil
	}
}

// GetCacheKeyExact returns exact cache key for a specific query
func GetCacheKeyExact(path string, queryParams map[string]string) string {
	query := ""
	first := true
	for key, value := range queryParams {
		if !first {
			query += "&"
		}
		query += key + "=" + value
		first = false
	}
	if query != "" {
		return fmt.Sprintf("data:%s?%s", path, query)
	}
	return fmt.Sprintf("data:%s", path)
}
