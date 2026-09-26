package achievements

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"time"
)

// ActiveDays is the window that defines the "active" base for rarity: a user
// counts toward the denominator if they visited within this many days. Rarity is
// therefore "share of the living audience", not of every dead account ever.
const ActiveDays = 90

// TenureMaxLevel covers up to 30 years on the site (level 1 = half a year,
// level n>=2 = n-1 years). Tenure is the only unbounded series, so the rarity
// worker enumerates its levels up to this horizon.
const TenureMaxLevel = 31

// RarityLoop recomputes owner percentages immediately once, then every `every`
// until the context is cancelled. Started from routes.
func (e *Engine) RarityLoop(ctx context.Context, every time.Duration) {
	if err := e.RecomputeRarity(ctx); err != nil {
		e.logf("rarity: initial pass: %v", err)
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := e.RecomputeRarity(ctx); err != nil {
				e.logf("rarity: pass: %v", err)
			}
		}
	}
}

// RecomputeRarity computes, for every catalog row, the share of active users who
// own each level, and stores it as a JSON map {level: percent} in
// achievements.rarity. The frontend shows the number as-is.
func (e *Engine) RecomputeRarity(ctx context.Context) error {
	if e.db == nil {
		return nil
	}
	base, err := e.rarityBase(ctx)
	if err != nil {
		return fmt.Errorf("achievements: rarity base: %w", err)
	}

	// Milestone holders by current level (only among active users).
	milestoneCounts, err := e.rarityMilestoneCounts(ctx)
	if err != nil {
		return err
	}
	// Hand-granted award holders (active, not revoked).
	awardCounts, err := e.rarityAwardCounts(ctx)
	if err != nil {
		return err
	}
	// Tenure holders per level (active users older than each boundary).
	tenureCounts, err := e.rarityTenureCounts(ctx)
	if err != nil {
		return err
	}

	// Walk every mirrored row (code + admin) so admin awards get a share too.
	rows, err := e.db.QueryContext(ctx, `
SELECT group_key, kind, COALESCE(achievement_type, ''), COALESCE(jsonb_array_length(levels), 0)
FROM achievements`)
	if err != nil {
		return fmt.Errorf("achievements: rarity list: %w", err)
	}
	type entry struct {
		key, kind, atype string
		levels           int
	}
	var entries []entry
	for rows.Next() {
		var x entry
		if err := rows.Scan(&x.key, &x.kind, &x.atype, &x.levels); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, x := range entries {
		var rarity map[string]float64
		switch {
		case x.kind == string(KindAward):
			rarity = map[string]float64{"1": percent(awardCounts[x.key], base)}
		case x.atype == "tenure":
			rarity = make(map[string]float64, TenureMaxLevel)
			for lvl := 1; lvl <= TenureMaxLevel; lvl++ {
				rarity[strconv.Itoa(lvl)] = percent(tenureCounts[lvl], base)
			}
		default:
			rarity = make(map[string]float64, x.levels)
			// Cumulative: holders of level L are everyone at level >= L.
			for lvl := 1; lvl <= x.levels; lvl++ {
				holders := 0
				for cur, c := range milestoneCounts[x.key] {
					if cur >= lvl {
						holders += c
					}
				}
				rarity[strconv.Itoa(lvl)] = percent(holders, base)
			}
		}
		blob, err := json.Marshal(rarity)
		if err != nil {
			continue
		}
		if _, err := e.db.ExecContext(ctx,
			"UPDATE achievements SET owner_share = $2::jsonb WHERE group_key = $1", x.key, string(blob)); err != nil {
			return fmt.Errorf("achievements: rarity update %s: %w", x.key, err)
		}
	}

	e.logf("rarity: recomputed for %d group(s), base=%d active user(s)", len(entries), base)
	return nil
}

// rarityBase returns the number of active users (visited within ActiveDays).
// Falls back to the total user count so the denominator is never zero.
func (e *Engine) rarityBase(ctx context.Context) (int, error) {
	var base int
	if err := e.db.QueryRowContext(ctx, `
SELECT COUNT(DISTINCT user_id)::int FROM user_daily_visits
WHERE visit_date >= CURRENT_DATE - $1::int`, ActiveDays).Scan(&base); err != nil {
		return 0, err
	}
	if base == 0 {
		_ = e.db.QueryRowContext(ctx, `SELECT COUNT(*)::int FROM users`).Scan(&base)
	}
	if base == 0 {
		base = 1
	}
	return base, nil
}

// rarityMilestoneCounts returns, per group_key, a map current_level → owners
// (active users only).
func (e *Engine) rarityMilestoneCounts(ctx context.Context) (map[string]map[int]int, error) {
	rows, err := e.db.QueryContext(ctx, `
SELECT a.group_key, ua.current_level, COUNT(DISTINCT ua.user_id)::int
FROM user_achievements ua
JOIN achievements a ON a.id = ua.achievement_id
WHERE ua.current_level > 0
  AND ua.user_id IN (
    SELECT user_id FROM user_daily_visits WHERE visit_date >= CURRENT_DATE - $1::int
  )
GROUP BY a.group_key, ua.current_level`, ActiveDays)
	if err != nil {
		return nil, fmt.Errorf("achievements: rarity milestones: %w", err)
	}
	defer rows.Close()
	out := map[string]map[int]int{}
	for rows.Next() {
		var key string
		var level, count int
		if err := rows.Scan(&key, &level, &count); err != nil {
			return nil, err
		}
		if out[key] == nil {
			out[key] = map[int]int{}
		}
		out[key][level] = count
	}
	return out, rows.Err()
}

// rarityAwardCounts returns owners per award_key (active users, active grants).
func (e *Engine) rarityAwardCounts(ctx context.Context) (map[string]int, error) {
	rows, err := e.db.QueryContext(ctx, `
SELECT ua.award_key, COUNT(DISTINCT ua.user_id)::int
FROM user_awards ua
WHERE ua.revoked_at IS NULL
  AND ua.user_id IN (
    SELECT user_id FROM user_daily_visits WHERE visit_date >= CURRENT_DATE - $1::int
  )
GROUP BY ua.award_key`, ActiveDays)
	if err != nil {
		return nil, fmt.Errorf("achievements: rarity awards: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var key string
		var count int
		if err := rows.Scan(&key, &count); err != nil {
			return nil, err
		}
		out[key] = count
	}
	return out, rows.Err()
}

// rarityTenureCounts returns, per tenure level, the number of active users whose
// account is old enough: level 1 = half a year, level n>=2 = n-1 years.
func (e *Engine) rarityTenureCounts(ctx context.Context) (map[int]int, error) {
	rows, err := e.db.QueryContext(ctx, `
SELECT g.n, COUNT(u.id)::int
FROM generate_series(1, $2::int) AS g(n)
LEFT JOIN users u
  ON u.created_at <= NOW() - make_interval(days => CASE WHEN g.n = 1 THEN 183 ELSE (g.n - 1) * 365 END)
 AND u.id IN (
   SELECT user_id FROM user_daily_visits WHERE visit_date >= CURRENT_DATE - $1::int
 )
GROUP BY g.n`, ActiveDays, TenureMaxLevel)
	if err != nil {
		return nil, fmt.Errorf("achievements: rarity tenure: %w", err)
	}
	defer rows.Close()
	out := map[int]int{}
	for rows.Next() {
		var level, count int
		if err := rows.Scan(&level, &count); err != nil {
			return nil, err
		}
		out[level] = count
	}
	return out, rows.Err()
}

// percent returns holders/base as a percentage rounded to two decimals.
func percent(holders, base int) float64 {
	if base <= 0 {
		return 0
	}
	return math.Round(float64(holders)*10000/float64(base)) / 100
}
