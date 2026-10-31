package achievements

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"math/rand"
	"time"
)

// Daily quests: three rotating quests per server day, picked deterministically
// from the pool below — the date IS the definition, so nothing is stored for
// the set itself and every instance agrees without coordination.
//
// Rules (agreed):
//   - DailyQuestCount is the one number to change the daily load.
//   - Rewards scale with difficulty; closing all three grants a chest.
//   - Day boundary is the server midnight (UTC — same CURRENT_DATE the
//     visit streak already uses, so the two can never disagree).
//   - A completed but unclaimed quest auto-grants on the next load
//     (автозачёт): yesterday's earnings land in the wallet by themselves.
//   - Streak = consecutive fully-completed days. One missed day is restorable
//     for drops (RestoreStreak); a longer gap resets the series.

const (
	// DailyQuestCount is how many quests a day holds. Change this one number
	// to change the daily load.
	DailyQuestCount = 3

	// dailyFullKey is the sentinel claim row marking the day's chest granted.
	dailyFullKey = "__full__"

	// DailyRestoreBase and DailyRestoreCap bound the streak-restore price:
	// base × current streak, never above cap, paid in drops.
	DailyRestoreBase = 20
	DailyRestoreCap  = 500
)

// Daily claim/restore errors: the handler maps them onto HTTP statuses.
var (
	ErrDailyNothingRestorable = errors.New("achievements: nothing restorable")
	ErrDailyInsufficientDrops = errors.New("achievements: insufficient drops")
)

// DailyTemplate is one quest the daily rotation can pick.
type DailyTemplate struct {
	Key        string
	NameKey    string
	DescKey    string
	Threshold  int
	Rewards    []Reward
	Difficulty string // easy | medium | hard — documents the reward ladder
}

// DailyTemplates is the pool the day's three are drawn from. Thresholds stay
// fixed per template; variety comes from the daily draw, not from moving
// goalposts under the user.
func DailyTemplates() []*DailyTemplate {
	return []*DailyTemplate{
		{Key: "daily_likes", NameKey: "achievements.daily.daily_likes.name", DescKey: "achievements.daily.daily_likes.description", Threshold: 5, Rewards: []Reward{{Kind: RewardDrops, Amount: 10}}, Difficulty: "easy"},
		{Key: "daily_comments", NameKey: "achievements.daily.daily_comments.name", DescKey: "achievements.daily.daily_comments.description", Threshold: 2, Rewards: []Reward{{Kind: RewardDrops, Amount: 12}}, Difficulty: "easy"},
		{Key: "daily_wall", NameKey: "achievements.daily.daily_wall.name", DescKey: "achievements.daily.daily_wall.description", Threshold: 1, Rewards: []Reward{{Kind: RewardDrops, Amount: 12}}, Difficulty: "easy"},
		{Key: "daily_follows", NameKey: "achievements.daily.daily_follows.name", DescKey: "achievements.daily.daily_follows.description", Threshold: 2, Rewards: []Reward{{Kind: RewardDrops, Amount: 12}}, Difficulty: "easy"},
		{Key: "daily_thread", NameKey: "achievements.daily.daily_thread.name", DescKey: "achievements.daily.daily_thread.description", Threshold: 1, Rewards: []Reward{{Kind: RewardDrops, Amount: 15}}, Difficulty: "medium"},
		{Key: "daily_entries", NameKey: "achievements.daily.daily_entries.name", DescKey: "achievements.daily.daily_entries.description", Threshold: 3, Rewards: []Reward{{Kind: RewardDrops, Amount: 15}}, Difficulty: "medium"},
		{Key: "daily_media", NameKey: "achievements.daily.daily_media.name", DescKey: "achievements.daily.daily_media.description", Threshold: 1, Rewards: []Reward{{Kind: RewardDrops, Amount: 15}}, Difficulty: "medium"},
		{Key: "daily_likes_received", NameKey: "achievements.daily.daily_likes_received.name", DescKey: "achievements.daily.daily_likes_received.description", Threshold: 10, Rewards: []Reward{{Kind: RewardDrops, Amount: 20}}, Difficulty: "hard"},
	}
}

// dailyNow is the server day. One helper so the boundary lives in one place.
func dailyNow() time.Time { return time.Now().UTC() }

