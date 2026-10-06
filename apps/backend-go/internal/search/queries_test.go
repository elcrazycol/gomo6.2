package search

import (
	"strings"
	"testing"
)

// Global topics have board_id = NULL (it became nullable for board-less
// threads). The board join MUST be a LEFT JOIN and a missing board must count
// as public — an inner join silently dropped every such thread and its posts
// from the index (and from the SQL fallback).
func TestContentQueriesIncludeBoardlessThreads(t *testing.T) {
	cases := map[string]string{
		"threads": threadsBaseQuery,
		"posts":   postsBaseQuery,
	}
	for name, query := range cases {
		if !strings.Contains(query, "LEFT JOIN boards b ON b.id = t.board_id") {
			t.Errorf("%s base query must LEFT JOIN boards, got:\n%s", name, query)
		}
		if !strings.Contains(query, "COALESCE(b.visibility, 'public')") {
			t.Errorf("%s base query must treat a missing board as public, got:\n%s", name, query)
		}
	}
}
