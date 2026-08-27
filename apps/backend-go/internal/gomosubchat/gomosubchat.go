// Package gomosubchat implements Discord-style text channels inside GomoSubs:
// a per-channel message stream that is deliberately separate from threads/posts
// (the forum domain), from the personal messenger (no E2E here — public chat
// content is moderatable), and from generic CRUD (specialized handlers so
// history pagination, membership rights and soft-delete stay exact).
package gomosubchat

import (
	"database/sql"
	"regexp"
	"time"

	"github.com/gomo6/backend/internal/websocket"
)

var uuidRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isUUID(s string) bool { return uuidRegex.MatchString(s) }

// MaxContentLength caps message content in runes. Everything above is rejected
// client-side too; the DB keeps TEXT without its own constraint by design.
const MaxContentLength = 4000

// Handler serves the channel-message REST surface.
type Handler struct {
	db  *sql.DB
	hub *websocket.Hub
}

// NewHandler wires the handler. hub may be nil in tests — realtime fan-out is
// skipped silently when absent.
func NewHandler(db *sql.DB, hub *websocket.Hub) *Handler {
	return &Handler{db: db, hub: hub}
}

// MessageResponse is one row of a channel's message stream as seen by clients.
// Deleted rows keep their shape but blank content — clients render a
// placeholder instead of dropping the entry out of the timeline.
type MessageResponse struct {
	ID        int64      `json:"id"`
	ChannelID string     `json:"channel_id"`
	UserID    string     `json:"user_id"`
	Username  string     `json:"username"`
	AvatarURL *string    `json:"avatar_url"`
	Content   string     `json:"content"`
	EditedAt  *time.Time `json:"edited_at,omitempty"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}