// DailyDayString formats a day the way the DB comparisons use it.
func DailyDayString(t time.Time) string { return t.UTC().Format("2006-01-02") }

// DailySetFor picks the day's quests deterministically: same date → same
// three for everyone, no storage, no coordination. FNV over the ISO date
// seeds a shuffle of the pool; the count comes from DailyQuestCount.
func DailySetFor(day time.Time) []*DailyTemplate {
	pool := DailyTemplates()
	h := fnv.New64a()
	_, _ = h.Write([]byte(DailyDayString(day)))
	rng := rand.New(rand.NewSource(int64(h.Sum64())))
	idx := rng.Perm(len(pool))
	n := DailyQuestCount
	if n > len(pool) {
		n = len(pool)
	}
	out := make([]*DailyTemplate, 0, n)
	for _, i := range idx[:n] {
		out = append(out, pool[i])
	}
	return out
}

// DailyQuestProgress is one quest of the day with the user's progress.
type DailyQuestProgress struct {
	Key       string   `json:"key"`
	NameKey   string   `json:"name_key"`
	DescKey   string   `json:"desc_key"`
	Threshold int      `json:"threshold"`
	Progress  int      `json:"progress"`
	Completed bool     `json:"completed"`
	Claimed   bool     `json:"claimed"`
	CanClaim  bool     `json:"can_claim"`
	Rewards   []Reward `json:"rewards"`
}

// DailyStreak is the series state for the page header.
type DailyStreak struct {
	Current int `json:"current"`
	Longest int `json:"longest"`
	// RestorableDay is set when exactly yesterday was missed: the date the
	// user can buy back, or "" when there is nothing to restore.
	RestorableDay string `json:"restorable_day,omitempty"`
	// RestorePrice is the drops cost of buying the missed day back.
	RestorePrice int `json:"restore_price,omitempty"`
}

// dailyProgressQueries counts one template's quest inside a single day
// (server midnight to midnight). Likes use their own created_at; content
// uses the author's creation time.
var dailyProgressQueries = map[string]string{
	"daily_likes": `SELECT (
  (SELECT COUNT(*) FROM post_likes WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM thread_likes WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM profile_wall_post_likes WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM profile_wall_comment_likes WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1))`,
	"daily_comments": `SELECT (
  (SELECT COUNT(*) FROM posts WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM profile_wall_post_comments WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1))`,
	"daily_wall":    `SELECT COUNT(*) FROM profile_wall_posts WHERE author_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1`,
	"daily_follows": `SELECT COUNT(*) FROM subscriptions WHERE subscriber_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1`,
	"daily_thread":  `SELECT COUNT(*) FROM threads WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1`,
	"daily_entries": `SELECT (
  (SELECT COUNT(*) FROM threads WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM profile_wall_posts WHERE author_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1))`,
	"daily_media": `SELECT (
  (SELECT COUNT(*) FROM threads WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1 AND COALESCE(attachments::text, '') NOT IN ('', 'null', '[]'))
  + (SELECT COUNT(*) FROM posts WHERE user_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1 AND COALESCE(attachments::text, '') NOT IN ('', 'null', '[]'))
  + (SELECT COUNT(*) FROM profile_wall_posts WHERE author_id = $1 AND created_at >= $2::date AND created_at < $2::date + 1 AND (COALESCE(image_url, '') <> '' OR COALESCE(attachments::text, '') NOT IN ('', 'null', '[]'))))`,
	"daily_likes_received": `SELECT (
  (SELECT COUNT(*) FROM post_likes pl JOIN posts po ON po.id = pl.post_id WHERE po.user_id = $1 AND pl.created_at >= $2::date AND pl.created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM thread_likes tl JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = $1 AND tl.created_at >= $2::date AND tl.created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM profile_wall_post_likes wl JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = $1 AND wl.created_at >= $2::date AND wl.created_at < $2::date + 1)
  + (SELECT COUNT(*) FROM profile_wall_comment_likes cl JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = $1 AND cl.created_at >= $2::date AND cl.created_at < $2::date + 1))`,
}

