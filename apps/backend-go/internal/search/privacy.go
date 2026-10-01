package search

import "strings"

// Privacy model for the search index.
//
// Design decision (mirrors the L1 finding in the security audit): private
// profiles and content inside private boards are NOT copied into Meilisearch at
// all. Excluding them at index time makes it structurally impossible for the
// engine to leak them — no query, and no forgotten filter clause, can surface a
// row that was never indexed. The owner/mutual-friend and board-member cases
// are served by the PostgreSQL fallback (a later phase), never by relaxing the
// index.
//
// The helpers below are the single source of truth for those rules, shared by
// the reindexer and (in a later phase) the write-path sync.

// IndexableUser reports whether a user row may be copied into the index. Remote
// (federated) users and private profiles are excluded.
func IndexableUser(isRemote, privateProfile bool) bool {
	return !isRemote && !privateProfile
}

// IndexableBoard reports whether a board's content may be copied into the index.
// Legacy rows without an explicit visibility default to public.
func IndexableBoard(visibility string) bool {
	return visibility == "" || visibility == VisibilityPublic
}

// PublicContentClause is the Meilisearch filter expression every content search
// must include. Only public-board documents are indexed today, so it is
// currently a formality — but stating it explicitly keeps the invariant and
// survives a future move to indexing member-only boards.
func PublicContentClause() string {
	return `board_visibility = "` + VisibilityPublic + `"`
}

// AndFilter joins non-empty filter expressions with AND. Callers must pass only
// server-generated clauses (UUIDs, integers, fixed enums); user-supplied text
// must never reach a filter expression unvalidated.
func AndFilter(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, " AND ")
}
