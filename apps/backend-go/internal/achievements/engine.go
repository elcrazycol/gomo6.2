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

// EventType is a user action the engine reacts to. The messenger NEVER emits
// events — private conversations are out of scope by design.
type EventType string

const (
	EventEntryCreated         EventType = "entry_created"   // thread or wall post
	EventImageUploaded        EventType = "image_uploaded"  // entry with image
	EventCommentCreated       EventType = "comment_created" // post-in-thread or wall comment
	EventLikeGiven            EventType = "like_given"      // any like by the user
	EventLikeReceived         EventType = "like_received"   // like on the user's content
	EventRepostCreated        EventType = "repost_created"  // wall post repost
	EventSubJoined            EventType = "sub_joined"      // gomosub membership
	EventSubRulesAccepted     EventType = "rules_accepted"  // gomosub rules acceptance
	EventSubCreated           EventType = "sub_created"     // created a gomosub
	EventGiftSent             EventType = "gift_sent"
	EventGiftReceived         EventType = "gift_received"
	EventAvatarUpdated        EventType = "avatar_updated"
	EventBioUpdated           EventType = "bio_updated"
	EventProfileStyled        EventType = "profile_styled"        // profile customization saved
	EventIntegrationConnected EventType = "integration_connected" // spotify (first integration)
	EventDailyVisit           EventType = "daily_visit"           // daily visit / session recorded
)

// Event is a user action handed to the engine. Handlers emit it after the
// action is durably written; the engine is async and idempotent per level.
type Event struct {
	UserID string
	Type   EventType
	At     time.Time
}

// eventCounters maps an event to the counter groups it increments.
var eventCounters = map[EventType][]string{
	EventEntryCreated:         {"entries"},
	EventImageUploaded:        {"images"},
	EventCommentCreated:       {"comments"},
	EventLikeGiven:            {"likes_given"},
	EventLikeReceived:         {"likes_received"},
	EventRepostCreated:        {"reposts"},
	EventSubJoined:            {"sub_join"},
	EventSubRulesAccepted:     {"sub_rules"},
	EventSubCreated:           {"sub_create"},
	EventGiftSent:             {"gift_sent"},
	EventGiftReceived:         {"gift_received"},
	EventAvatarUpdated:        {"avatar"},
	EventBioUpdated:           {"bio"},
	EventProfileStyled:        {"profile_style"},
	EventIntegrationConnected: {"spotify"},
}

// eventDerived maps an event to the derived groups to re-evaluate.
// Derived groups are computed from live data, so an event only needs to
// trigger the check; the value itself comes from the DB.
var eventDerived = map[EventType][]string{
	// A daily visit is recorded alongside session-time accumulation, so it is
	// the natural trigger for all retention-derived groups.
	EventDailyVisit:   {"daily_streak", "secret_shower", "secret_lurk", "session_time"},
	EventEntryCreated: {"secret_owl"},
}

// ──────────────── Engine ────────────────