// dailyCount counts one template for one user inside one day.
func (e *Engine) dailyCount(ctx context.Context, userID, key, day string) (int, error) {
	q, ok := dailyProgressQueries[key]
	if !ok {
		return 0, nil
	}
	var n int
	if err := e.db.QueryRowContext(ctx, q, userID, day).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// dailyClaims loads the user's claim rows for a day: quest key → granted.
func (e *Engine) dailyClaims(ctx context.Context, tx *sql.Tx, userID, day string) (map[string]bool, error) {
	var rows *sql.Rows
	var err error
	if tx != nil {
		rows, err = tx.QueryContext(ctx,
			"SELECT quest_key FROM daily_quest_claims WHERE user_id = $1 AND quest_day = $2::date", userID, day)
	} else {
		rows, err = e.db.QueryContext(ctx,
			"SELECT quest_key FROM daily_quest_claims WHERE user_id = $1 AND quest_day = $2::date", userID, day)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out[k] = true
	}
	return out, rows.Err()
}

// grantDailyReward credits one daily reward inside the caller's transaction.
func grantDailyReward(ctx context.Context, tx *sql.Tx, userID, day, key string, r Reward, ref string) (GrantedReward, error) {
	gr := GrantedReward{Reward: r}
	switch r.Kind {
	case RewardDrops:
		var balance int
		if err := tx.QueryRowContext(ctx,
			"UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2 RETURNING COALESCE(drops, 0)",
			r.Amount, userID).Scan(&balance); err != nil {
			return gr, fmt.Errorf("achievements: daily grant drops: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_type, description)
VALUES ($1, 'daily_reward', $2, $3, $4, $5)`,
			userID, r.Amount, balance, ref, fmt.Sprintf("Daily quest: +%d drops", r.Amount)); err != nil {
			return gr, fmt.Errorf("achievements: daily grant drops ledger: %w", err)
		}
	case RewardChest:
		mechanic := r.Mechanic
		if mechanic == "" {
			mechanic = "rarity_chest"
		}
		if err := tx.QueryRowContext(ctx, `
INSERT INTO daily_chests (user_id, quest_day, mechanic)
VALUES ($1, $2::date, $3) RETURNING id::text`,
			userID, day, mechanic).Scan(&gr.ChestID); err != nil {
			return gr, fmt.Errorf("achievements: daily grant chest: %w", err)
		}
	default:
		return gr, fmt.Errorf("achievements: unknown daily reward kind %q", r.Kind)
	}
	blob, err := marshalRewards([]Reward{r})
	if err != nil {
		return gr, err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO daily_quest_claims (user_id, quest_day, quest_key, rewards)
VALUES ($1, $2::date, $3, $4::jsonb)
ON CONFLICT (user_id, quest_day, quest_key) DO NOTHING`, userID, day, key, blob); err != nil {
		return gr, fmt.Errorf("achievements: daily claim ledger: %w", err)
	}
	return gr, nil
}

// dailyFullChestReward is the chest for closing the whole day.
func dailyFullChestReward() Reward { return Reward{Kind: RewardChest, Mechanic: "rarity_chest"} }

// DailyProgress is the page payload for one user and one day.
type DailyProgress struct {
	Day         string               `json:"day"`
	Quests      []DailyQuestProgress `json:"quests"`
	Unclaimed   int                  `json:"unclaimed_count"`
	FullClaimed bool                 `json:"full_claimed"`
	Streak      DailyStreak          `json:"streak"`
	OpenChests  []DailyChestInfo     `json:"chests"`
	Drops       int                  `json:"drops"`
	// AutoGranted is what yesterday's settle credited just now (nil when
	// nothing was owed): the page toasts it once.
	AutoGranted []GrantedReward `json:"auto_granted,omitempty"`
}

// DailyChestInfo is one unopened daily chest. StateRarity/StateAttempts carry
// the persisted tap session so the modal resumes mid-chest sessions.
type DailyChestInfo struct {
	ID            string `json:"id"`
	Day           string `json:"day"`
	Mechanic      string `json:"mechanic"`
	CreatedAt     string `json:"created_at"`
	StateRarity   string `json:"state_rarity,omitempty"`
	StateAttempts *int   `json:"state_attempts,omitempty"`
}

// GetDailyProgress settles yesterday (auto-grant + streak) and returns today.
// Safe to call on every page load: every write is idempotent (claim PK,
// streak advance guarded by last_completed_day). AutoGranted carries what
// yesterday's settle credited just now, so the page can toast it once —
// repeats return nothing new by construction.
func (e *Engine) GetDailyProgress(ctx context.Context, userID string) (*DailyProgress, error) {
	if e.db == nil {
		return nil, fmt.Errorf("achievements: GetDailyProgress: nil db")
	}
	if userID == "" {
		return nil, fmt.Errorf("achievements: GetDailyProgress: empty user")
	}
	today := DailyDayString(dailyNow())
	yesterday := DailyDayString(dailyNow().AddDate(0, 0, -1))
	auto, err := e.settleDailyDay(ctx, userID, yesterday)
	if err != nil {
		e.logf("settle daily %s: %v", yesterday, err)
		auto = nil
	}
	out, err := e.dailyProgress(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	out.AutoGranted = auto
	return out, nil
}

// dailyProgress reads one day without settling: quests with counts, the
// streak row, and the restorable-day offer.
func (e *Engine) dailyProgress(ctx context.Context, userID, day string) (*DailyProgress, error) {
	set := DailySetFor(mustParseDay(day))
	claims, err := e.dailyClaims(ctx, nil, userID, day)
	if err != nil {
		return nil, fmt.Errorf("achievements: daily claims read: %w", err)
	}
	out := &DailyProgress{Day: day, Quests: make([]DailyQuestProgress, 0, len(set))}
	for _, t := range set {
		n, err := e.dailyCount(ctx, userID, t.Key, day)
		if err != nil {
			return nil, fmt.Errorf("achievements: daily count %s: %w", t.Key, err)
		}
		claimed := claims[t.Key]
		completed := n >= t.Threshold
		qp := DailyQuestProgress{
			Key: t.Key, NameKey: t.NameKey, DescKey: t.DescKey,
			Threshold: t.Threshold, Progress: n,
			Completed: completed, Claimed: claimed,
			CanClaim: completed && !claimed, Rewards: t.Rewards,
		}
		if qp.CanClaim {
			out.Unclaimed++
		}
		out.Quests = append(out.Quests, qp)
	}
	out.FullClaimed = claims[dailyFullKey]
	chests, err := e.dailyOpenChests(ctx, userID)
	if err != nil {
		return nil, err
	}
	out.OpenChests = chests
	st, err := e.dailyStreak(ctx, userID)
	if err != nil {
		return nil, err
	}
	out.Streak = st
	_ = e.db.QueryRowContext(ctx,
		"SELECT COALESCE(drops, 0) FROM users WHERE id = $1", userID).Scan(&out.Drops)
	return out, nil
}

func mustParseDay(day string) time.Time {
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		return dailyNow()
	}
	return t
}

// dailyStreakRow reads (or creates) the user's streak row.
func (e *Engine) dailyStreakRow(ctx context.Context, tx *sql.Tx, userID string) (current, longest int, lastDay sql.NullString, err error) {
	q := `SELECT current_streak, longest_streak, last_completed_day::text FROM daily_streaks WHERE user_id = $1`
	if tx != nil {
		err = tx.QueryRowContext(ctx, q, userID).Scan(&current, &longest, &lastDay)
	} else {
		err = e.db.QueryRowContext(ctx, q, userID).Scan(&current, &longest, &lastDay)
	}
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, sql.NullString{}, nil
		}
		return 0, 0, sql.NullString{}, fmt.Errorf("achievements: daily streak read: %w", err)
	}
	return current, longest, lastDay, nil
}

// dailyStreak composes the header state, including the restore offer: exactly
// one missed day (last == today − 2) with yesterday incomplete.
func (e *Engine) dailyStreak(ctx context.Context, userID string) (DailyStreak, error) {
	current, longest, lastDay, err := e.dailyStreakRow(ctx, nil, userID)
	if err != nil {
		return DailyStreak{}, err
	}
	st := DailyStreak{Current: current, Longest: longest}
	if !lastDay.Valid {
		return st, nil
	}
	today := DailyDayString(dailyNow())
	yesterday := DailyDayString(dailyNow().AddDate(0, 0, -1))
	if lastDay.String != yesterday && dayBefore(today, 2) == lastDay.String {
		complete, err := e.dailyDayComplete(ctx, userID, yesterday)
		if err != nil {
			return st, nil // streak numbers stand; the offer just hides on error
		}
		if !complete {
			st.RestorableDay = yesterday
			st.RestorePrice = DailyRestorePrice(current)
		}
	}
	return st, nil
}

// dayBefore returns the ISO date n days before the given ISO date.
func dayBefore(day string, n int) string {
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		return ""
	}
	return t.AddDate(0, 0, -n).Format("2006-01-02")
}

