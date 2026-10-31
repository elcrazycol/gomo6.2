package achievements

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// ToppedUpLevel is one quest level that received a recalculation top-up: the
// catalog now grants more than the user already took, so the difference was
// credited. Only positive diffs are ever granted — if rewards shrank, the user
// keeps what they already claimed (no clawback).
type ToppedUpLevel struct {
	GroupKey string          `json:"group_key"`
	Level    int             `json:"level"`
	Granted  []GrantedReward `json:"granted"`
}

// diffRewards computes the top-up for one claimed level: per-kind positive
// differences (drops, gems) plus catalog chests the claim row doesn't have.
// Empty means nothing is owed.
func diffRewards(already, current []Reward) []Reward {
	sum := func(rs []Reward) map[RewardKind]int {
		out := map[RewardKind]int{}
		for _, r := range rs {
			if r.Kind == RewardDrops || r.Kind == RewardGems {
				out[r.Kind] += r.Amount
			}
		}
		return out
	}
	have, want := sum(already), sum(current)
	var diff []Reward
	for _, kind := range []RewardKind{RewardDrops, RewardGems} {
		if d := want[kind] - have[kind]; d > 0 {
			diff = append(diff, Reward{Kind: kind, Amount: d})
		}
	}
	chests := func(rs []Reward) int {
		n := 0
		for _, r := range rs {
			if r.Kind == RewardChest {
				n++
			}
		}
		return n
	}
	for i := 0; i < chests(current)-chests(already); i++ {
		diff = append(diff, currentChestReward(current))
	}
	return diff
}

// currentChestReward returns a chest reward template from the catalog level
// (preserves its mechanic). Callers guarantee at least one chest exists.
func currentChestReward(current []Reward) Reward {
	for _, r := range current {
		if r.Kind == RewardChest {
			return r
		}
	}
	return Reward{Kind: RewardChest, Mechanic: "rarity_chest"}
}

// levelRewards returns the catalog rewards of one level (nil if unknown).
func (e *Engine) levelRewards(groupKey string, level int) []Reward {
	g, ok := e.catalog.Get(groupKey)
	if !ok {
		return nil
	}
	for _, lvl := range g.Levels {
		if lvl.Level == level {
			return lvl.Rewards
		}
	}
	return nil
}

// ReconcileUser tops up every already-claimed level whose catalog rewards grew
// since the claim (rewards rework, threshold reshuffle — anything). It is the
// "добрать заслуженное" behind POST /quests/reconcile: safe to run any number
// of times, grants only positive diffs, and appends them to the claim row's
// topup_rewards — the original rewards column is never rewritten, so the row
// keeps what was actually granted at claim time plus every later top-up.
// Levels completed but never claimed are left alone — they stay claimable for
// the full new amount via the regular claim flow.
//
// The whole pass runs in ONE transaction under a transaction-scoped advisory
// lock on the user: concurrent reconciles for the same user (double click,
// two devices, two backend instances) serialize instead of granting twice,
// and ~80 levels cost a handful of round trips (two bulk reads plus one write
// per owed level) instead of a transaction per level.
func (e *Engine) ReconcileUser(ctx context.Context, userID string) ([]ToppedUpLevel, error) {
	if e.db == nil {
		return nil, fmt.Errorf("achievements: ReconcileUser: nil db")
	}
	if userID == "" {
		return nil, fmt.Errorf("achievements: ReconcileUser: empty user")
	}
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("achievements: reconcile begin: %w", err)
	}
	defer tx.Rollback()

	// Xact-scoped: releases itself on commit/rollback, so a crashed holder can
	// never wedge the user.
	if _, err := tx.ExecContext(ctx,
		"SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
		"achievements:reconcile:"+userID); err != nil {
		return nil, fmt.Errorf("achievements: reconcile lock: %w", err)
	}

	progress, err := e.reconcileProgress(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	claims, err := e.reconcileClaims(ctx, tx, userID)
	if err != nil {
		return nil, err
	}

	topped := []ToppedUpLevel{}
	for _, g := range e.catalog.Groups() {
		if g.IsAward() {
			continue
		}
		aid := GroupID(g.Key)
		for _, lvl := range g.Levels {
			if len(lvl.Rewards) == 0 {
				continue
			}
			if progress[aid] < lvl.Level {
				continue // not completed (or never unlocked) — nothing to top up
			}
			already, ok := claims[reconcileClaimKey{aid: aid, level: lvl.Level}]
			if !ok {
				continue // completed but never claimed — regular claim covers it
			}
			diff := diffRewards(already, lvl.Rewards)
			if len(diff) == 0 {
				continue
			}
			granted := make([]GrantedReward, 0, len(diff))
			for _, r := range diff {
				gr, err := grantReward(ctx, tx, userID, aid, lvl.Level, r, "quest_recalc")
				if err != nil {
					return topped, err
				}
				granted = append(granted, gr)
			}
			// Append-only: rewards keeps the original grant, topup_rewards
			// accumulates every top-up. The next pass diffs the catalog
			// against their sum, so repeats are no-ops by construction.
			topupBlob, err := marshalRewards(diff)
			if err != nil {
				return topped, err
			}
			if _, err := tx.ExecContext(ctx,
				"UPDATE quest_claims SET topup_rewards = topup_rewards || $1::jsonb WHERE user_id = $2 AND achievement_id = $3 AND level = $4",
				topupBlob, userID, aid, lvl.Level); err != nil {
				return topped, fmt.Errorf("achievements: reconcile ledger update: %w", err)
			}
			topped = append(topped, ToppedUpLevel{GroupKey: g.Key, Level: lvl.Level, Granted: granted})
		}
	}
	if len(topped) == 0 {
		return topped, nil // nothing written — the deferred rollback closes the tx
	}
	if err := tx.Commit(); err != nil {
		return topped, fmt.Errorf("achievements: reconcile commit: %w", err)
	}
	return topped, nil
}