// Engine evaluates events against the catalog, keeps user_achievement_counters
// in sync and upgrades levels. Unlocks are silent by design — no notifications,
// no WS events; the achievements page reads the progress on demand. It is safe
// for concurrent use; handlers typically call HandleEvent in a goroutine.
type Engine struct {
	db      *sql.DB
	catalog *Catalog

	// RecomputeStats refreshes derived stats (garma is formula-based; the
	// callback lets the app recalc garma promptly after an unlock). Nil = skip.
	RecomputeStats func(userID string)

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
// re-evaluates the touched groups (counter and derived). Errors are logged and
// swallowed — the engine must never break the action that emitted the event.
func (e *Engine) HandleEvent(ev Event) {
	if e.db == nil || ev.UserID == "" {
		return
	}
	at := ev.At
	if at.IsZero() {
		at = time.Now()
	}

	unlockedAny := false
	for _, key := range eventCounters[ev.Type] {
		if e.handleCounter(ev.UserID, key) {
			unlockedAny = true
		}
	}
	for _, key := range eventDerived[ev.Type] {
		if e.handleDerived(ev.UserID, key, at) {
			unlockedAny = true
		}
	}
	// Cross-cutting: re-evaluate the all-rounder secret after any unlock.
	if unlockedAny {
		e.handleDerived(ev.UserID, "secret_allrounder", at)
	}
}

// handleCounter increments the counter for a group and applies the new level.
// Returns true if a level increased. Dirty groups (definition changed) are
// backfilled from live data instead of blindly incremented.
func (e *Engine) handleCounter(userID, key string) bool {
	g, ok := e.catalog.Get(key)
	if !ok || g.Stat != StatCounter {
		return false
	}
	ctx := context.Background()

	if e.isDirty(key) {
		value, err := e.sourceCount(ctx, userID, key)
		if err != nil {
			e.logf("sourceCount(%s,%s): %v", userID, key, err)
			return false
		}
		e.setCounter(ctx, userID, key, value)
		return e.applyLevelExact(ctx, userID, g, g.LevelFor(value), value)
	}

	var value int
	if err := e.db.QueryRowContext(ctx, incrementCounterSQL, userID, key).Scan(&value); err != nil {
		e.logf("increment counter(%s,%s): %v", userID, key, err)
		return false
	}
	return e.applyLevelRatchet(ctx, userID, g, g.LevelFor(value), value)
}

// handleDerived computes a derived group's value from live data and applies the
// level exactly (derived groups have no persistent counter).
func (e *Engine) handleDerived(userID, key string, at time.Time) bool {
	g, ok := e.catalog.Get(key)
	if !ok || g.Stat != StatDerived {
		return false
	}
	value, err := e.derivedValue(context.Background(), userID, key)
	if err != nil {
		e.logf("derivedValue(%s,%s): %v", userID, key, err)
		return false
	}
	return e.applyLevelExact(context.Background(), userID, g, g.LevelFor(value), value)
}

const incrementCounterSQL = `
INSERT INTO user_achievement_counters (user_id, group_key, value)
VALUES ($1, $2, 1)
ON CONFLICT (user_id, group_key)
DO UPDATE SET value = user_achievement_counters.value + 1, updated_at = NOW()
RETURNING value`

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

// applyLevelRatchet upserts the level so it only ever goes up (GREATEST).
// Returns true if the level increased (an unlock/level-up happened).
func (e *Engine) applyLevelRatchet(ctx context.Context, userID string, g *Group, newLevel, progress int) bool {
	currentLevel := e.currentLevel(ctx, userID, g.Key)
	if newLevel <= currentLevel {
		return false
	}
	e.upsertRatchet(ctx, userID, g, newLevel, progress)
	e.onLevelUp(userID, g, currentLevel, newLevel)
	return true
}

// applyLevelExact writes the level exactly as computed (recompute / derived
// path): it may go down or disappear when rules change. Notifies only on up.
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
		e.onLevelUp(userID, g, currentLevel, newLevel)
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

func (e *Engine) upsertRatchet(ctx context.Context, userID string, g *Group, newLevel, progress int) {
	_, err := e.db.ExecContext(ctx, `
INSERT INTO user_achievements (user_id, achievement_id, current_level, progress_current, unlocked_at, rule_hash)
VALUES ($1, $2, $3, $4, NOW(), $5)
ON CONFLICT (user_id, achievement_id)
DO UPDATE SET
	current_level = GREATEST(user_achievements.current_level, EXCLUDED.current_level),
	progress_current = GREATEST(user_achievements.progress_current, EXCLUDED.progress_current),
	unlocked_at = CASE
		WHEN user_achievements.current_level < EXCLUDED.current_level THEN NOW()
		ELSE COALESCE(user_achievements.unlocked_at, NOW())
	END,
	rule_hash = EXCLUDED.rule_hash`,
		userID, GroupID(g.Key), newLevel, progress, e.ruleHash(g))
	if err != nil {
		e.logf("upsert ratchet(%s,%s): %v", userID, g.Key, err)
	}
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

// onLevelUp applies rewards for the delta levels and refreshes derived stats.
// Unlocks are silent: no notification, no WS event — the achievements page
// reads progress on demand.
func (e *Engine) onLevelUp(userID string, g *Group, prevLevel, newLevel int) {
	for lvl := prevLevel + 1; lvl <= newLevel; lvl++ {
		if lvl-1 < 0 || lvl-1 >= len(g.Levels) {
			continue
		}
		e.applyRewards(userID, g, g.Levels[lvl-1])
	}
	if e.RecomputeStats != nil {
		e.RecomputeStats(userID)
	}
}

// ──────────────── Sync / recompute ────────────────

// Sync mirrors the catalog into the achievements table and returns the group
// keys whose definition hash changed (dirty). Call at startup, before serving.
func (e *Engine) Sync(ctx context.Context) ([]string, error) {
	if e.db == nil {
		return nil, fmt.Errorf("achievements: Sync: nil db")
	}

	existing := map[string]string{}
	rows, err := e.db.QueryContext(ctx, "SELECT group_key, COALESCE(definition_hash, '') FROM achievements")
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
	levels, err := json.Marshal(g.Levels)
	if err != nil {
		return fmt.Errorf("achievements: marshal levels %s: %w", g.Key, err)
	}
	rarity := "common"
	if len(g.Levels) > 0 {
		rarity = g.Levels[0].Rarity
	}
	_, err = e.db.ExecContext(ctx, `
INSERT INTO achievements (id, group_key, name, title, description, category, icon, rarity,
                          achievement_type, hidden, sort_order, levels, definition_hash, updated_at)
VALUES ($1, $2, $3::text, $3::text, '', $4::text, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW())
ON CONFLICT (group_key)
DO UPDATE SET
	name = EXCLUDED.name, title = EXCLUDED.title, description = EXCLUDED.description,
	category = EXCLUDED.category, icon = EXCLUDED.icon, rarity = EXCLUDED.rarity,
	achievement_type = EXCLUDED.achievement_type, hidden = EXCLUDED.hidden,
	sort_order = EXCLUDED.sort_order, levels = EXCLUDED.levels,
	definition_hash = EXCLUDED.definition_hash, updated_at = NOW()`,
		GroupID(g.Key), g.Key, g.TitleKey, string(g.Category), g.Icon, rarity,
		string(g.Type), g.Hidden, g.SortOrder, string(levels), hash)
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
	if len(keys) == 0 {
		return nil
	}
	// Delete rows whose group_key is not in the catalog (retired groups).
	// user_achievements rows reference the mirrored id, so clear them first.
	if _, err := e.db.ExecContext(ctx, `
DELETE FROM user_achievements WHERE achievement_id IN (
	SELECT id FROM achievements WHERE group_key NOT IN (
		SELECT unnest($1::text[])
	)
)`, pq.Array(keys)); err != nil {
		return fmt.Errorf("achievements: delete retired user rows: %w", err)
	}
	if _, err := e.db.ExecContext(ctx, `
DELETE FROM achievements WHERE group_key NOT IN (
	SELECT unnest($1::text[])
	)`, pq.Array(keys)); err != nil {
		return fmt.Errorf("achievements: delete retired groups: %w", err)
	}
	return nil
}

func (e *Engine) isDirty(key string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.dirtyGroups[key]
}

// RecomputeDirty recomputes every dirty group for all affected users (those
// with rows in user_achievements or counters). Runs at startup after Sync.
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

// RecomputeUser re-derives every group for one user from live data (heals
// drift, applies rule changes). Used by the admin trigger / full recompute.
func (e *Engine) RecomputeUser(ctx context.Context, userID string) {
	if userID == "" {
		return
	}
	for _, g := range e.catalog.Groups() {
		e.recomputeGroup(ctx, userID, g.Key)
	}
}

// RecomputeAll backfills every group for every user from live data. It is the
// one-time startup migration after a catalog rework: counter values are
// recomputed from the source tables (not incremented), derived groups are
// re-evaluated, and levels are applied exactly — so old progress rows that no
// longer match the catalog are dropped and everyone starts from their real
// current activity. The caller decides how often this runs (startup marker).
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
	if !ok {
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
