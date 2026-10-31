// Package gomosubperms is the single source of truth for Discord-like
// GomoSub permission resolution (Stage 1 of the gomosub overhaul).
//
// Model:
//   - Every board has an @everyone role (gomosub_roles.is_everyone) that
//     applies to all members as the base set.
//   - Users hold 0..N extra roles via gomosub_member_roles; the legacy
//     gomosub_memberships.role_id column is treated as one more grant so old
//     rows keep working during the migration window.
//   - Effective server permission = union of @everyone + all assigned roles.
//     "administrator" grants everything (owner always counts as admin).
//   - Channel overwrites (channel_permissions.allow/deny, JSONB maps) apply
//     on top: any deny wins over allows (Discord semantics, simplified —
//     no separate member-level overwrites yet).
//   - Legacy can_read/can_write booleans are a fallback when allow/deny are
//     both empty.
package gomosubperms

import (
	"database/sql"
	"encoding/json"
)

// RoleGrant is one role's server-level grants as stored.
type RoleGrant struct {
	ID          string
	Name        string
	Permissions map[string]bool
	Position    int
	IsEveryone  bool
}

// Effective is a user's resolved server-level standing on a board: the
// union of @everyone (members only) plus every assigned role, with the top
// role position. The single source of truth — every enforcement point
// (channel read/write/moderate, forum writes, generic CRUD gate, moderation
// RPC, thread list predicate) resolves through this instead of re-querying
// and re-unioning on its own.
type Effective struct {
	Roles    []RoleGrant
	IsMember bool
	top      int
}

