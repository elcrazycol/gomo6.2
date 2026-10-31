package achievements

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gomo6/backend/internal/activity"
	"github.com/gomo6/backend/internal/logsafe"
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
	EventEntryCreated         EventType = "entry_created"         // thread or wall post (split by TargetType)
	EventImageUploaded        EventType = "image_uploaded"        // retired
	EventCommentCreated       EventType = "comment_created"       // post-in-thread or wall comment
	EventLikeGiven            EventType = "like_given"            // any like by the user
	EventLikeReceived         EventType = "like_received"         // like on the user's content
	EventRepostCreated        EventType = "repost_created"        // retired (no quest in MVP)
	EventSubJoined            EventType = "sub_joined"            // gomosub membership
	EventSubRulesAccepted     EventType = "rules_accepted"        // retired
	EventSubCreated           EventType = "sub_created"           // gomosub created
	EventGiftSent             EventType = "gift_sent"             // gift sent (gifts_sent ladder)
	EventGiftReceived         EventType = "gift_received"         // gift received (gifts_received ladder)
	EventAvatarUpdated        EventType = "avatar_updated"        // avatar set
	EventBioUpdated           EventType = "bio_updated"           // bio filled
	EventProfileStyled        EventType = "profile_styled"        // customization saved
	EventIntegrationConnected EventType = "integration_connected" // retired
	EventFollowAdded          EventType = "follow_added"          // subscription to a user
	EventDailyVisit           EventType = "daily_visit"           // distinct visit day (visits + tenure)
)

// Event is a user action handed to the engine. Handlers emit it after the
// action is durably written; the engine is async and idempotent per level.
type Event struct {
	UserID string
	Type   EventType
	At     time.Time
	// TargetType/TargetID optionally point at the object the action touched
	// (post, thread, wall_post, wall_comment, user, board). They are carried
	// into the activity ledger for moderation; "" means untargeted.
	TargetType string
	TargetID   string
}

// eventCounters maps an event to the counter quests it re-reconciles.
// Entry creation splits by target: a wall post feeds the wall first-step,
// anything else (thread, legacy empty target) feeds the thread first-step;
// both feed the combined entries ladder.
var eventCounters = map[EventType][]string{
	EventCommentCreated: {"qs_first_comment", "comments"},
	EventLikeGiven:      {"qs_like_given", "likes_given"},
	EventLikeReceived:   {"likes_received"},
	EventSubJoined:      {"qs_sub_join", "subs_joined"},
	EventSubCreated:     {"sub_created"},
	EventGiftSent:       {"gifts_sent"},
	EventGiftReceived:   {"gifts_received"},
	EventDailyVisit:     {"visits_total", "visit_streak", "tenure_days"},
	EventFollowAdded:    {"qs_follow", "follows", "friends_mutual"},
	EventAvatarUpdated:  {"qs_avatar"},
	EventBioUpdated:     {"qs_bio"},
	EventProfileStyled:  {"qs_style"},
}

