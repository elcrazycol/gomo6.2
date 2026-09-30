package privacy

import (
	"database/sql"
	"errors"

	"github.com/lib/pq"
)

// ProfileVisibility is the resolved visibility decision for one target profile
// as seen by a specific viewer. It is the batched form of the two checks
// GET /api/v1/profiles used to run per row: ShouldFilterPrivateProfile plus the
// public-profile avatar/stats toggles. ResolveProfileVisibilityBatch produces it
// with a bounded number of queries instead of O(rows).
type ProfileVisibility struct {
	// Filter means the viewer may not see the profile's content at all: a
	// private profile viewed by a non-friend (anonymous viewers are never
	// friends), with the owner exempt. Bio, counters, online status and
	// last_seen are stripped by the caller.
	Filter bool
	// HideAvatar means avatar_url/background_url must be stripped: a private
	// profile with private_hide_avatar, or a public profile with the toggle set
	// and the viewer neither the owner nor a mutual friend.
	HideAvatar bool
	// HideStats means the counters and online/last_seen must be stripped: a
	// public profile with private_hide_stats and the viewer neither the owner
	// nor a mutual friend.
	HideStats bool
}

// privacySettingsBatchQuery loads the three visibility flags the profile list
// needs for every target at once. Missing rows mean "public, nothing hidden",
// exactly like GetSettings. The explicit ::uuid[] cast keeps lib/pq's text
// array encoding comparable with the uuid column (same pattern as the emoji
// resolver's $1::uuid[]).
const privacySettingsBatchQuery = `SELECT user_id::text, COALESCE(private_profile, false),
	       COALESCE(private_hide_avatar, false), COALESCE(private_hide_stats, false)
	FROM privacy_settings WHERE user_id = ANY($1::uuid[])`

// mutualFriendBatchQuery returns the (viewer, target) friendship pairs for the
// targets that need a friend check. friendships enforces user1_id < user2_id,
// so at most one branch of the OR can match per target; the OR keeps the query
// correct even if that CHECK is ever dropped.
const mutualFriendBatchQuery = `SELECT user1_id::text, user2_id::text FROM friendships
	WHERE (user1_id = $1::uuid AND user2_id = ANY($2::uuid[]))
	   OR (user2_id = $1::uuid AND user1_id = ANY($2::uuid[]))`

// ResolveProfileVisibilityBatch resolves ProfileVisibility for every target in
// a single pass, issuing at most two queries regardless of how many targets the
// page contains:
//
//  1. one privacy_settings read for all targets, and
//  2. one friendships read, only for the targets that actually need a mutual-
//     friend check (a private profile or an avatar/stats toggle seen by a
//     signed-in non-owner).
//
// This replaces the per-row GetSettings/IsMutualFriend pair that made
// GET /api/v1/profiles do up to two round trips per row — the N+1 that
// dominated the endpoint's p95 on cache misses.
//
// An empty viewerID is an anonymous visitor: never the owner, never a friend,
// so private profiles are filtered and the public toggles apply.
//
// It returns an error only for real DB failures. Callers must fail closed (not
// serve any row with its sensitive fields) rather than continue, which is what
// the old per-row loop did on error.
func ResolveProfileVisibilityBatch(db *sql.DB, viewerID string, targetIDs []string) (map[string]ProfileVisibility, error) {
	visibility := make(map[string]ProfileVisibility, len(targetIDs))
	if db == nil {
		return nil, errors.New("privacy: nil db")
	}

	unique := make([]string, 0, len(targetIDs))
	seen := make(map[string]struct{}, len(targetIDs))
	for _, id := range targetIDs {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return visibility, nil
	}

	settings, err := loadVisibilitySettings(db, unique)
	if err != nil {
		return nil, err
	}

	// Only the targets whose decision depends on a friendship need the second
	// query. The owner branch is handled without one.
	needsFriend := make([]string, 0, len(unique))
	for _, id := range unique {
		if viewerID == "" || viewerID == id {
			continue
		}
		ps := settings[id]
		if ps.PrivateProfile || ps.PrivateHideAvatar || ps.PrivateHideStats {
			needsFriend = append(needsFriend, id)
		}
	}

	friends := map[string]bool{}
	if len(needsFriend) > 0 {
		friends, err = loadMutualFriendTargets(db, viewerID, needsFriend)
		if err != nil {
			return nil, err
		}
	}

	for _, id := range unique {
		ps := settings[id]
		switch {
		case viewerID != "" && viewerID == id:
			// The owner always sees everything, even on a private profile.
			visibility[id] = ProfileVisibility{}
		case ps.PrivateProfile:
			// A private profile is fully filtered unless the viewer is a mutual
			// friend. Anonymous viewers were excluded above and are not friends.
			if friends[id] {
				visibility[id] = ProfileVisibility{}
				continue
			}
			visibility[id] = ProfileVisibility{Filter: true, HideAvatar: ps.PrivateHideAvatar}
		default:
			// Public profile: the avatar/stats toggles apply to everyone but the
			// owner and mutual friends.
			vis := ProfileVisibility{}
			if (ps.PrivateHideAvatar || ps.PrivateHideStats) && !friends[id] {
				vis.HideAvatar = ps.PrivateHideAvatar
				vis.HideStats = ps.PrivateHideStats
			}
			visibility[id] = vis
		}
	}

	return visibility, nil
}

// loadVisibilitySettings reads the visibility flags of every target in one
// query. A target with no privacy_settings row is absent from the map and is
// treated as public with nothing hidden (the GetSettings default).
func loadVisibilitySettings(db *sql.DB, targetIDs []string) (map[string]Settings, error) {
	rows, err := db.Query(privacySettingsBatchQuery, pq.Array(targetIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	settings := make(map[string]Settings, len(targetIDs))
	for rows.Next() {
		var id string
		var ps Settings
		if err := rows.Scan(&id, &ps.PrivateProfile, &ps.PrivateHideAvatar, &ps.PrivateHideStats); err != nil {
			return nil, err
		}
		settings[id] = ps
	}
	return settings, rows.Err()
}

// loadMutualFriendTargets returns the subset of targetIDs the viewer is in a
// friendship with, using a single query. It reports the ids as strings so the
// caller can index its map with the same ids it passed in.
func loadMutualFriendTargets(db *sql.DB, viewerID string, targetIDs []string) (map[string]bool, error) {
	rows, err := db.Query(mutualFriendBatchQuery, viewerID, pq.Array(targetIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	friends := make(map[string]bool, len(targetIDs))
	for rows.Next() {
		var a, b string
		if err := rows.Scan(&a, &b); err != nil {
			return nil, err
		}
		// The pair is (viewer, target); keep the side that is not the viewer.
		if a == viewerID {
			friends[b] = true
		} else {
			friends[a] = true
		}
	}
	return friends, rows.Err()
}