// dailyDayComplete reports whether every quest of the day is completed.
func (e *Engine) dailyDayComplete(ctx context.Context, userID, day string) (bool, error) {
	for _, t := range DailySetFor(mustParseDay(day)) {
		n, err := e.dailyCount(ctx, userID, t.Key, day)
		if err != nil {
			return false, err
		}
		if n < t.Threshold {
			return false, nil
		}
	}
	return true, nil
}

// DailyRestorePrice is what buying back the missed day costs: the base times
// the streak at risk, capped so a long series stays affordable-ish.
func DailyRestorePrice(streak int) int {
	if streak < 1 {
		streak = 1
	}
	p := DailyRestoreBase * streak
	if p > DailyRestoreCap {
		p = DailyRestoreCap
	}
	return p
}

// settleDailyDay closes one past day: every completed but unclaimed quest
// auto-grants (автозачёт), a fully completed day grants its chest, and the
// streak advances or resets. Only full completion moves the streak; a single
// missed day is left for RestoreStreak instead of resetting immediately.
// It returns what was credited just now (nil when nothing was owed), so the
// caller can surface it once — repeats grant nothing new.
func (e *Engine) settleDailyDay(ctx context.Context, userID, day string) ([]GrantedReward, error) {
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("achievements: daily settle begin: %w", err)
	}
	defer tx.Rollback()
	granted := []GrantedReward{}

	if _, err := tx.ExecContext(ctx,
		"SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
		"achievements:daily:"+userID+":"+day); err != nil {
		return nil, fmt.Errorf("achievements: daily settle lock: %w", err)
	}

	claims, err := e.dailyClaims(ctx, tx, userID, day)
	if err != nil {
		return nil, err
	}
	set := DailySetFor(mustParseDay(day))
	complete := true
	for _, t := range set {
		var n int
		q, ok := dailyProgressQueries[t.Key]
		if !ok {
			complete = false
			continue
		}
		if err := tx.QueryRowContext(ctx, q, userID, day).Scan(&n); err != nil {
			return nil, fmt.Errorf("achievements: daily settle count %s: %w", t.Key, err)
		}
		if n < t.Threshold {
			complete = false
			continue
		}
		if claims[t.Key] {
			continue
		}
		for _, r := range t.Rewards {
			gr, err := grantDailyReward(ctx, tx, userID, day, t.Key, r, "daily_auto")
			if err != nil {
				return nil, err
			}
			granted = append(granted, gr)
		}
	}
	if complete && !claims[dailyFullKey] {
		gr, err := grantDailyReward(ctx, tx, userID, day, dailyFullKey, dailyFullChestReward(), "daily_auto")
		if err != nil {
			return nil, err
		}
		granted = append(granted, gr)
	}
	if err := e.advanceStreakTx(ctx, tx, userID, day, complete); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("achievements: daily settle commit: %w", err)
	}
	return granted, nil
}

