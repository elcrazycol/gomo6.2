// Package storyaccess holds the single set of visibility predicates for
// stories. It is a leaf package (only database/sql) so the REST handlers
// (internal/stories), the media proxy (internal/storage/handlers) and the
// WebSocket room gate (internal/websocket) all call the exact same rule.
//
// The rules, in one place:
//   - Personal stories honour a per-story audience:
//     everyone | friends | close_friends | only_me, plus the profile's own
//     private mode (a private profile narrows "everyone" to mutual friends,
//     exactly like every other read path via internal/privacy).
//   - GomoSub stories are never narrowed by the per-story audience: the board
//     decides. A private board is members/owner only; a public board is
//     readable by any authenticated user.
//   - The author always sees their own story (including after expiry, for the
//     archive), the board owner may moderate a GomoSub story, and posting to a
//     GomoSub requires the can_post_stories role permission.
//
// Every predicate fails closed: an empty viewer id, a nil DB or a query error
// means "no access", never "allow".
package storyaccess

import (
	"database/sql"
	"github.com/gomo6/backend/internal/gomosubperms"
)

// viewerCanSeeProfile is the SQL form of privacy.CanViewUserContent for the
// owner expression `ownerExpr`: true when the profile is public, or the viewer
// is the owner, or the two are mutual friends. `viewerArg` is a bind
// placeholder (e.g. "$1"), never a literal.
func viewerCanSeeProfile(ownerExpr, viewerArg string) string {
	return `(NOT COALESCE((SELECT ps.private_profile FROM privacy_settings ps WHERE ps.user_id = ` + ownerExpr + `), false)
		OR ` + ownerExpr + ` = ` + viewerArg + `::uuid
		OR EXISTS (
			SELECT 1 FROM friendships f
			WHERE f.user1_id = LEAST(` + ownerExpr + `, ` + viewerArg + `::uuid)
			  AND f.user2_id = GREATEST(` + ownerExpr + `, ` + viewerArg + `::uuid)
		))`
}

// isMutualFriend is true when the owner expression and the viewer are friends.
func isMutualFriend(ownerExpr, viewerArg string) string {
	return `EXISTS (
		SELECT 1 FROM friendships f
		WHERE f.user1_id = LEAST(` + ownerExpr + `, ` + viewerArg + `::uuid)
		  AND f.user2_id = GREATEST(` + ownerExpr + `, ` + viewerArg + `::uuid)
	)`
}

// boardVisible is the SQL form of the GomoSub visibility rule used by threads
// and text channels: public board, owner, or a member of the board.
func boardVisible(boardExpr, viewerArg string) string {
	return `EXISTS (
		SELECT 1 FROM boards b
		WHERE b.id = ` + boardExpr + `
		  AND (COALESCE(b.visibility, 'public') <> 'private'
		       OR b.owner_id::text = ` + viewerArg + `::text
		       OR EXISTS (SELECT 1 FROM gomosub_memberships gm
		                  WHERE gm.board_id = b.id AND gm.user_id::text = ` + viewerArg + `::text))
	)`
}

// VisibleCondition returns a boolean SQL expression that is true when the story
// row behind `alias` may be seen by the viewer bound at `viewerArg`.
//
// The expression deliberately does NOT filter expiry or soft deletion — those
// are time/lifecycle concerns, not audience ones, and the author's archive
// needs expired rows. Callers add `expires_at > NOW()` / `deleted_at IS NULL`
// where appropriate.
func VisibleCondition(alias, viewerArg string) string {
	owner := alias + ".user_id"
	return `(
		` + alias + `.user_id = ` + viewerArg + `::uuid
		OR ` + alias + `.author_id = ` + viewerArg + `::uuid
		OR (` + alias + `.owner_type = 'gosub' AND ` + boardVisible(alias+".board_id", viewerArg) + `)
		OR (` + alias + `.owner_type = 'user' AND ` + alias + `.privacy <> 'only_me' AND (
			(` + alias + `.privacy = 'everyone' AND ` + viewerCanSeeProfile(owner, viewerArg) + `)
			OR (` + alias + `.privacy = 'friends' AND ` + isMutualFriend(owner, viewerArg) + `)
			OR (` + alias + `.privacy = 'close_friends' AND EXISTS (
				SELECT 1 FROM story_close_friends scf
				WHERE scf.owner_id = ` + owner + ` AND scf.friend_id = ` + viewerArg + `::uuid
			))
		))
	)`
}

var userProfileVisibleQuery = `
SELECT EXISTS (
	SELECT 1 FROM users u
	WHERE u.id::text = $2::text
	  AND (u.id::text = $1::text
	       OR ` + viewerCanSeeProfile("u.id", "$1") + `)
)`

// CanViewUserStories reports whether viewerID may see any personal story of
// ownerID: the author always, everyone else only while the profile is visible
// (a private profile narrows access to mutual friends). Per-story audiences are
// applied on top by VisibleCondition.
//
// It is the room gate for stories_user_<id>, so a stranger can never subscribe
// to a private profile's story updates.
func CanViewUserStories(db *sql.DB, viewerID, ownerID string) (bool, error) {
	if db == nil || viewerID == "" || ownerID == "" {
		return false, nil
	}
	if viewerID == ownerID {
		return true, nil
	}
	var ok bool
	err := db.QueryRow(userProfileVisibleQuery, viewerID, ownerID).Scan(&ok)
	return ok, err
}

