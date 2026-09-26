package achievements

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// ──────────────── Events ────────────────

// EventType is a user action the engine reacts to. Constants for retired
// themes are kept so existing emitters keep compiling; the engine simply has no
// mapping for them and treats them as no-ops. The messenger NEVER emits events
// — private conversations are out of scope by design.
type EventType string

const (
	EventEntryCreated         EventType = "entry_created"   // thread or wall post
	EventImageUploaded        EventType = "image_uploaded"  // retired
	EventCommentCreated       EventType = "comment_created" // post-in-thread or wall comment
	EventLikeGiven            EventType = "like_given"      // any like by the user
	EventLikeReceived         EventType = "like_received"   // like on the user's content
	EventRepostCreated        EventType = "repost_created"  // wall post repost
	EventSubJoined            EventType = "sub_joined"      // retired
	EventSubRulesAccepted     EventType = "rules_accepted"  // retired
	EventSubCreated           EventType = "sub_created"     // retired
	EventGiftSent             EventType = "gift_sent"       // retired
	EventGiftReceived         EventType = "gift_received"   // retired
	EventAvatarUpdated        EventType = "avatar_updated"  // retired
	EventBioUpdated           EventType = "bio_updated"     // retired
	EventProfileStyled        EventType = "profile_styled"  // retired
	EventIntegrationConnected EventType = "integration_connected"
	EventDailyVisit           EventType = "daily_visit" // daily visit / session recorded
)

// Event is a user action handed to the engine. Handlers emit it after the
// action is durably written; the engine is async and idempotent per level.
type Event struct {
	UserID string
	Type   EventType
	At     time.Time
}

// eventCounters maps an event to the counter milestones it increments.
var eventCounters = map[EventType][]string{
	EventEntryCreated: {"entries"},
	EventLikeReceived: {"likes_received"},
}

// eventDerived maps an event to the derived milestones to re-evaluate. Resonance
// is recomputed from live data, so an event is just a trigger; the owner's
// resonance is also refreshed lazily whenever their profile is read.
var eventDerived = map[EventType][]string{
	EventEntryCreated:   {"resonance"},
	EventCommentCreated: {"resonance"},
	EventLikeReceived:   {"resonance"},
	EventRepostCreated:  {"resonance"},
	EventDailyVisit:     {"tenure"},
}

// ──────────────── Engine ────────────────

// Notifier delivers unlock notifications (a row in the notifications panel —
// no toasts). Nil disables them. Wired in routes once the notification service
// is available.
type Notifier interface {
	NotifyMilestone(userID string, g *Group, prevLevel, newLevel int)
}

// Engine evaluates events against the catalog, keeps user_achievement_counters
// in sync and upgrades levels. Unlocks write a notification row (no toast); the
// achievements page reads progress on demand. It is safe for concurrent use;
// handlers typically call EmitAchievement in a goroutine.
type Engine struct {
	db      *sql.DB
	catalog *Catalog

	// Notifier is called when a milestone level rises. Nil = silent.
	Notifier Notifier

	mu          sync.Mutex
	dirtyGroups map[string]bool // groups whose definition changed at last Sync
}

// New creates an engine over the given catalog.
func New(db *sql.DB, cat *Catalog) *Engine {
	return &Engine{
		db:          db,
		catalog:     cat,
		dirtyGroups: map[string]bool{},
	}
}

// GroupID returns the deterministic achievements.id for a group key (must match
// the id the sync writes into the achievements mirror table).
func GroupID(key string) string {
	return uuid.NewMD5(uuid.NameSpaceOID, []byte(key)).String()
}

func (e *Engine) logf(format string, args ...interface{}) {
	log.Printf("[Achievements] "+format, args...)
}

// HandleEvent processes one user action: increments mapped counters, then
// re-evaluates the touched derived milestones. Errors are logged and swallowed —
// the engine must never break the action that emitted the event.
func (e *Engine) HandleEvent(ev Event) {
	if e.db == nil || ev.UserID == "" {
		return
	}
	at := ev.At
	if at.IsZero() {
		at = time.Now()
	}

	for _, key := range eventCounters[ev.Type] {
		e.handleCounter(ev.UserID, key)
	}
	for _, key := range eventDerived[ev.Type] {
		e.handleDerived(ev.UserID, key, at)
	}
}