// LoadEffective reads membership plus the full role union in two queries.
// @everyone counts only for members; outsiders get top -1 and no base.
func LoadEffective(db *sql.DB, boardID, userID string) (*Effective, error) {
	e := &Effective{top: -1}
	if db == nil || boardID == "" || userID == "" {
		return e, nil
	}
	_ = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2)`,
		boardID, userID).Scan(&e.IsMember)
	rows, err := db.Query(`
		SELECT gr.id, gr.name, gr.permissions, gr.position, COALESCE(gr.is_everyone, false)
		FROM gomosub_roles gr
		WHERE gr.board_id = $1 AND (
			(COALESCE(gr.is_everyone, false) = TRUE)
			OR EXISTS(SELECT 1 FROM gomosub_member_roles mr
				WHERE mr.role_id = gr.id AND mr.user_id = $2 AND mr.board_id = $1)
			OR EXISTS(SELECT 1 FROM gomosub_memberships gm
				WHERE gm.role_id = gr.id AND gm.user_id = $2 AND gm.board_id = $1)
		)
		ORDER BY gr.position DESC
	`, boardID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var g RoleGrant
		var raw json.RawMessage
		var everyone bool
		if err := rows.Scan(&g.ID, &g.Name, &raw, &g.Position, &everyone); err != nil {
			continue
		}
		g.IsEveryone = everyone
		if everyone && !e.IsMember {
			continue
		}
		g.Permissions = map[string]bool{}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &g.Permissions)
		}
		if everyone {
			if e.top < 0 {
				e.top = 0
			}
		} else if g.Position > e.top {
			e.top = g.Position
		}
		e.Roles = append(e.Roles, g)
	}
	return e, rows.Err()
}

// Perms returns the union of all considered grants (explicit false counts as
// absent — role permissions are binary, deny lives on channel overwrites).
func (e *Effective) Perms() map[string]bool {
	maps := make([]map[string]bool, 0, len(e.Roles))
	for _, r := range e.Roles {
		maps = append(maps, r.Permissions)
	}
	return Union(maps...)
}

// Top returns the highest role position (@everyone counts as 0 for members,
// outsiders get -1).
func (e *Effective) Top() int {
	return e.top
}

// IsAdmin reports whether the resolved set carries the administrator grant.
func (e *Effective) IsAdmin() bool {
	return IsAdmin(e.Perms())
}

// Canonical server permission keys. The six legacy can_* keys stay valid;
// the new keys bring the model close to Discord.
const (
	PermAdministrator  = "administrator"
	PermManageRoles    = "can_manage_roles"
	PermManageChannels = "can_manage_channels"
	PermManageMembers  = "can_manage_members"
	PermKickMembers    = "kick_members"
	PermBanMembers     = "ban_members"
	PermTimeoutMembers = "timeout_members"
	PermManageMessages = "can_delete_threads" // legacy name, Discord manage_messages
	PermPinThreads     = "can_pin_threads"
	PermPostStories    = "can_post_stories"
	PermViewChannel    = "view_channel"
	PermSendMessages   = "send_messages"
)

// OwnerPermissions is the full grant returned for board owners (and
// administrator holders). Keep in sync with rpc.GetBoardUserPermissions.
func OwnerPermissions() map[string]bool {
	return map[string]bool{
		PermAdministrator:  true,
		PermManageRoles:    true,
		PermManageChannels: true,
		PermManageMembers:  true,
		PermKickMembers:    true,
		PermBanMembers:     true,
		PermTimeoutMembers: true,
		PermManageMessages: true,
		PermPinThreads:     true,
		PermPostStories:    true,
		PermViewChannel:    true,
		PermSendMessages:   true,
	}
}

// Union merges role permission maps: any true wins, explicit false counts
// as absent (Discord parity: role permissions are binary, deny lives only
// on channel overwrites). A nil map is skipped.
func Union(roles ...map[string]bool) map[string]bool {
	out := map[string]bool{}
	for _, r := range roles {
		for k, v := range r {
			if v {
				out[k] = true
			}
		}
	}
	return out
}

// RoleScopeCTE returns a WITH clause exposing the caller's role ids as
// my_roles(id) for the given $board/$user parameter placeholders. It is the
// only SQL spelling of role membership: channel overwrites and admin checks
// that must filter inside the database reuse it instead of copying the union
// condition (interpretation of the rows always goes through LoadEffective).
func RoleScopeCTE(boardParam, userParam string) string {
	return `
		WITH my_roles AS (
			SELECT gr.id
			FROM gomosub_roles gr
			WHERE gr.board_id = ` + boardParam + ` AND (
				(COALESCE(gr.is_everyone, false) = TRUE
					AND EXISTS(SELECT 1 FROM gomosub_memberships gm0
						WHERE gm0.board_id = ` + boardParam + ` AND gm0.user_id = ` + userParam + `))
				OR EXISTS(SELECT 1 FROM gomosub_member_roles mr
					WHERE mr.role_id = gr.id AND mr.user_id = ` + userParam + ` AND mr.board_id = ` + boardParam + `)
				OR EXISTS(SELECT 1 FROM gomosub_memberships gm
					WHERE gm.role_id = gr.id AND gm.user_id = ` + userParam + ` AND gm.board_id = ` + boardParam + `)
			)
		)`
}

// IsAdmin reports whether the effective set bypasses all checks.
func IsAdmin(effective map[string]bool) bool {
	return effective[PermAdministrator]
}

// ApplyOverwrites applies channel allow/deny maps on top of a server-level
// effective set. Deny always wins (Discord rule, simplified to role-level).
func ApplyOverwrites(base map[string]bool, allows, denies []map[string]bool) map[string]bool {
	out := map[string]bool{}
	for k, v := range base {
		out[k] = v
	}
	for _, a := range Union(allows...) {
		_ = a
	}
	allowed := Union(allows...)
	for k := range allowed {
		out[k] = true
	}
	for k := range Union(denies...) {
		out[k] = false
	}
	return out
}

// CanManageRole enforces hierarchy: owner/admin bypass; otherwise the actor's
// top role position must be strictly greater than the target's, and the actor
// needs manage_roles. Positions: higher = more authority; @everyone = 0.
func CanManageRole(isOwner, isAdmin bool, actorTop, targetTop int, actorCanManageRoles bool) bool {
	if isOwner || isAdmin {
		return true
	}
	if !actorCanManageRoles {
		return false
	}
	return actorTop > targetTop
}
