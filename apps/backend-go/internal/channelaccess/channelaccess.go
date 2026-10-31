// Package channelaccess holds the shared visibility rules for GomoSub
// text channels. It is a leaf package so both the REST handlers
// (internal/gomosubchat) and the WebSocket hub room gate can call the exact
// same predicate — mirroring how privacy.CanViewWall is shared between the
// hub wall-room gate and the REST paths.
//
// Rules (v2, Discord-like):
//   - Banned users (gomosub_bans, not expired) are denied everything.
//   - Board owner and administrator holders bypass all checks.
//   - Server permission = union of @everyone + all assigned roles
//     (gomosub_member_roles plus the legacy gomosub_memberships.role_id).
//   - Channel overwrites (channel_permissions.allow/deny, JSONB) apply on top;
//     any deny wins. Legacy can_read/can_write booleans are the fallback when
//     allow/deny are both empty.
//   - Read: a public channel of a public board is readable by any
//     authenticated user; otherwise membership (or a view_channel overwrite)
//     is required.
//   - Write: members only (chat stays member-only); timed-out members cannot
//     write; private channels additionally require send_messages.
//   - Moderate: owner or a member whose effective set carries
//     can_delete_threads (manage_messages).
package channelaccess

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/gomo6/backend/internal/gomosubperms"
)

type channelScope struct {
	boardID   string
	isPrivate bool
	ownerID   string
	visiblity string
}

func loadScope(db *sql.DB, channelID string) (*channelScope, error) {
	var s channelScope
	var isPrivate sql.NullBool
	var visibility sql.NullString
	var ownerID sql.NullString
	var boardID sql.NullString
	err := db.QueryRow(`
		SELECT ch.board_id, COALESCE(ch.is_private, false), b.owner_id, b.visibility
		FROM channels ch JOIN boards b ON b.id = ch.board_id
		WHERE ch.id = $1`, channelID).Scan(&boardID, &isPrivate, &ownerID, &visibility)
	if err != nil {
		return nil, err
	}
	s.boardID = boardID.String
	s.isPrivate = isPrivate.Bool
	s.ownerID = ownerID.String
	s.visiblity = visibility.String
	return &s, nil
}

func isBanned(db *sql.DB, boardID, userID string) bool {
	var banned bool
	_ = db.QueryRow(`
		SELECT EXISTS(SELECT 1 FROM gomosub_bans
			WHERE board_id = $1 AND user_id = $2
			AND (expires_at IS NULL OR expires_at > NOW()))`,
		boardID, userID).Scan(&banned)
	return banned
}

// roleRow carries one role's permission map plus its @everyone flag.
type roleRow struct {
	perms      map[string]bool
	isEveryone bool
}

// loadRoleMaps returns the permission maps of every role granted to the user
// on the board: @everyone counts only for members (callers pass isMember).
func loadRoleMaps(db *sql.DB, boardID, userID string, isMember bool) []map[string]bool {
	rows, err := db.Query(`
		SELECT gr.permissions, COALESCE(gr.is_everyone, false)
		FROM gomosub_roles gr
		WHERE gr.board_id = $1 AND (
			(COALESCE(gr.is_everyone, false) = TRUE)
			OR EXISTS(SELECT 1 FROM gomosub_member_roles mr
				WHERE mr.role_id = gr.id AND mr.user_id = $2 AND mr.board_id = $1)
			OR EXISTS(SELECT 1 FROM gomosub_memberships gm
				WHERE gm.role_id = gr.id AND gm.user_id = $2 AND gm.board_id = $1)
		)`, boardID, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]bool
	for rows.Next() {
		var raw json.RawMessage
		var everyone bool
		if err := rows.Scan(&raw, &everyone); err != nil {
			continue
		}
		if everyone && !isMember {
			continue
		}
		m := map[string]bool{}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &m)
		}
		out = append(out, m)
	}
	return out
}

// loadOverwrites returns the union of allow/deny maps for the user's roles on
// one channel (role-level only, no per-member overwrites yet). Legacy
// can_read/can_write feed view_channel/send_messages when allow/deny are
// empty for that row.
func loadOverwrites(db *sql.DB, channelID, boardID, userID string, isMember bool) (allows, denies []map[string]bool) {
	rows, err := db.Query(`
		SELECT cp.allow, cp.deny, COALESCE(cp.can_read, true), COALESCE(cp.can_write, true),
		       COALESCE(gr.is_everyone, false)
		FROM channel_permissions cp
		JOIN gomosub_roles gr ON gr.id = cp.role_id
		WHERE cp.channel_id = $1 AND gr.board_id = $2 AND (
			(COALESCE(gr.is_everyone, false) = TRUE)
			OR EXISTS(SELECT 1 FROM gomosub_member_roles mr
				WHERE mr.role_id = gr.id AND mr.user_id = $3)
			OR EXISTS(SELECT 1 FROM gomosub_memberships gm
				WHERE gm.role_id = gr.id AND gm.user_id = $3 AND gm.board_id = $2)
		)`, channelID, boardID, userID)
	if err != nil {
		return nil, nil
	}
	defer rows.Close()
	for rows.Next() {
		var allowRaw, denyRaw json.RawMessage
		var canRead, canWrite, everyone bool
		if err := rows.Scan(&allowRaw, &denyRaw, &canRead, &canWrite, &everyone); err != nil {
			continue
		}
		if everyone && !isMember {
			continue
		}
		allow := map[string]bool{}
		deny := map[string]bool{}
		if len(allowRaw) > 0 {
			_ = json.Unmarshal(allowRaw, &allow)
		}
		if len(denyRaw) > 0 {
			_ = json.Unmarshal(denyRaw, &deny)
		}
		if len(allow) == 0 && len(deny) == 0 {
			if canRead {
				allow[gomosubperms.PermViewChannel] = true
			} else {
				deny[gomosubperms.PermViewChannel] = true
			}
			if canWrite {
				allow[gomosubperms.PermSendMessages] = true
			} else {
				deny[gomosubperms.PermSendMessages] = true
			}
		}
		allows = append(allows, allow)
		denies = append(denies, deny)
	}
	return allows, denies
}