// handleCounter reconciles a counter milestone with live data and applies the
// level. It ALWAYS recomputes from the source tables instead of blindly
// incrementing: counter groups have a deterministic sourceCount query, so an
// event is simply a trigger to re-read reality. This makes the counter
// self-healing — a missed event or a pre-existing row can never leave the
// counter permanently wrong.
func (e *Engine) handleCounter(userID, key string) bool {
	g, ok := e.catalog.Get(key)
	if !ok || g.Stat != StatCounter {
		return false
	}
	ctx := context.Background()
	value, err := e.sourceCount(ctx, userID, key)
	if err != nil {
		e.logf("sourceCount(%s,%s): %v", userID, key, err)
		return false
	}
	e.setCounter(ctx, userID, key, value)
	return e.applyLevelExact(ctx, userID, g, g.LevelFor(value), value)
}

// handleDerived computes a derived/tenure milestone's value from live data and
// applies the level exactly.
func (e *Engine) handleDerived(userID, key string, _ time.Time) bool {
	g, ok := e.catalog.Get(key)
	if !ok {
		return false
	}
	ctx := context.Background()
	if g.Stat == StatTenure {
		days, err := e.tenureDays(ctx, userID)
		if err != nil {
			e.logf("tenureDays(%s): %v", userID, err)
			return false
		}
		return e.applyLevelExact(ctx, userID, g, tenureLevel(days), days)
	}
	if g.Stat != StatDerived {
		return false
	}
	value, err := e.derivedValue(ctx, userID, key)
	if err != nil {
		e.logf("derivedValue(%s,%s): %v", userID, key, err)
		return false
	}
	return e.applyLevelExact(ctx, userID, g, g.LevelFor(value), value)
}

