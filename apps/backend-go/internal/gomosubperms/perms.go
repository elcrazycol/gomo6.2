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

// Union merges role permission maps: any true wins. A nil map is skipped.
// Kept for callers that only need the allow side; prefer Partition+Resolve
// so explicit denies are honored.
func Union(roles ...map[string]bool) map[string]bool {
	allow, _ := Partition(roles...)
	return allow
}

// Partition splits role permission maps into explicit allows and explicit
// denies: true = allow, false = deny, absent = inherit (neutral). This is the
// tri-state model behind the role editor (deny left, neutral center, allow
// right): a deny on any of the holder's roles wins over allows, except for
// the administrator grant, which bypasses everything and is never denied.
func Partition(roles ...map[string]bool) (allow, deny map[string]bool) {
	allow = map[string]bool{}
	deny = map[string]bool{}
	for _, r := range roles {
		for k, v := range r {
			if v {
				allow[k] = true
			} else {
				deny[k] = true
			}
		}
	}
	return allow, deny
}

// Resolve folds an allow/deny pair into the effective grant set: deny wins
// over allow for the same key. The administrator key is special: an allow
// is honored, a deny is ignored (you cannot un-admin through a deny).
// Callers check IsAdmin on the allow side first for the full bypass.
func Resolve(allow, deny map[string]bool) map[string]bool {
	out := map[string]bool{}
	for k := range allow {
		if k == PermAdministrator {
			out[k] = true
			continue
		}
		if !deny[k] {
			out[k] = true
		}
	}
	return out
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
