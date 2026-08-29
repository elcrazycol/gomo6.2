// Package channelaccess holds the shared visibility rules for GomoSub text
// channels. It is a leaf package so both the REST handlers
// (internal/gomosubchat) and the WebSocket hub room gate can call the exact
// same predicate — mirroring how privacy.CanViewWall is shared between the
// hub wall-room gate and the REST paths.
//
// Rules (v1):
//   - Read: as forum channels — a public channel of a public board is readable
//     by any authenticated user; a private channel or private board requires
//     board ownership or gomosub membership (role can_read also grants read on
//     a private channel, matching the channel_permissions switches in settings).
//   - Write: members of the gomosub only (unlike thread creation, which lets
//     any authenticated user write to public channels — chat is member-only);
//     additionally a private channel requires a role with can_write.
//   - Moderate (delete others' messages): board owner or a role carrying
//     can_delete_threads.
package channelaccess

import (
	"database/sql"
)

const readQuery = `
SELECT EXISTS(
	SELECT 1 FROM channels ch
	JOIN boards b ON b.id = ch.board_id
	WHERE ch.id = $1
	AND (b.visibility != 'private' OR b.owner_id::text = $2
		OR EXISTS(SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = ch.board_id AND gm.user_id::text = $2))
	AND (COALESCE(ch.is_private, false) = false OR b.owner_id::text = $2
		OR EXISTS(SELECT 1 FROM gomosub_memberships gm2 WHERE gm2.board_id = ch.board_id AND gm2.user_id::text = $2)
		OR EXISTS(SELECT 1 FROM channel_permissions cp
			JOIN gomosub_memberships gm3 ON gm3.role_id = cp.role_id AND gm3.user_id::text = $2 AND gm3.board_id = ch.board_id
			WHERE cp.channel_id = ch.id AND cp.can_read = true))
)`

// CanReadChannel reports whether userID may see the message history of the
// text channel channelID. userID must be non-empty (the caller is responsible
// for requiring authentication).
func CanReadChannel(db *sql.DB, userID, channelID string) (bool, error) {
	var ok bool
	err := db.QueryRow(readQuery, channelID, userID).Scan(&ok)
	return ok, err
}

const writeQuery = `
SELECT b.owner_id::text = $2
	OR (
		EXISTS(SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = ch.board_id AND gm.user_id::text = $2)
		AND (COALESCE(ch.is_private, false) = false OR EXISTS(
			SELECT 1 FROM channel_permissions cp
			JOIN gomosub_memberships gm2 ON gm2.role_id = cp.role_id AND gm2.user_id::text = $2 AND gm2.board_id = ch.board_id
			WHERE cp.channel_id = ch.id AND cp.can_write = true))
	)
FROM channels ch
JOIN boards b ON b.id = ch.board_id
WHERE ch.id = $1`

// CanWriteChannel reports whether userID may post into channelID: the board
// owner always; otherwise a gomosub member whose channel is public or whose
// role carries can_write for a private channel.
func CanWriteChannel(db *sql.DB, userID, channelID string) (bool, error) {
	var ok bool
	err := db.QueryRow(writeQuery, channelID, userID).Scan(&ok)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return ok, err
}

const moderateQuery = `
SELECT EXISTS(
	SELECT 1 FROM channels ch
	JOIN boards b ON b.id = ch.board_id
	WHERE ch.id = $1
	AND (b.owner_id::text = $2 OR EXISTS(
		SELECT 1 FROM gomosub_roles gr
		JOIN gomosub_memberships gm ON gm.role_id = gr.id AND gm.user_id::text = $2 AND gm.board_id = ch.board_id
		WHERE gr.permissions @> '{"can_delete_threads": true}'::jsonb))
)`

// CanModerateChannel reports whether userID may delete other users' messages
// in channelID: the board owner or a member whose role carries the
// can_delete_threads permission.
func CanModerateChannel(db *sql.DB, userID, channelID string) (bool, error) {
	var ok bool
	err := db.QueryRow(moderateQuery, channelID, userID).Scan(&ok)
	return ok, err
}
