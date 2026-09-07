// Package moderation implements the content-reporting flow for profile-wall
// posts: users file reports (one per user per post), moderators see a queue
// grouped by post and sorted by report count, and can resolve reports or
// delete the offending post outright.
//
// The reports surface is deliberately NOT part of the generic CRUD registry:
// reads are sensitive (they expose every report with reporter identities) and
// writes carry business rules (dedupe per user, moderator-only triage), so the
// package ships dedicated handlers instead. Real-time fan-out to open
// moderation screens happens via the WebSocket "moderation" room (new_report
// events), so a fresh report appears in the queue immediately.
package moderation

import (
	"database/sql"
	"time"

	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// Handler serves the moderation REST surface.
type Handler struct {
	db    *sql.DB
	redis *redis.Client
	hub   *websocket.Hub
}

// NewHandler wires the moderation handler. redis/hub may be nil in tests —
// cache invalidation and realtime fan-out are skipped silently when absent.
func NewHandler(db *sql.DB, redis *redis.Client, hub *websocket.Hub) *Handler {
	return &Handler{db: db, redis: redis, hub: hub}
}

// ReportItem is one report as seen in the moderation queue, with the
// reporter's profile embedded.
type ReportItem struct {
	ID         string     `json:"id"`
	PostID     string     `json:"post_id"`
	ReporterID string     `json:"reporter_id"`
	Reporter   reporter   `json:"reporter"`
	Category   string     `json:"category"`
	Reason     string     `json:"reason"`
	Status     string     `json:"status"`
	CreatedAt  *time.Time `json:"created_at"`
}

// CategoryLabels maps report categories to their Russian labels for the
// moderation UI. Mirrored on the frontend (ReportDialog); kept here for
// backend-side display needs.
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

// ReportGroup is one post of the queue: the enriched post row plus every
// report filed against it. report_count counts OPEN reports only — resolved
// reports stay visible in the expanded list for history but no longer push the
// post up the queue.
type ReportGroup struct {
	Post        map[string]interface{} `json:"post"`
	Reports     []ReportItem           `json:"reports"`
	ReportCount int                    `json:"report_count"`
	OpenCount   int                    `json:"open_count"`
}

// isModerator reports whether the user holds the platform 'moderator' or
// 'admin' role in user_roles — the same predicate the post/thread delete
// handlers use for foreign-content moderation.
func isModerator(db *sql.DB, userID string) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role IN ('moderator', 'admin')`, userID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}