// advanceStreakTx moves the series for a settled past day. A complete day
// continues the series (or starts it at 1); an incomplete day resets to 0 —
// unless it is exactly yesterday after a live streak, which stays restorable
// via RestoreStreak instead of dying on the spot.
func (e *Engine) advanceStreakTx(ctx context.Context, tx *sql.Tx, userID, day string, complete bool) error {
	current, longest, lastDay, err := e.dailyStreakRow(ctx, tx, userID)
	if err != nil {
		return err
	}
	if complete {
		if lastDay.Valid && lastDay.String == day {
			return nil // already counted — settle is idempotent
		}
		prev := dayBefore(day, 1)
		if lastDay.Valid && lastDay.String == prev {
			current++
		} else {
			current = 1
		}
		if current > longest {
			longest = current
		}
	} else {
		if lastDay.Valid && lastDay.String == dayBefore(day, -1) {
			// Yesterday missed after a live series: leave the numbers alone,
			// the day stays buyable through RestoreStreak.
			return e.upsertStreakTx(ctx, tx, userID, current, longest, lastDay.String)
		}
		current = 0
	}
	last := day
	if !complete {
		last = lastDay.String // keep pointing at the last completed day
	}
	if last == "" && lastDay.Valid {
		last = lastDay.String
	}
	return e.upsertStreakTx(ctx, tx, userID, current, longest, last)
}

