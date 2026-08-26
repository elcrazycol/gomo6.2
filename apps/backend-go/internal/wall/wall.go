// Package wall implements the profile-wall domain of gomo6: the wall-list and
// wall-comment read queries (author embeds, interaction counts, keyset
// pagination, per-owner privacy gates), the write side effects of wall tables
// (notifications, WebSocket broadcasts, unified profile stats, dependent cache
// invalidation), the wall privacy gate on interactions and the achievement
// events of wall writes.
//
// The package was extracted from crudengine so the generic CRUD engine stays
// pure table plumbing: the engine's registry still owns the per-table
// declarations, and every wall-facing hook delegates here through the injected
// *Service (SetWall). Nothing in here imports crudengine — wall is a leaf
// domain service over {crud, privacy, profiles, notifications, achievements,
// websocket, cache, models, httpx}.
//
// All methods are nil-safe by contract: redis, hub, notif and achEngine may be
// nil in tests and in degraded deployments, and every optional interaction is
// skipped when its collaborator is missing.
package wall

import (
	"database/sql"

	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// Service owns the wall domain collaborators. It is wired once in routes.go
// and injected into the crudengine registry hooks via crudengine.SetWall.
type Service struct {
	db        *sql.DB
	redis     *redis.Client
	hub       *websocket.Hub
	notif     *notifications.Service
	achEngine *achievements.Engine
}

// New builds the wall service. redis/hub/notif may be nil — every method that
// touches them is guarded.
func New(db *sql.DB, redis *redis.Client, hub *websocket.Hub, notif *notifications.Service) *Service {
	return &Service{db: db, redis: redis, hub: hub, notif: notif}
}

// SetAchievementEngine wires the achievements engine for wall auto-unlock
// events. Nil-safe: without it, wall writes emit no achievement events.
func (s *Service) SetAchievementEngine(e *achievements.Engine) {
	s.achEngine = e
}