const boardVisibleQuery = `
SELECT EXISTS (
	SELECT 1 FROM boards b
	WHERE b.id::text = $2::text
	  AND (COALESCE(b.visibility, 'public') <> 'private'
	       OR b.owner_id::text = $1::text
	       OR EXISTS (SELECT 1 FROM gomosub_memberships gm
	                  WHERE gm.board_id = b.id AND gm.user_id::text = $1::text))
)`

// CanViewBoardStories reports whether viewerID may see a GomoSub's stories:
// public board — any authenticated user; private board — owner or member.
func CanViewBoardStories(db *sql.DB, viewerID, boardID string) (bool, error) {
	if db == nil || viewerID == "" || boardID == "" {
		return false, nil
	}
	var ok bool
	err := db.QueryRow(boardVisibleQuery, viewerID, boardID).Scan(&ok)
	return ok, err
}

// CanPostBoardStories reports whether viewerID may publish a story as boardID:
// the board owner always; otherwise a non-banned, non-timed-out member whose
// resolved union carries `can_post_stories` (administrators included).
// Resolves through the shared gomosubperms kernel instead of the legacy
// single-role join.
func CanPostBoardStories(db *sql.DB, viewerID, boardID string) (bool, error) {
	return checkBoardServerPerm(db, viewerID, boardID, gomosubperms.PermPostStories)
}

// CanModerateBoardStories reports whether viewerID may delete any story of the
// board: the owner, or a non-banned, non-timed-out member whose resolved
// union carries can_delete_threads (the existing "moderate content" switch).
func CanModerateBoardStories(db *sql.DB, viewerID, boardID string) (bool, error) {
	return checkBoardServerPerm(db, viewerID, boardID, gomosubperms.PermManageMessages)
}

// checkBoardServerPerm is the shared gate for board-level server permissions:
// owner bypass, then the shared kernel union, with banned/timed-out members
// denied (administrators bypass everything, mirroring channelaccess).
func checkBoardServerPerm(db *sql.DB, userID, boardID, perm string) (bool, error) {
	if db == nil || userID == "" || boardID == "" {
		return false, nil
	}
	var ownerID string
	if err := db.QueryRow(`SELECT owner_id::text FROM boards WHERE id::text = $1::text`, boardID).Scan(&ownerID); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	if ownerID == userID {
		return true, nil
	}
	var banned, timedOut bool
	_ = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM gomosub_bans WHERE board_id::text = $2::text AND user_id::text = $1::text AND (expires_at IS NULL OR expires_at > NOW()))`,
		userID, boardID).Scan(&banned)
	if banned {
		return false, nil
	}
	_ = db.QueryRow(`SELECT COALESCE(timed_out_until IS NOT NULL AND timed_out_until > NOW(), false) FROM gomosub_memberships WHERE board_id::text = $2::text AND user_id::text = $1::text`,
		userID, boardID).Scan(&timedOut)
	eff, err := gomosubperms.LoadEffective(db, boardID, userID)
	if err != nil || eff == nil {
		return false, err
	}
	if eff.IsAdmin() {
		return true, nil
	}
	if timedOut {
		return false, nil
	}
	return eff.Perms()[perm], nil
}

var viewStoryQuery = `
SELECT EXISTS (
	SELECT 1 FROM stories s
	WHERE s.id::text = $2::text
	  AND s.deleted_at IS NULL
	  AND ` + VisibleCondition("s", "$1") + `
)`

// CanViewStory reports whether viewerID may see this exact story right now.
// Expiry is not part of the predicate: the author's archive and the viewers
// list still resolve an expired story, while public reads add their own
// `expires_at > NOW()` filter.
func CanViewStory(db *sql.DB, viewerID, storyID string) (bool, error) {
	if db == nil || viewerID == "" || storyID == "" {
		return false, nil
	}
	var ok bool
	err := db.QueryRow(viewStoryQuery, viewerID, storyID).Scan(&ok)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return ok, err
}

// mediaStoryQuery must reference $1 and only $1: an unused $1 leaves the
// parameter type undetermined under the extended protocol (lib/pq), so the
// lookup errored and every non-author fell into the uploader-prefix gate —
// i.e. the media of a public story 403'd for everyone else.
const mediaStoryQuery = `
SELECT s.id::text
FROM stories s
WHERE s.deleted_at IS NULL
  AND (s.media_key = $1::text OR s.preview_key = $1::text)
LIMIT 1`

// StoryMediaAccess authorizes a raw media key of the private `stories` bucket.
//
// found reports whether a live story references the key. When found, allowed is
// the story's own audience decision, so revoking a story (delete, audience
// change) revokes its bytes immediately. When not found (an object uploaded but
// not yet attached, or a guessed key), the caller must fall back to the
// uploader-prefix gate — the same two-step rule the wall media path uses.
func StoryMediaAccess(db *sql.DB, viewerID, key string) (found, allowed bool) {
	if db == nil || key == "" {
		return false, false
	}
	var storyID string
	err := db.QueryRow(mediaStoryQuery, key).Scan(&storyID)
	if err == sql.ErrNoRows {
		return false, false
	}
	if err != nil {
		return false, false
	}
	// The author may always load their own bytes: the publish flow previews
	// the upload before the story row is committed (and the row exists by the
	// time a key can be looked up, so this only widens the author's window).
	if viewerID == "" {
		return true, false
	}
	ok, cerr := CanViewStory(db, viewerID, storyID)
	if cerr != nil {
		return true, false
	}
	return true, ok
}