// reconcileClaimKey identifies one claimed level in the bulk-loaded map.
type reconcileClaimKey struct {
	aid   string
	level int
}

// reconcileProgress bulk-loads the user's levels: achievement id → level.
func (e *Engine) reconcileProgress(ctx context.Context, tx *sql.Tx, userID string) (map[string]int, error) {
	rows, err := tx.QueryContext(ctx,
		"SELECT achievement_id::text, COALESCE(current_level, 0) FROM user_achievements WHERE user_id = $1",
		userID)
	if err != nil {
		return nil, fmt.Errorf("achievements: reconcile progress read: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var aid string
		var level int
		if err := rows.Scan(&aid, &level); err != nil {
			return nil, fmt.Errorf("achievements: reconcile progress scan: %w", err)
		}
		out[aid] = level
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("achievements: reconcile progress rows: %w", err)
	}
	return out, nil
}

// reconcileClaims bulk-loads every claim row of the user: (achievement, level)
// → granted rewards. The effective grant is the original rewards plus every
// accumulated top-up; a corrupt blob decodes to nil, i.e. tops up to the full
// catalog amount — same as the old per-level read did.
func (e *Engine) reconcileClaims(ctx context.Context, tx *sql.Tx, userID string) (map[reconcileClaimKey][]Reward, error) {
	rows, err := tx.QueryContext(ctx,
		"SELECT achievement_id::text, level, COALESCE(rewards::text, '[]'), COALESCE(topup_rewards::text, '[]') FROM quest_claims WHERE user_id = $1",
		userID)
	if err != nil {
		return nil, fmt.Errorf("achievements: reconcile claims read: %w", err)
	}
	defer rows.Close()
	out := map[reconcileClaimKey][]Reward{}
	for rows.Next() {
		var aid string
		var level int
		var base, topup string
		if err := rows.Scan(&aid, &level, &base, &topup); err != nil {
			return nil, fmt.Errorf("achievements: reconcile claims scan: %w", err)
		}
		var rs []Reward
		_ = json.Unmarshal([]byte(base), &rs)
		var extra []Reward
		_ = json.Unmarshal([]byte(topup), &extra)
		out[reconcileClaimKey{aid: aid, level: level}] = append(rs, extra...)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("achievements: reconcile claims rows: %w", err)
	}
	return out, nil
}

// levelRewards returns the catalog rewards of one level (nil if unknown).