func (e *Engine) upsertStreakTx(ctx context.Context, tx *sql.Tx, userID string, current, longest int, last string) error {
	var lastArg interface{}
	if last != "" {
		lastArg = last
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO daily_streaks (user_id, current_streak, longest_streak, last_completed_day, updated_at)
VALUES ($1, $2, $3, $4::date, NOW())
ON CONFLICT (user_id) DO UPDATE SET
  current_streak = EXCLUDED.current_streak,
  longest_streak = EXCLUDED.longest_streak,
  last_completed_day = EXCLUDED.last_completed_day,
  updated_at = NOW()`, userID, current, longest, lastArg); err != nil {
		return fmt.Errorf("achievements: daily streak upsert: %w", err)
	}
	return nil
}

// ClaimDaily grants one completed quest of today. When the claim closes the
// set, the day's chest drops in the same transaction.
func (e *Engine) ClaimDaily(ctx context.Context, userID, key string) ([]GrantedReward, error) {
	if e.db == nil {
		return nil, fmt.Errorf("achievements: ClaimDaily: nil db")
	}
	if userID == "" || key == "" {
		return nil, fmt.Errorf("achievements: ClaimDaily: empty user or key")
	}
	day := DailyDayString(dailyNow())
	var tmpl *DailyTemplate
	for _, t := range DailySetFor(dailyNow()) {
		if t.Key == key {
			tmpl = t
		}
	}
	if tmpl == nil {
		return nil, ErrQuestUnknown
	}
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("achievements: daily claim begin: %w", err)
	}
	defer tx.Rollback()

	n, err := e.dailyCountTx(ctx, tx, userID, key, day)
	if err != nil {
		return nil, err
	}
	if n < tmpl.Threshold {
		return nil, ErrQuestNotCompleted
	}
	var exists bool
	if err := tx.QueryRowContext(ctx,
		"SELECT TRUE FROM daily_quest_claims WHERE user_id = $1 AND quest_day = $2::date AND quest_key = $3",
		userID, day, key).Scan(&exists); err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("achievements: daily claim read: %w", err)
	}
	if exists {
		return nil, ErrQuestClaimed
	}
	granted := make([]GrantedReward, 0, len(tmpl.Rewards)+1)
	for _, r := range tmpl.Rewards {
		gr, err := grantDailyReward(ctx, tx, userID, day, key, r, "daily")
		if err != nil {
			return nil, err
		}
		granted = append(granted, gr)
	}
	// Closing the set drops the day's chest in the same transaction.
	claims, err := e.dailyClaims(ctx, tx, userID, day)
	if err != nil {
		return nil, err
	}
	closed := true
	for _, t := range DailySetFor(dailyNow()) {
		if !claims[t.Key] {
			closed = false
		}
	}
	if closed && !claims[dailyFullKey] {
		gr, err := grantDailyReward(ctx, tx, userID, day, dailyFullKey, dailyFullChestReward(), "daily")
		if err != nil {
			return nil, err
		}
		granted = append(granted, gr)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("achievements: daily claim commit: %w", err)
	}
	return granted, nil
}

func (e *Engine) dailyCountTx(ctx context.Context, tx *sql.Tx, userID, key, day string) (int, error) {
	q, ok := dailyProgressQueries[key]
	if !ok {
		return 0, nil
	}
	var n int
	if err := tx.QueryRowContext(ctx, q, userID, day).Scan(&n); err != nil {
		return 0, fmt.Errorf("achievements: daily count %s: %w", key, err)
	}
	return n, nil
}

// RestoreStreak buys back exactly one missed day (yesterday) so the series
// continues as if unbroken. Price = base × streak at risk, capped; paid in
// drops. Longer gaps are gone — the series restarts from the next full day.
func (e *Engine) RestoreStreak(ctx context.Context, userID string) (int, int, error) {
	if e.db == nil {
		return 0, 0, fmt.Errorf("achievements: RestoreStreak: nil db")
	}
	if userID == "" {
		return 0, 0, fmt.Errorf("achievements: RestoreStreak: empty user")
	}
	today := DailyDayString(dailyNow())
	yesterday := DailyDayString(dailyNow().AddDate(0, 0, -1))
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("achievements: daily restore begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		"SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
		"achievements:daily-restore:"+userID); err != nil {
		return 0, 0, fmt.Errorf("achievements: daily restore lock: %w", err)
	}
	current, longest, lastDay, err := e.dailyStreakRow(ctx, tx, userID)
	if err != nil {
		return 0, 0, err
	}
	if !lastDay.Valid || lastDay.String != dayBefore(today, 2) {
		return 0, 0, ErrDailyNothingRestorable
	}
	complete, err := e.dailyDayCompleteTx(ctx, tx, userID, yesterday)
	if err != nil {
		return 0, 0, err
	}
	if complete {
		return 0, 0, ErrDailyNothingRestorable
	}
	price := DailyRestorePrice(current)
	var balance int
	if err := tx.QueryRowContext(ctx,
		"UPDATE users SET drops = COALESCE(drops, 0) - $1 WHERE id = $2 AND COALESCE(drops, 0) >= $1 RETURNING COALESCE(drops, 0)",
		price, userID).Scan(&balance); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, ErrDailyInsufficientDrops
		}
		return 0, 0, fmt.Errorf("achievements: daily restore charge: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_type, description)
VALUES ($1, 'daily_restore', $2, $3, 'daily', $4)`,
		userID, -price, balance, fmt.Sprintf("Daily streak restore: -%d drops", price)); err != nil {
		return 0, 0, fmt.Errorf("achievements: daily restore ledger: %w", err)
	}
	if err := e.upsertStreakTx(ctx, tx, userID, current, longest, yesterday); err != nil {
		return 0, 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("achievements: daily restore commit: %w", err)
	}
	return current, price, nil
}