func (e *Engine) setCounter(ctx context.Context, userID, key string, value int) {
	_, err := e.db.ExecContext(ctx, `
INSERT INTO user_achievement_counters (user_id, group_key, value, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (user_id, group_key)
DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, userID, key, value)
	if err != nil {
		e.logf("set counter(%s,%s,%d): %v", userID, key, value, err)
	}
}

// applyLevelExact writes the level exactly as computed (recompute / derived
// path): it may go down or disappear when rules change.
func (e *Engine) applyLevelExact(ctx context.Context, userID string, g *Group, newLevel, progress int) bool {
	currentLevel := e.currentLevel(ctx, userID, g.Key)
	if newLevel == 0 {
		if currentLevel > 0 {
			e.deleteRow(ctx, userID, g.Key)
		}
		return false
	}
	e.upsertExact(ctx, userID, g, newLevel, progress)
	if newLevel > currentLevel {
		e.onLevelUp(ctx, userID, g, currentLevel, newLevel)
		return true
	}
	return false
}

func (e *Engine) currentLevel(ctx context.Context, userID, key string) int {
	var level int
	err := e.db.QueryRowContext(ctx,
		"SELECT COALESCE(current_level, 0) FROM user_achievements WHERE user_id = $1 AND achievement_id = $2",
		userID, GroupID(key)).Scan(&level)
	if err != nil {
		return 0
	}
	return level
}

func (e *Engine) upsertExact(ctx context.Context, userID string, g *Group, newLevel, progress int) {
	_, err := e.db.ExecContext(ctx, `
INSERT INTO user_achievements (user_id, achievement_id, current_level, progress_current, unlocked_at, rule_hash)
VALUES ($1, $2, $3, $4, NOW(), $5)
ON CONFLICT (user_id, achievement_id)
DO UPDATE SET
	current_level = EXCLUDED.current_level,
	progress_current = EXCLUDED.progress_current,
	unlocked_at = COALESCE(user_achievements.unlocked_at, NOW()),
	rule_hash = EXCLUDED.rule_hash`,
		userID, GroupID(g.Key), newLevel, progress, e.ruleHash(g))
	if err != nil {
		e.logf("upsert exact(%s,%s): %v", userID, g.Key, err)
	}
}

func (e *Engine) deleteRow(ctx context.Context, userID, key string) {
	if _, err := e.db.ExecContext(ctx,
		"DELETE FROM user_achievements WHERE user_id = $1 AND achievement_id = $2",
		userID, GroupID(key)); err != nil {
		e.logf("delete row(%s,%s): %v", userID, key, err)
	}
}

func (e *Engine) ruleHash(g *Group) string {
	h, err := g.Hash()
	if err != nil {
		return ""
	}
	return h
}

// onLevelUp runs when a milestone level rises. Awards grant no rewards, so
// there is nothing to apply — the notification is written by the notifier hook
// (`Notifier`), wired in routes, and the achievements page reads progress on
// demand.
func (e *Engine) onLevelUp(_ context.Context, userID string, g *Group, prevLevel, newLevel int) {
	if e.Notifier != nil {
		e.Notifier.NotifyMilestone(userID, g, prevLevel, newLevel)
	}
}

// ──────────────── Sync / recompute ────────────────

// Sync mirrors the code catalog into the achievements table and returns the
// group keys whose definition hash changed (dirty). Admin-created rows
// (origin = admin) are never touched. Call at startup, before serving.
func (e *Engine) Sync(ctx context.Context) ([]string, error) {
	if e.db == nil {
		return nil, fmt.Errorf("achievements: Sync: nil db")
	}

	existing := map[string]string{}
	rows, err := e.db.QueryContext(ctx, "SELECT group_key, COALESCE(definition_hash, '') FROM achievements WHERE origin = 'code'")
	if err != nil {
		return nil, fmt.Errorf("achievements: Sync read: %w", err)
	}
	for rows.Next() {
		var key, hash string
		if err := rows.Scan(&key, &hash); err != nil {
			rows.Close()
			return nil, err
		}
		existing[key] = hash
	}
	rows.Close()

	var dirty []string
	for _, g := range e.catalog.Groups() {
		h := e.ruleHash(g)
		if old, ok := existing[g.Key]; ok && old != "" && old != h {
			dirty = append(dirty, g.Key)
		}
		if err := e.upsertMirror(ctx, g, h); err != nil {
			return nil, err
		}
	}

	if err := e.deleteRetired(ctx); err != nil {
		return nil, err
	}

	e.mu.Lock()
	e.dirtyGroups = map[string]bool{}
	for _, k := range dirty {
		e.dirtyGroups[k] = true
	}
	e.mu.Unlock()

	if len(dirty) > 0 {
		e.logf("Sync: %d dirty group(s): %v", len(dirty), dirty)
	}
	return dirty, nil
}

func (e *Engine) upsertMirror(ctx context.Context, g *Group, hash string) error {
	levels := "[]"
	if len(g.Levels) > 0 {
		b, err := json.Marshal(g.Levels)
		if err != nil {
			return fmt.Errorf("achievements: marshal levels %s: %w", g.Key, err)
		}
		levels = string(b)
	}
	atype := string(g.Type)
	switch {
	case g.IsAward():
		atype = "award"
	case g.IsDynamic():
		atype = "tenure"
	}
	description := ""
	if g.IsAward() {
		description = g.DescriptionKey
	}
	_, err := e.db.ExecContext(ctx, `
INSERT INTO achievements (id, group_key, name, title, description, category, icon,
                          achievement_type, kind, origin, image_url, hidden, sort_order,
                          levels, definition_hash, updated_at)
VALUES ($1, $2, $3::text, $3::text, $4, $5::text, $6,
        $7, $8, 'code', $9, FALSE, $10,
        $11::jsonb, $12, NOW())
ON CONFLICT (group_key)
DO UPDATE SET
	name = EXCLUDED.name, title = EXCLUDED.title, description = EXCLUDED.description,
	category = EXCLUDED.category, icon = EXCLUDED.icon,
	achievement_type = EXCLUDED.achievement_type, kind = EXCLUDED.kind,
	-- image_url is NOT synced: artwork is uploaded from the admin panel and must
	-- survive every boot (the Go catalog leaves it empty).
	hidden = EXCLUDED.hidden,
	sort_order = EXCLUDED.sort_order, levels = EXCLUDED.levels,
	definition_hash = EXCLUDED.definition_hash, updated_at = NOW()`,
		GroupID(g.Key), g.Key, g.TitleKey, description, string(g.Category), g.Icon,
		atype, string(g.Kind), g.ImageURL, g.SortOrder, levels, hash)
	if err != nil {
		return fmt.Errorf("achievements: upsert mirror %s: %w", g.Key, err)
	}
	return nil
}

func (e *Engine) deleteRetired(ctx context.Context) error {
	keys := make([]string, 0, e.catalog.Len())
	for _, g := range e.catalog.Groups() {
		keys = append(keys, g.Key)
	}
	// Retire code rows no longer in the catalog. Admin rows are left alone.
	// user_achievements rows reference the mirrored id, so clear them first.
	if _, err := e.db.ExecContext(ctx, `
DELETE FROM user_achievements WHERE achievement_id IN (
	SELECT id FROM achievements WHERE origin = 'code' AND group_key NOT IN (
		SELECT unnest($1::text[])
	)
)`, pq.Array(keys)); err != nil {
		return fmt.Errorf("achievements: delete retired user rows: %w", err)
	}
	if _, err := e.db.ExecContext(ctx, `
DELETE FROM achievements WHERE origin = 'code' AND group_key NOT IN (
	SELECT unnest($1::text[])
)`, pq.Array(keys)); err != nil {
		return fmt.Errorf("achievements: delete retired groups: %w", err)
	}
	return nil
}

// RecomputeDirty recomputes every dirty group for all affected users (those with
// rows in user_achievements or counters). Runs at startup after Sync.
func (e *Engine) RecomputeDirty(ctx context.Context) {
	e.mu.Lock()
	dirty := make([]string, 0, len(e.dirtyGroups))
	for k := range e.dirtyGroups {
		dirty = append(dirty, k)
	}
	e.mu.Unlock()

	for _, key := range dirty {
		users := e.affectedUsers(ctx, key)
		e.logf("RecomputeDirty: %s → %d user(s)", key, len(users))
		for _, uid := range users {
			e.recomputeGroup(ctx, uid, key)
		}
	}

	e.mu.Lock()
	for _, k := range dirty {
		delete(e.dirtyGroups, k)
	}
	e.mu.Unlock()
}

func (e *Engine) affectedUsers(ctx context.Context, key string) []string {
	rows, err := e.db.QueryContext(ctx, `
SELECT DISTINCT user_id FROM user_achievements WHERE achievement_id = $1
UNION
SELECT DISTINCT user_id FROM user_achievement_counters WHERE group_key = $2`, GroupID(key), key)
	if err != nil {
		e.logf("affectedUsers(%s): %v", key, err)
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err == nil {
			out = append(out, uid)
		}
	}
	return out
}

// RecomputeUser re-derives every milestone for one user from live data (heals
// drift, applies rule changes). Awards are hand-granted and never recomputed.
func (e *Engine) RecomputeUser(ctx context.Context, userID string) {
	if userID == "" {
		return
	}
	for _, g := range e.catalog.Groups() {
		if g.IsAward() {
			continue
		}
		e.recomputeGroup(ctx, userID, g.Key)
	}
}

// RecomputeAll backfills every milestone for every user from live data. It is
// the one-time startup migration after a catalog rework: counter values are
// recomputed from the source tables, derived/tenure groups are re-evaluated,
// and levels are applied exactly. The caller decides how often this runs
// (startup marker).
func (e *Engine) RecomputeAll(ctx context.Context) {
	if e.db == nil {
		return
	}
	rows, err := e.db.QueryContext(ctx, "SELECT id::text FROM users")
	if err != nil {
		e.logf("RecomputeAll: list users: %v", err)
		return
	}
	defer rows.Close()
	var userIDs []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			e.logf("RecomputeAll: scan user: %v", err)
			continue
		}
		userIDs = append(userIDs, uid)
	}
	if err := rows.Err(); err != nil {
		e.logf("RecomputeAll: iterate users: %v", err)
		return
	}
	e.logf("RecomputeAll: recomputing %d user(s)", len(userIDs))
	for _, uid := range userIDs {
		e.RecomputeUser(ctx, uid)
	}
	e.logf("RecomputeAll: done")
}

func (e *Engine) recomputeGroup(ctx context.Context, userID, key string) {
	g, ok := e.catalog.Get(key)
	if !ok || g.IsAward() {
		return
	}
	if g.Stat == StatTenure {
		days, err := e.tenureDays(ctx, userID)
		if err != nil {
			e.logf("recompute tenure(%s,%s): %v", userID, key, err)
			return
		}
		e.applyLevelExact(ctx, userID, g, tenureLevel(days), days)
		return
	}
	if g.Stat == StatCounter {
		value, err := e.sourceCount(ctx, userID, key)
		if err != nil {
			e.logf("recompute sourceCount(%s,%s): %v", userID, key, err)
			return
		}
		e.setCounter(ctx, userID, key, value)
		e.applyLevelExact(ctx, userID, g, g.LevelFor(value), value)
		return
	}
	value, err := e.derivedValue(ctx, userID, key)
	if err != nil {
		e.logf("recompute derived(%s,%s): %v", userID, key, err)
		return
	}
	e.applyLevelExact(ctx, userID, g, g.LevelFor(value), value)
}
