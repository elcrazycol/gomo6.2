package cache

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// This file is the single owner of data-cache invalidation. Every write path
// that must evict cached GET responses calls one of the InvalidateCacheFor*
// functions below; raw pattern eviction lives in InvalidateByPattern and the
// generic table-driven variant in InvalidateForTable. There is deliberately no
// Invalidator object or package-level singleton — callers pass the redis client
// explicitly, keeping the package free of global state.

// InvalidateByPattern removes cache keys matching a pattern using SCAN (non-blocking).
func InvalidateByPattern(redis *redis.Client, pattern string) {
	if redis == nil || pattern == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var cursor uint64
	var totalDeleted int64

	for {
		keys, nextCursor, err := redis.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			log.Printf("[Cache] Failed to scan keys for pattern %s: %v", pattern, err)
			return
		}

		if len(keys) > 0 {
			if err := redis.Del(ctx, keys...).Err(); err != nil {
				log.Printf("[Cache] Failed to delete keys for pattern %s: %v", pattern, err)
				return
			}
			totalDeleted += int64(len(keys))
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	if totalDeleted > 0 {
		log.Printf("[Cache] Deleted %d keys for pattern %s", totalDeleted, pattern)
	}
}

// InvalidateForTable invalidates cache for a table using pattern-based invalidation.
// Uses wildcard patterns to match real cache keys that include extra query params
// (select, order, limit, etc.). Empty values = full-table flush.
func InvalidateForTable(redis *redis.Client, table string, values map[string]string) {
	if redis == nil {
		return
	}
	for _, pattern := range BuildCachePatterns(table, values) {
		InvalidateByPattern(redis, pattern)
	}
}

// invalidatePatterns applies a batch of wildcard patterns (nil-redis safe).
func invalidatePatterns(redis *redis.Client, patterns []string) {
	if redis == nil {
		return
	}
	for _, pattern := range patterns {
		InvalidateByPattern(redis, pattern)
	}
}

// InvalidateCacheForThread invalidates all cache entries related to a thread.
//
// Deliberately scoped: post-list keys are matched via thread_id=eq.<threadID>,
// never a global data:/api/v1/posts* flush, so unrelated threads' caches survive.
func InvalidateCacheForThread(redis *redis.Client, threadID string) {
	// Use wildcard patterns to invalidate ALL queries for this thread
	patterns := []string{
		fmt.Sprintf("data:/api/v1/posts*thread_id=eq.%s*", threadID),
		fmt.Sprintf("data:/api/v1/threads*%s*", threadID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForThreadInBoard invalidates the thread and the board it
// belongs to: the board's thread-list caches (board_id=eq.<boardID> feeds)
// and the board detail itself.
func InvalidateCacheForThreadInBoard(redis *redis.Client, threadID string, boardID string) {
	InvalidateCacheForThread(redis, threadID)
	patterns := []string{
		fmt.Sprintf("data:/api/v1/threads*board_id=eq.%s*", boardID),
		fmt.Sprintf("data:/api/v1/boards*id=eq.%s*", boardID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForProfile invalidates all cache entries related to a profile.
func InvalidateCacheForProfile(redis *redis.Client, userID string) {
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profiles*%s*", userID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForBoard invalidates all cache entries related to a board.
func InvalidateCacheForBoard(redis *redis.Client, boardID string) {
	// Use wildcard patterns scoped to this specific board
	patterns := []string{
		fmt.Sprintf("data:/api/v1/threads*board_id=eq.%s*", boardID),
		fmt.Sprintf("data:/api/v1/boards*id=eq.%s*", boardID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForBoardWithSlug invalidates the board and its slug-keyed
// caches (path /api/v1/boards/<slug> and slug=eq.<slug> queries).
func InvalidateCacheForBoardWithSlug(redis *redis.Client, boardID string, slug string) {
	InvalidateCacheForBoard(redis, boardID)
	patterns := []string{
		fmt.Sprintf("data:/api/v1/boards*slug=eq.%s*", slug),
		fmt.Sprintf("data:/api/v1/boards/%s?*", slug),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForProfileWall invalidates all cache entries related to a user's profile wall.
func InvalidateCacheForProfileWall(redis *redis.Client, userID string) {
	// Use wildcard patterns scoped to this specific user only (NOT global).
	// The pattern matches the viewer-scoped key shape "...?user_id=eq.<id>&...|viewer=<id>".
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profile_wall_posts*user_id=eq.%s*", userID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForWallPost invalidates cache for a specific wall post and its comments.
func InvalidateCacheForWallPost(redis *redis.Client, postID string) {
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profile_wall_posts*id=eq.%s*", postID),
		fmt.Sprintf("data:/api/v1/profile_wall_posts/%s?*", postID),
		fmt.Sprintf("data:/api/v1/profile_wall_posts*post_id=eq.%s*", postID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForWallPostOfUser invalidates the wall post and the wall
// owner's wall-list caches (the wall list embeds post counts per post).
func InvalidateCacheForWallPostOfUser(redis *redis.Client, postID string, userID string) {
	InvalidateCacheForWallPost(redis, postID)
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profile_wall_posts*user_id=eq.%s*", userID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForFeed clears the unified feed cache (all viewers). Called on
// write paths that create new feed content (threads, wall posts); the TTL is
// already short (30s), this just makes new content appear immediately.
//
// NOTE: this is a global pattern invalidation over per-viewer keys. At MVP
// scale it is cheap; if the site grows, scope it to affected viewers or drop
// the high-frequency call sites (e.g. likes) and rely on the 30s TTL.
func InvalidateCacheForFeed(redis *redis.Client) {
	InvalidateByPattern(redis, "data:/api/v1/feed*")
}

// InvalidateCacheForWallPostPin invalidates cache when a wall post is pinned/unpinned.
func InvalidateCacheForWallPostPin(redis *redis.Client, postID string, userID string) {
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profile_wall_posts*%s*", postID),
		fmt.Sprintf("data:/api/v1/profile_wall_posts*user_id=eq.%s*", userID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForPost invalidates cache for a specific post and, when the
// thread is known, its thread's post list and the thread detail itself.
func InvalidateCacheForPost(redis *redis.Client, postID string, threadID string) {
	patterns := []string{
		fmt.Sprintf("data:/api/v1/posts*%s*", postID),
	}
	if threadID != "" {
		patterns = append(patterns,
			fmt.Sprintf("data:/api/v1/posts*thread_id=eq.%s*", threadID),
			fmt.Sprintf("data:/api/v1/threads*id=eq.%s*", threadID),
			fmt.Sprintf("data:/api/v1/threads/%s?*", threadID),
		)
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForPostLike invalidates cache when a post is liked/unliked.
func InvalidateCacheForPostLike(redis *redis.Client, postID string, threadID string) {
	// Invalidate the post itself (likes affect post data)
	InvalidateCacheForPost(redis, postID, threadID)
}

// InvalidateCacheForThreadLike invalidates cache when a thread is liked/unliked.
func InvalidateCacheForThreadLike(redis *redis.Client, threadID string) {
	// Invalidate the thread itself (likes affect thread data)
	InvalidateCacheForThread(redis, threadID)
}

// InvalidateCacheForNotification invalidates notification cache for a user.
func InvalidateCacheForNotification(redis *redis.Client, userID string) {
	// Use wildcard to invalidate ALL notification queries for this user
	patterns := []string{
		fmt.Sprintf("data:/api/v1/notifications*user_id=eq.%s*", userID),
	}
	invalidatePatterns(redis, patterns)
}

// InvalidateCacheForWallComment invalidates wall comment cache.
func InvalidateCacheForWallComment(redis *redis.Client, commentID string, postID string) {
	// Use wildcard to invalidate ALL wall comment queries for this post
	patterns := []string{
		fmt.Sprintf("data:/api/v1/profile_wall_post_comments*post_id=eq.%s*", postID),
		"data:/api/v1/profile_wall_post_comments*",
		fmt.Sprintf("data:/api/v1/profile_wall_posts*%s*", postID),
	}
	invalidatePatterns(redis, patterns)
}
