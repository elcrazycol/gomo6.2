// Package privacy holds the profile-visibility rules shared between the
// api/handlers god package and the crudengine subsystem: privacy settings
// loading, mutual friendship checks and per-content-type visibility gates.
// Extracted so the crudengine subsystem can leave the handlers package without
// dragging the whole privacy domain with it.
package privacy

import (
	"database/sql"
	"strconv"
	"strings"

	"github.com/gomo6/backend/internal/crud"
)

// Settings holds the private profile fields from privacy_settings table.
type Settings struct {
	PrivateProfile          bool
	PrivateHideAvatar       bool
	PrivateHideWall         bool
	PrivateHideThreads      bool
	PrivateHideStats        bool
	PrivateHideFriends      bool
	PrivateHideGifts        bool
	PrivateHideAchievements bool
}

// SettingsFlagColumns is the shared SELECT fragment mapping every core
// privacy_settings flag to its NULL default. GetSettings and the public
// visibility endpoint both embed it, so the COALESCE defaults can never drift
// apart between the content gating and the public visibility endpoint.
const SettingsFlagColumns = `COALESCE(private_profile, false),
	       COALESCE(private_hide_avatar, false),
	       COALESCE(private_hide_wall, false),
	       COALESCE(private_hide_threads, true),
	       COALESCE(private_hide_stats, false),
	       COALESCE(private_hide_friends, true),
	       COALESCE(private_hide_gifts, true),
	       COALESCE(private_hide_achievements, true)`

// Wall-visibility flags. Both CanViewWall's SELECT and WallVisibilityClause's
// SQL text reference these columns through the constants below, so a rename
// touches one place instead of three.
const (
	wallPrivateProfileCol  = "private_profile"
	wallPrivateHideWallCol = "private_hide_wall"
)

// wallSettingsColumns is the two-flag SELECT fragment of the wall-visibility
// gate. It mirrors SettingsFlagColumns for the two wall flags, but stays a
// separate (shorter) fragment because CanViewWall's query shape is
// load-bearing: the crudengine/routes/websocket tests pin this exact SELECT.
const wallSettingsColumns = `COALESCE(` + wallPrivateProfileCol + `, false), COALESCE(` + wallPrivateHideWallCol + `, false)`

// GetSettings loads private profile settings for a user.
func GetSettings(db *sql.DB, userID string) (*Settings, error) {
	var ps Settings
	err := db.QueryRow(`SELECT `+SettingsFlagColumns+`
		FROM privacy_settings WHERE user_id = $1
	`, userID).Scan(
		&ps.PrivateProfile, &ps.PrivateHideAvatar, &ps.PrivateHideWall,
		&ps.PrivateHideThreads, &ps.PrivateHideStats, &ps.PrivateHideFriends,
		&ps.PrivateHideGifts, &ps.PrivateHideAchievements,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return &Settings{}, nil
		}
		return nil, err
	}
	return &ps, nil
}