func (e *Engine) dailyDayCompleteTx(ctx context.Context, tx *sql.Tx, userID, day string) (bool, error) {
	for _, t := range DailySetFor(mustParseDay(day)) {
		q, ok := dailyProgressQueries[t.Key]
		if !ok {
			return false, nil
		}
		var n int
		if err := tx.QueryRowContext(ctx, q, userID, day).Scan(&n); err != nil {
			return false, err
		}
		if n < t.Threshold {
			return false, nil
		}
	}
	return true, nil
}

// dailyOpenChests lists the user's unopened daily chests.
func (e *Engine) dailyOpenChests(ctx context.Context, userID string) ([]DailyChestInfo, error) {
	rows, err := e.db.QueryContext(ctx, `
SELECT id::text, quest_day::text, mechanic, created_at::text, session::text
FROM daily_chests WHERE user_id = $1 AND opened_at IS NULL
ORDER BY created_at DESC LIMIT 20`, userID)
	if err != nil {
		return nil, fmt.Errorf("achievements: daily chests read: %w", err)
	}
	defer rows.Close()
	out := []DailyChestInfo{}
	for rows.Next() {
		var c DailyChestInfo
		var session sql.NullString
		if err := rows.Scan(&c.ID, &c.Day, &c.Mechanic, &c.CreatedAt, &session); err != nil {
			return nil, fmt.Errorf("achievements: daily chests scan: %w", err)
		}
		if snap := parseDailyChestSession(session); snap != nil {
			c.StateRarity = snap.Rarity
			c.StateAttempts = &snap.Attempts
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// parseDailyChestSession extracts rarity + attempts from a session snapshot.
func parseDailyChestSession(session sql.NullString) *struct {
	Rarity   string
	Attempts int
} {
	if !session.Valid || session.String == "" {
		return nil
	}
	var st struct {
		Rarity       string `json:"rarity"`
		AttemptsLeft int    `json:"attempts_left"`
	}
	if err := json.Unmarshal([]byte(session.String), &st); err != nil || st.Rarity == "" {
		return nil
	}
	return &struct {
		Rarity   string
		Attempts int
	}{Rarity: st.Rarity, Attempts: st.AttemptsLeft}
}
