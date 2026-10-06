// Package moderation implements the content-reporting and triage flow.
//
// Reports are polymorphic: a report points at any content type (thread, post in
// a thread, wall post, wall comment, user) via (target_type, target_id) rather
// than a hard FK to one table. Users file one report per target; moderators see
// a queue grouped by target, filter it, and resolve or reject reports with a
// reason — every action is written to the append-only moderation_actions log.
//
// Private messages are deliberately out of scope: the messenger emits no events
// and no DM content is ever readable by moderation.
//
// The reports surface is NOT part of the generic CRUD registry: reads are
// sensitive (reporter identities) and writes carry business rules, so the
// package ships dedicated handlers. Real-time fan-out to open moderation
// screens happens via the WebSocket "moderation" room (new_report events).
package moderation

import (
	"context"
	"database/sql"
	"time"

	"github.com/gomo6/backend/internal/authz"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// Target types a report can point at. Mirrored by the frontend ReportDialog.
const (
	TargetWallPost    = "wall_post"
	TargetWallComment = "wall_comment"
	TargetThread      = "thread"
	TargetPost        = "post"
	TargetUser        = "user"
	TargetGomosub     = "gomosub"
)

// targetExistenceQuery maps a target type to the query that checks its row
// exists. A closed map (no user input reaches the SQL text) is what makes the
// polymorphic target type safe.
var targetExistenceQuery = map[string]string{
	TargetWallPost:    `SELECT EXISTS(SELECT 1 FROM profile_wall_posts WHERE id = $1)`,
	TargetWallComment: `SELECT EXISTS(SELECT 1 FROM profile_wall_post_comments WHERE id = $1)`,
	TargetThread:      `SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)`,
	TargetPost:        `SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)`,
	TargetUser:        `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`,
	TargetGomosub:     `SELECT EXISTS(SELECT 1 FROM boards WHERE id = $1 AND is_gomosub = TRUE)`,
}

// targetPreviewQuery returns, for a batch of ids, the display context of each
// target: id, title, body, author (username + id), creation time and two
// opaque context ids used to build a "open the content" link. One query per type
// (batch, never per row) is what keeps the queue free of an N+1.
//
// Fixed column list: (id::text, title, body, author_username, author_id::text,
// created_at, ctx1::text, ctx2::text). ctx1/ctx2 mean, per type:
//
//	wall_post    ctx1 = wall owner id            → /profile/<ctx1>/wall/<id>
//	wall_comment ctx1 = wall owner id, ctx2 = post id → /profile/<ctx1>/wall/<ctx2>
//	thread       —                               → /thread/<id>
//	post         ctx1 = thread id                → /thread/<ctx1>
//	user         —                               → /profile/<id>
//	gomosub      ctx1 = slug                     → /g/<ctx1>
var targetPreviewQuery = map[string]string{
	TargetWallPost: `
		SELECT p.id::text, COALESCE(p.title, ''), COALESCE(p.content, ''),
		       COALESCE(u.username, ''), p.author_id::text, p.created_at,
		       p.user_id::text, NULL::text
		FROM profile_wall_posts p LEFT JOIN users u ON u.id = p.author_id
		WHERE p.id = ANY($1::uuid[])`,
	TargetWallComment: `
		SELECT c.id::text, '', COALESCE(c.content, ''),
		       COALESCE(u.username, ''), c.user_id::text, c.created_at,
		       p.user_id::text, c.post_id::text
		FROM profile_wall_post_comments c
		LEFT JOIN users u ON u.id = c.user_id
		LEFT JOIN profile_wall_posts p ON p.id = c.post_id
		WHERE c.id = ANY($1::uuid[])`,
	TargetThread: `
		SELECT t.id::text, COALESCE(t.title, ''), COALESCE(t.content, ''),
		       COALESCE(u.username, ''), t.user_id::text, t.created_at,
		       NULL::text, NULL::text
		FROM threads t LEFT JOIN users u ON u.id = t.user_id
		WHERE t.id = ANY($1::uuid[])`,
	TargetPost: `
		SELECT p.id::text, '', COALESCE(p.content, ''),
		       COALESCE(u.username, ''), p.user_id::text, p.created_at,
		       p.thread_id::text, NULL::text
		FROM posts p LEFT JOIN users u ON u.id = p.user_id
		WHERE p.id = ANY($1::uuid[])`,
	TargetUser: `
		SELECT u.id::text, COALESCE(u.display_name, ''), COALESCE(u.bio, ''),
		       u.username, u.id::text, u.created_at,
		       NULL::text, NULL::text
		FROM users u WHERE u.id = ANY($1::uuid[])`,
	TargetGomosub: `
		SELECT b.id::text, COALESCE(b.name, ''), COALESCE(b.description, ''),
		       COALESCE(u.username, ''), b.owner_id::text, b.created_at,
		       b.slug, NULL::text
		FROM boards b LEFT JOIN users u ON u.id = b.owner_id
		WHERE b.id = ANY($1::uuid[]) AND b.is_gomosub = TRUE`,
}

// Handler serves the moderation REST surface.
type Handler struct {
	db    *sql.DB
	redis *redis.Client
	hub   *websocket.Hub
	notif *notifications.Service
}

// NewHandler wires the moderation handler. redis/hub may be nil in tests —
// cache invalidation and realtime fan-out are skipped silently when absent.
func NewHandler(db *sql.DB, redis *redis.Client, hub *websocket.Hub) *Handler {
	return &Handler{db: db, redis: redis, hub: hub}
}

// SetNotifier wires the notification service so sanctions can tell the affected
// user why they were applied. Nil disables that delivery path.
func (h *Handler) SetNotifier(n *notifications.Service) {
	h.notif = n
}

// ReportItem is one report as seen in the moderation queue, with the reporter's
// profile embedded.
type ReportItem struct {
	ID         string   `json:"id"`
	TargetType string   `json:"target_type"`
	TargetID   string   `json:"target_id"`
	ReporterID string   `json:"reporter_id"`
	Reporter   reporter `json:"reporter"`
	Category   string   `json:"category"`
	Reason     string   `json:"reason"`
	Status     string   `json:"status"`
	// Source is "user" for human reports and "system" for auto-signals from the
	// activity ledger (which have no reporter).
	Source     string     `json:"source"`
	ReasonCode *string    `json:"reason_code,omitempty"`
	Note       *string    `json:"resolution_note,omitempty"`
	CreatedAt  *time.Time `json:"created_at"`
	// TargetLink is the in-app path to the reported content, filled where the
	// caller has the target previews at hand (the user card).
	TargetLink string `json:"target_link,omitempty"`
}

// TargetInfo is the display context of a reported target. Exists is false when
// the content was deleted after it was reported — the moderator can still
// dismiss the surviving reports.
type TargetInfo struct {
	Type           string     `json:"type"`
	ID             string     `json:"id"`
	Exists         bool       `json:"exists"`
	Title          string     `json:"title,omitempty"`
	Content        string     `json:"content,omitempty"`
	AuthorUsername string     `json:"author_username,omitempty"`
	AuthorID       string     `json:"author_id,omitempty"`
	CreatedAt      *time.Time `json:"created_at,omitempty"`
	// Link is the in-app path that opens the reported content (built from the
	// type's context ids — see targetPreviewQuery). Empty when unknown.
	Link string `json:"link,omitempty"`
}

// ReportGroup is one target of the queue: its display context plus every report
// filed against it. OpenCount counts OPEN reports (the queue's sort key);
// TotalCount counts all of them for context.
type ReportGroup struct {
	Target     TargetInfo   `json:"target"`
	Reports    []ReportItem `json:"reports"`
	OpenCount  int          `json:"open_count"`
	TotalCount int          `json:"total_count"`
	LastAt     *time.Time   `json:"last_at"`
}

// QueuePage is the paginated, filtered moderation queue.
type QueuePage struct {
	Items  []ReportGroup `json:"items"`
	Total  int           `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}

// CategoryLabels maps report categories to their Russian labels for the
// moderation UI. Mirrored on the frontend (ReportDialog).
var CategoryLabels = map[string]string{
	"spam":     "Спам/реклама",
	"abuse":    "Оскорбления",
	"hate":     "Разжигание ненависти",
	"fraud":    "Мошенничество",
	"explicit": "Взрослый контент",
	"other":    "Другое",
}

type reporter struct {
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

// isModerator reports whether the user holds the platform 'moderator' or
// 'admin' role in user_roles — the same predicate the post/thread delete
// handlers use for foreign-content moderation.
func isModerator(db *sql.DB, userID string) (bool, error) {
	return authz.IsModerator(context.Background(), db, userID)
}

// hasModerationRead reports whether the user may READ the moderation surface
// (helper, moderator or admin).
func hasModerationRead(db *sql.DB, userID string) (bool, error) {
	return authz.HasModerationReadAccess(context.Background(), db, userID)
}

// PurgeReportsForTarget deletes every report filed against one target. It is
// called by the content delete paths (a deleted target's reports must not linger
// in the queue now that the FK cascade is gone). Best-effort: callers ignore the
// error so a report cleanup can never fail a content deletion.
func PurgeReportsForTarget(ctx context.Context, db *sql.DB, targetType, targetID string) error {
	if db == nil || targetID == "" {
		return nil
	}
	if _, ok := targetExistenceQuery[targetType]; !ok {
		return nil
	}
	_, err := db.ExecContext(ctx,
		`DELETE FROM content_reports WHERE target_type = $1 AND target_id = $2`,
		targetType, targetID)
	return err
}