// IsMutualFriend checks if viewerID and targetID are mutual friends.
func IsMutualFriend(db *sql.DB, viewerID, targetID string) (bool, error) {
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE (user1_id = $1 AND user2_id = $2)
			   OR (user1_id = $2 AND user2_id = $1)
		)
	`, viewerID, targetID).Scan(&exists)
	return exists, err
}

// ShouldFilterPrivateProfile returns true if the target user has private_profile enabled
// and the viewer is not the owner and not a mutual friend. Anonymous visitors
// (viewerID == "") are never the owner or a friend, so they must be filtered:
// previously an empty viewer was treated as "no filtering", which let anonymous
// clients read the bio/garma/last_seen of private profiles in full.
func ShouldFilterPrivateProfile(db *sql.DB, viewerID, targetID string) (bool, *Settings, error) {
	ps, err := GetSettings(db, targetID)
	if err != nil {
		return false, nil, err
	}
	if !ps.PrivateProfile {
		return false, ps, nil
	}
	// Only the profile owner may view it in full; an empty viewer (anonymous)
	// or any non-friend is filtered.
	if viewerID != "" && viewerID == targetID {
		return false, ps, nil
	}
	if viewerID == "" {
		return true, ps, nil
	}
	isFriend, err := IsMutualFriend(db, viewerID, targetID)
	if err != nil {
		return false, ps, err
	}
	if isFriend {
		return false, ps, nil
	}
	return true, ps, nil
}

// CanViewWall reports whether viewerID may view the wall of ownerID: the owner
// themself, owners of non-private profiles who have not hidden their wall
// (private_hide_wall), or mutual friends. This is the single Go form of the
// wall-visibility rule — the crudengine write path, the wall media route and
// the WebSocket room gate all call it instead of re-encoding the predicate.
// viewerID may be empty for anonymous callers: they can never be the owner or
// a friend, so only public non-hidden walls are visible. DB errors fail
// closed (false, err).
//
// The two COALESCE defaults mirror GetSettings for the wall flags: a missing
// privacy_settings row means a public profile with a visible wall.
func CanViewWall(db *sql.DB, viewerID, ownerID string) (bool, error) {
	if viewerID != "" && viewerID == ownerID {
		return true, nil
	}
	var private, hideWall bool
	err := db.QueryRow(`SELECT `+wallSettingsColumns+` FROM privacy_settings WHERE user_id = $1`, ownerID).Scan(&private, &hideWall)
	if err != nil {
		if err == sql.ErrNoRows {
			// No privacy settings row means the profile is public and the wall
			// is not hidden.
			return true, nil
		}
		return false, err
	}
	if !private && !hideWall {
		return true, nil
	}
	if viewerID == "" {
		return false, nil
	}
	return IsMutualFriend(db, viewerID, ownerID)
}

// WallVisibilityClause returns the SQL WHERE fragment that admits rows of a
// wall owned by ownerColumn whose privacy settings live in privacyAlias — the
// single SQL form of CanViewWall, used by the efficient row-level wall/comment
// read queries (crudengine) and the wall media gate so the rule is never
// hand-written per call site. The caller supplies the viewer reference: a
// `$N` placeholder for an authenticated viewer, or SQL NULL for anonymous
// callers (NULL never matches the ownership or friendship comparisons, so
// anonymous reads expose only public non-hidden walls). Keep this string in
// sync with CanViewWall.
func WallVisibilityClause(ownerColumn, privacyAlias, viewerArg string) string {
	return "(" + ownerColumn + " = " + viewerArg +
		" OR (COALESCE(" + privacyAlias + "." + wallPrivateProfileCol + ", false) = false AND COALESCE(" + privacyAlias + "." + wallPrivateHideWallCol + ", false) = false)" +
		" OR EXISTS (SELECT 1 FROM friendships f WHERE (f.user1_id = " + ownerColumn + " AND f.user2_id = " + viewerArg + ") OR (f.user1_id = " + viewerArg + " AND f.user2_id = " + ownerColumn + ")))"
}

// WallAttachmentAccess reports whether viewerID may fetch a wall media object
// identified by key and uploaded by uploaderID. Returns (found, allowed):
// found=true when at least one post AUTHORED BY THE UPLOADER references the key
// (image_url or attachments JSONB); allowed=true when any referencing post sits
// on a wall the viewer may see (owner, public profile with a visible wall, or
// mutual friend).
//
// Wall object keys are namespaced by the UPLOADER's user id, but the uploader
// is not necessarily the wall owner — a private user posting with an image on a
// public user's wall publishes that image to the public. Gating on the uploader
// alone wrongly 403s such files. The visibility predicate is the shared
// wall-visibility rule WallVisibilityClause encodes, so private photos cannot
// be fetched by URL guessing and published photos are served.
//
// The lookup is scoped to posts authored by the uploader (author_id = key
// prefix — guaranteed at creation by the upload key-prefix check and the
// crudengine write path's enforcePostOwnership). This is a security boundary:
// the write path accepts client-supplied image_url/attachments without
// validating ownership, so an unrestricted scan would let any authenticated
// user reference a private user's key from a post on their own public wall and
// thereby unlock the file. Scoping to the uploader's posts closes that bypass
// and uses the idx_profile_wall_posts_author_id index.
//
// When found=false (deleted post, orphaned upload, or guessed key) the caller
// falls back to the uploader-scoped check so orphaned files of private users
// stay unreadable. DB errors fail closed (found=false, allowed=false).
func WallAttachmentAccess(db *sql.DB, viewerID, uploaderID, key string) (found, allowed bool) {
	// Derivative objects (.preview.jpg / .poster.jpg) are implementation
	// details of their base object: authorize them against the base key so
	// previews and video posters stay reachable wherever the original is. The
	// visibility predicate still gates the base object, so a private file's
	// derivative stays private — this only widens matching, never access.
	base := key
	switch {
	case strings.HasSuffix(base, ".preview.jpg"):
		base = strings.TrimSuffix(base, ".preview.jpg")
	case strings.HasSuffix(base, ".poster.jpg"):
		base = strings.TrimSuffix(base, ".poster.jpg")
	}
	pattern := "%" + crud.EscapeLikePattern(base) + "%"

	// Single query applying the shared wall-visibility rule
	// (WallVisibilityClause — the SQL form of CanViewWall) against each
	// referencing post's wall owner (p.user_id). EXISTS short-circuits on the
	// first visible wall, so a file published across several walls is served as
	// soon as any of them is visible to the viewer. viewerID is the empty
	// string for anonymous crawlers (the /og/wall proxy): the viewer is bound
	// as SQL NULL instead, because passing "" straight into a uuid parameter
	// makes Postgres raise "invalid input syntax for type uuid" and every
	// anonymous wall-image request would 404 even for public walls. NULL never
	// matches the ownership or friendship comparisons, so anonymous callers
	// only see public non-hidden walls.
	viewerArg := "NULL"
	args := []interface{}{pattern}
	if viewerID != "" {
		viewerArg = "$2"
		args = append(args, viewerID)
	}
	args = append(args, uploaderID)
	uploaderIdx := strconv.Itoa(len(args))

	var visible bool
	if err := db.QueryRow(`
