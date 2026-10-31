// Package gomosubaudit records who did what on a GomoSub: kicks, bans,
// timeouts, role/channel/category/overwrite changes. The Discord audit-log
// equivalent. Writes are best-effort and never fail the action that caused
// them; reads go through a dedicated RPC (never the generic CRUD surface,
// whose user-scoped reads cannot express "moderators may read").
package gomosubaudit

import (
	"context"
	"database/sql"
	"time"
)

// Moderation and management actions recorded in the log.
const (
	ActionKick            = "kick"
	ActionBan             = "ban"
	ActionUnban           = "unban"
	ActionTimeout         = "timeout"
	ActionUntimeout       = "untimeout"
	ActionRoleCreate      = "role_create"
	ActionRoleUpdate      = "role_update"
	ActionRoleDelete      = "role_delete"
	ActionGrant           = "grant"
	ActionRevoke          = "revoke"
	ActionChannelCreate   = "channel_create"
	ActionChannelUpdate   = "channel_update"
	ActionChannelDelete   = "channel_delete"
	ActionCategoryCreate  = "category_create"
	ActionCategoryUpdate  = "category_update"
	ActionCategoryDelete  = "category_delete"
	ActionOverwriteUpdate = "overwrite_update"
)

// Entry is one audit row to record.
type Entry struct {
	BoardID         string
	ActorID         string
	Action          string
	TargetUserID    *string
	TargetRoleID    *string
	TargetChannelID *string
	Reason          *string
}

// nullString maps "" to a NULL bind parameter.
func nullString(s *string) interface{} {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// Log writes one audit entry. It never returns an error to the caller path —
// failures are swallowed (best-effort, like achievements emission) because
// the audited action itself must not fail when the ledger is unavailable.
func Log(db *sql.DB, e Entry) {
	if db == nil || e.BoardID == "" || e.Action == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = db.ExecContext(ctx, `
		INSERT INTO gomosub_audit_log
		    (board_id, actor_id, action, target_user_id, target_role_id, target_channel_id, reason)
		VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7)
	`, e.BoardID, nullString(&e.ActorID), e.Action,
		nullString(e.TargetUserID), nullString(e.TargetRoleID), nullString(e.TargetChannelID),
		nullString(e.Reason))
}