func membershipStatus(db *sql.DB, boardID, userID string) (isMember bool, timedOut bool) {
	var since sql.NullTime
	err := db.QueryRow(`
		SELECT timed_out_until FROM gomosub_memberships
		WHERE board_id = $1 AND user_id = $2`, boardID, userID).Scan(&since)
	if err != nil {
		return false, false
	}
	isMember = true
	if since.Valid && since.Time.After(time.Now()) {
		timedOut = true
	}
	return isMember, timedOut
}

// hasExplicitViewDeny reports whether any overwrite row explicitly denies
// viewing (as opposed to the grant simply being absent).
func hasExplicitViewDeny(denies []map[string]bool) bool {
	for _, d := range denies {
		if d[gomosubperms.PermViewChannel] {
			return true
		}
	}
	return false
}

// effectiveSet unions the user's server-level grants on a board.
func effectiveSet(db *sql.DB, boardID, userID string, isMember bool) map[string]bool {
	return gomosubperms.Union(loadRoleMaps(db, boardID, userID, isMember)...)
}

// CanReadChannel reports whether userID may see the message history of the
// text channel channelID. userID must be non-empty (the caller is responsible
// for requiring authentication).
//
// Visibility model (Discord-like): owners and administrators see everything.
// Guests and non-members preview public channels of public boards. Members
// need a view grant — the server-wide view_channel (usually from @everyone)
// or a channel overwrite — on top of which an explicit deny hides the channel
// from anyone but owners and administrators. Private channels stay
// members-visible (overwrites only add outsiders).
func CanReadChannel(db *sql.DB, userID, channelID string) (bool, error) {
	if userID == "" || channelID == "" {
		return false, nil
	}
	scope, err := loadScope(db, channelID)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	if isBanned(db, scope.boardID, userID) {
		return false, nil
	}
	if scope.ownerID == userID {
		return true, nil
	}
	isMember, _ := membershipStatus(db, scope.boardID, userID)
	eff := effectiveSet(db, scope.boardID, userID, isMember)
	if gomosubperms.IsAdmin(eff) {
		return true, nil
	}
	allows, denies := loadOverwrites(db, channelID, scope.boardID, userID, isMember)
	resolved := gomosubperms.ApplyOverwrites(eff, allows, denies)
	if !resolved[gomosubperms.PermViewChannel] && hasExplicitViewDeny(denies) {
		return false, nil
	}
	if !isMember {
		// Outsiders preview public channels of public boards; anything else
		// needs an explicit overwrite grant (e.g. an invited stranger).
		if !scope.isPrivate && scope.visiblity != "private" {
			return true, nil
		}
		return resolved[gomosubperms.PermViewChannel], nil
	}
	// Members: private channels are members-visible (legacy; overwrites only
	// add outsiders), public channels require the view grant — the
	// server-wide @everyone default or an overwrite. Turning the base grant
	// off hides everything but granted channels (Discord lockdown).
	if scope.isPrivate {
		return true, nil
	}
	return resolved[gomosubperms.PermViewChannel], nil
}

// CanWriteChannel reports whether userID may post into channelID: the board
// owner always; otherwise a non-banned, non-timed-out member, with
// send_messages required on private channels (and respected as deny anywhere).
func CanWriteChannel(db *sql.DB, userID, channelID string) (bool, error) {
	if userID == "" || channelID == "" {
		return false, nil
	}
	scope, err := loadScope(db, channelID)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	if isBanned(db, scope.boardID, userID) {
		return false, nil
	}
	if scope.ownerID == userID {
		return true, nil
	}
	isMember, timedOut := membershipStatus(db, scope.boardID, userID)
	if !isMember || timedOut {
		return false, nil
	}
	eff := effectiveSet(db, scope.boardID, userID, true)
	if gomosubperms.IsAdmin(eff) {
		return true, nil
	}
	allows, denies := loadOverwrites(db, channelID, scope.boardID, userID, true)
	resolved := gomosubperms.ApplyOverwrites(eff, allows, denies)
	if !scope.isPrivate {
		// Public channel: membership suffices unless explicitly denied.
		for _, d := range denies {
			if d[gomosubperms.PermSendMessages] {
				return false, nil
			}
		}
		return true, nil
	}
	return resolved[gomosubperms.PermSendMessages], nil
}

// CanModerateChannel reports whether userID may delete other users' messages
// in channelID: the board owner, an administrator, or a member whose
// effective set carries the manage-messages grant.
func CanModerateChannel(db *sql.DB, userID, channelID string) (bool, error) {
	if userID == "" || channelID == "" {
		return false, nil
	}
	scope, err := loadScope(db, channelID)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	if isBanned(db, scope.boardID, userID) {
		return false, nil
	}
	if scope.ownerID == userID {
		return true, nil
	}
	isMember, _ := membershipStatus(db, scope.boardID, userID)
	if !isMember {
		return false, nil
	}
	eff := effectiveSet(db, scope.boardID, userID, true)
	if gomosubperms.IsAdmin(eff) {
		return true, nil
	}
	return eff[gomosubperms.PermManageMessages], nil
}