SELECT EXISTS(
  SELECT 1
  FROM profile_wall_posts p
  LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
  WHERE p.author_id = $`+uploaderIdx+`
    AND (p.image_url LIKE $1 ESCAPE '\' OR p.attachments::text LIKE $1 ESCAPE '\')
    AND `+WallVisibilityClause("p.user_id", "ps", viewerArg)+`
  LIMIT 1
)`, args...).Scan(&visible); err != nil {
		return false, false
	}
	if visible {
		return true, true
	}

	// Not visible to this viewer — distinguish "published on a wall I cannot
	// see" (deny) from "published nowhere" (caller falls back to the uploader
	// gate).
	var referenced bool
	if err := db.QueryRow(`
SELECT EXISTS(
  SELECT 1 FROM profile_wall_posts p
  WHERE p.author_id = $2
    AND (p.image_url LIKE $1 ESCAPE '\' OR p.attachments::text LIKE $1 ESCAPE '\')
)`, pattern, uploaderID).Scan(&referenced); err != nil {
		return false, false
	}
	return referenced, false
}

// CanViewUserContent returns true if the viewer can see the target user's content.
// Returns true if: profile is not private, viewer is empty/owner, or viewer is mutual friend.
func CanViewUserContent(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	shouldFilter, _, err := ShouldFilterPrivateProfile(db, viewerID, targetUserID)
	if err != nil {
		return false, err
	}
	return !shouldFilter, nil
}

// CanViewUserAchievements applies both profile visibility and the dedicated
// private_hide_achievements setting. A visible profile does not implicitly
// make the user's achievement history public.
func CanViewUserAchievements(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	settings, err := GetSettings(db, targetUserID)
	if err != nil {
		return false, err
	}
	if viewerID == targetUserID {
		return true, nil
	}
	if settings.PrivateHideAchievements {
		return false, nil
	}
	if !settings.PrivateProfile {
		return true, nil
	}
	if viewerID == "" {
		return false, nil
	}
	return IsMutualFriend(db, viewerID, targetUserID)
}

// CanViewUserGifts applies both profile visibility and the dedicated
// private_hide_gifts setting, mirroring CanViewUserAchievements. A public
// profile that hides gifts must still keep them from non-friends.
func CanViewUserGifts(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	settings, err := GetSettings(db, targetUserID)
	if err != nil {
		return false, err
	}
	if viewerID == targetUserID {
		return true, nil
	}
	if settings.PrivateHideGifts {
		return false, nil
	}
	if !settings.PrivateProfile {
		return true, nil
	}
	if viewerID == "" {
		return false, nil
	}
	return IsMutualFriend(db, viewerID, targetUserID)
}