// firstStepsEvents marks the events that can complete an onboarding quest —
// after any of them the meta quest (qs_complete) is re-evaluated.
var firstStepsEvents = map[EventType]bool{
	EventEntryCreated:   true,
	EventCommentCreated: true,
	EventLikeGiven:      true,
	EventSubJoined:      true,
	EventFollowAdded:    true,
	EventAvatarUpdated:  true,
	EventBioUpdated:     true,
	EventProfileStyled:  true,
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

	// AwardNotifier is called for every automatic award grant. Nil = silent.
	AwardNotifier AwardNotifier

	// ledger records every handled event in the append-only activity log, which
	// powers moderation and time-series. Nil = the ledger is disabled (the
	// engine still works). Wired by the routes layer via SetActivityRecorder.
	ledger *activity.Recorder

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

// Catalog returns the engine's quest catalog.
func (e *Engine) Catalog() *Catalog {
	return e.catalog
}

// SetActivityRecorder wires the append-only activity ledger. A nil recorder
// disables ledger writes; the engine keeps working.
func (e *Engine) SetActivityRecorder(r *activity.Recorder) {
	e.ledger = r
}

func (e *Engine) logf(format string, args ...interface{}) {
	logsafe.Printf("[Achievements] "+format, args...)
}

// HandleEvent processes one user action: increments mapped counters, then
// re-evaluates the touched derived milestones. Errors are logged and swallowed —
// the engine must never break the action that emitted the event.
func (e *Engine) HandleEvent(ev Event) {
	if e.db == nil || ev.UserID == "" {
		return
	}
	// Activity ledger: record the action (fire-and-forget) before the counter
	// work, so moderation sees the action even if a later step fails.
	if e.ledger != nil {
		e.ledger.Record(ev.UserID, string(ev.Type), ev.TargetType, ev.TargetID)
	}

	for _, key := range counterKeys(ev) {
		e.handleCounter(ev.UserID, key)
	}
	if firstStepsEvents[ev.Type] {
		e.handleDerived(ev.UserID, "qs_complete")
	}
}

// counterKeys resolves an event to the counter quests it reconciles. Entry
// creation splits by target so the first thread and the first wall post are
// separate onboarding quests while both feed the combined entries ladder.
func counterKeys(ev Event) []string {
	if ev.Type == EventEntryCreated {
		if ev.TargetType == "wall_post" {
			return []string{"qs_first_wall", "entries", "media_uploads"}
		}
		return []string{"qs_first_thread", "entries", "media_uploads"}
	}
	return eventCounters[ev.Type]
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

// handleDerived computes a derived quest's value from live data and applies
// the level exactly. The only derived quest in the MVP is the onboarding
// meta (qs_complete): the number of first-steps quests completed.
func (e *Engine) handleDerived(userID, key string) bool {
	g, ok := e.catalog.Get(key)
	if !ok || g.Stat != StatDerived {
		return false
	}
	ctx := context.Background()
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
	// The row MUST be durably written before anyone is told about the
	// unlock: the toast, the bell and the achievements page all read it
	// back. A swallowed upsert error with an unconditional notify produced
	// the "toast says earned but the page shows nothing" ghost.
	if err := e.upsertExact(ctx, userID, g, newLevel, progress); err != nil {
		return false
	}
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

func (e *Engine) upsertExact(ctx context.Context, userID string, g *Group, newLevel, progress int) error {
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
		return err
	}
	return nil
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
	definition_hash = EXCLUDED.definition_hash,
	-- updated_at is the "catalog changed" signal the frontend compares
	-- against its seen version: bump it only when the definition hash
	-- actually changed, so a plain restart never raises the rework banner.
	updated_at = CASE WHEN achievements.definition_hash IS DISTINCT FROM EXCLUDED.definition_hash
		THEN NOW() ELSE achievements.updated_at END`,
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

// recomputeBatchSize is one page of the full backfill. User ids stream from
// the DB in keyset pages, so memory stays flat no matter the table size.
const recomputeBatchSize = 200

// RecomputeAll backfills every milestone for every user from live data. It is
// the one-time startup migration after a catalog rework: counter values are
// recomputed from the source tables, derived/tenure groups are re-evaluated,
// and levels are applied exactly. The caller decides how often this runs
// (startup marker); routes runs it in a background goroutine so serving never
// waits for it.
//
// Users stream in keyset-ordered pages with per-page progress logs, and ctx
// cancellation is honored between users, so a restart stops the pass cleanly
// instead of holding one giant transaction and the whole id list in memory.
// Per-user recompute stays idempotent (applyLevelExact), so an interrupted
// pass simply converges on the next run or lazily via live events.
func (e *Engine) RecomputeAll(ctx context.Context) {
	if e.db == nil {
		return
	}
	e.logf("RecomputeAll: starting paginated backfill")
	total := 0
	after := ""
	for {
		if err := ctx.Err(); err != nil {
			e.logf("RecomputeAll: cancelled after %d user(s): %v", total, err)
			return
		}
		batch, err := e.listUserPage(ctx, after, recomputeBatchSize)
		if err != nil {
			e.logf("RecomputeAll: list users: %v", err)
			return
		}
		if len(batch) == 0 {
			break
		}
		for _, uid := range batch {
			if err := ctx.Err(); err != nil {
				e.logf("RecomputeAll: cancelled after %d user(s): %v", total, err)
				return
			}
			e.RecomputeUser(ctx, uid)
			total++
		}
		after = batch[len(batch)-1]
		e.logf("RecomputeAll: progress %d user(s)", total)
		if len(batch) < recomputeBatchSize {
			break
		}
	}
	e.logf("RecomputeAll: done (%d user(s))", total)
}

// listUserPage returns one keyset-ordered page of user ids (text). after is
// the last id of the previous page, "" for the first page.
func (e *Engine) listUserPage(ctx context.Context, after string, limit int) ([]string, error) {
	var rows *sql.Rows
	var err error
	if after == "" {
		rows, err = e.db.QueryContext(ctx,
			"SELECT id::text FROM users ORDER BY id LIMIT $1", limit)
	} else {
		rows, err = e.db.QueryContext(ctx,
			"SELECT id::text FROM users WHERE id > $1::uuid ORDER BY id LIMIT $2", after, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		out = append(out, uid)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (e *Engine) recomputeGroup(ctx context.Context, userID, key string) {
	g, ok := e.catalog.Get(key)
	if !ok || g.IsAward() {
		return
	}
	if g.Stat == StatDerived {
		value, err := e.derivedValue(ctx, userID, key)
		if err != nil {
			e.logf("recompute derived(%s,%s): %v", userID, key, err)
			return
		}
		e.applyLevelExact(ctx, userID, g, g.LevelFor(value), value)
		return
	}
	if g.Stat != StatCounter {
		return
	}
	value, err := e.sourceCount(ctx, userID, key)
	if err != nil {
		e.logf("recompute sourceCount(%s,%s): %v", userID, key, err)
		return
	}
	e.setCounter(ctx, userID, key, value)
	e.applyLevelExact(ctx, userID, g, g.LevelFor(value), value)
}
