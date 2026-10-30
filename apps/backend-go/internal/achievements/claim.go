package achievements

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/gomo6/backend/internal/gamification"
)

// Claim errors: the handler maps them onto HTTP statuses.
var (
	ErrQuestUnknown      = errors.New("achievements: unknown quest")
	ErrQuestLevelUnknown = errors.New("achievements: unknown quest level")
	ErrQuestNotCompleted = errors.New("achievements: quest level not completed")
	ErrQuestNoReward     = errors.New("achievements: quest level has no reward")
	ErrQuestClaimed      = errors.New("achievements: quest level already claimed")
	ErrChestUnknown      = errors.New("achievements: unknown chest")
	ErrChestOpened       = errors.New("achievements: chest already opened")
)

// GrantedReward is a reward the claim actually credited, with the chest row
// id attached for chest rewards (the frontend uses it to offer "open").
type GrantedReward struct {
	Reward
	ChestID string `json:"chest_id,omitempty"`
}

// ClaimLevel grants the rewards of one completed quest level. It is safe to
// retry: the quest_claims insert is the idempotency guard
// (ON CONFLICT DO NOTHING), so a double claim or a retried request after a
// crash can never grant twice. Claiming an already-claimed level returns
// ErrQuestClaimed with no side effects.
func (e *Engine) ClaimLevel(ctx context.Context, userID, groupKey string, level int) ([]GrantedReward, error) {
	if e.db == nil {
		return nil, fmt.Errorf("achievements: ClaimLevel: nil db")
	}
	g, ok := e.catalog.Get(groupKey)
	if !ok || g.IsAward() {
		return nil, ErrQuestUnknown
	}
	var rewards []Reward
	for _, lvl := range g.Levels {
		if lvl.Level == level {
			rewards = lvl.Rewards
		}
	}
	if rewards == nil {
		return nil, ErrQuestLevelUnknown
	}
	if len(rewards) == 0 {
		return nil, ErrQuestNoReward
	}

	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("achievements: claim begin: %w", err)
	}
	defer tx.Rollback()

	var current int
	err = tx.QueryRowContext(ctx,
		"SELECT COALESCE(current_level, 0) FROM user_achievements WHERE user_id = $1 AND achievement_id = $2",
		userID, GroupID(groupKey)).Scan(&current)
	if err != nil || current < level {
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("achievements: claim level read: %w", err)
		}
		return nil, ErrQuestNotCompleted
	}

	blob, err := marshalRewards(rewards)
	if err != nil {
		return nil, err
	}
	var inserted bool
	err = tx.QueryRowContext(ctx, `
INSERT INTO quest_claims (user_id, achievement_id, level, rewards)
VALUES ($1, $2, $3, $4::jsonb)
ON CONFLICT (user_id, achievement_id, level) DO NOTHING
RETURNING TRUE`, userID, GroupID(groupKey), level, blob).Scan(&inserted)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrQuestClaimed
		}
		return nil, fmt.Errorf("achievements: claim ledger: %w", err)
	}

	granted := make([]GrantedReward, 0, len(rewards))
	achievementID := GroupID(groupKey)
	for _, r := range rewards {
		gr, err := grantReward(ctx, tx, userID, achievementID, level, r)
		if err != nil {
			return nil, err
		}
		granted = append(granted, gr)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("achievements: claim commit: %w", err)
	}
	return granted, nil
}

// grantReward credits one reward inside the claim transaction.
func grantReward(ctx context.Context, tx *sql.Tx, userID, achievementID string, level int, r Reward) (GrantedReward, error) {
	gr := GrantedReward{Reward: r}
	switch r.Kind {
	case RewardGems:
		var balance int
		if err := tx.QueryRowContext(ctx,
			"UPDATE users SET gems = COALESCE(gems, 0) + $1 WHERE id = $2 RETURNING COALESCE(gems, 0)",
			r.Amount, userID).Scan(&balance); err != nil {
			return gr, fmt.Errorf("achievements: grant gems: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_type, description)
VALUES ($1, 'quest_reward_gems', $2, $3, 'quest', $4)`,
			userID, r.Amount, balance, fmt.Sprintf("Quest reward: +%d gems", r.Amount)); err != nil {
			return gr, fmt.Errorf("achievements: grant gems ledger: %w", err)
		}
	case RewardDrops:
		var balance int
		if err := tx.QueryRowContext(ctx,
			"UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2 RETURNING COALESCE(drops, 0)",
			r.Amount, userID).Scan(&balance); err != nil {
			return gr, fmt.Errorf("achievements: grant drops: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_type, description)
VALUES ($1, 'quest_reward', $2, $3, 'quest', $4)`,
			userID, r.Amount, balance, fmt.Sprintf("Quest reward: +%d drops", r.Amount)); err != nil {
			return gr, fmt.Errorf("achievements: grant drops ledger: %w", err)
		}
	case RewardChest:
		mechanic := r.Mechanic
		if mechanic == "" {
			mechanic = gamification.RarityChestKey
		}
		if _, ok := gamification.Lookup(mechanic); !ok {
			return gr, fmt.Errorf("achievements: unknown chest mechanic %q", mechanic)
		}
		if err := tx.QueryRowContext(ctx, `
INSERT INTO quest_chests (user_id, achievement_id, level, mechanic)
VALUES ($1, $2, $3, $4) RETURNING id::text`,
			userID, achievementID, level, mechanic).Scan(&gr.ChestID); err != nil {
			return gr, fmt.Errorf("achievements: grant chest: %w", err)
		}
	default:
		return gr, fmt.Errorf("achievements: unknown reward kind %q", r.Kind)
	}
	return gr, nil
}

// ChestResult is the outcome of opening a quest chest.
type ChestResult struct {
	Rarity string                `json:"rarity"`
	Drops  int                   `json:"drops"`
	Detail []gamification.Reward `json:"rewards"`
}

// OpenChest plays a full gamification session for one of the user's unopened
// chests and credits the rolled drops. One chest opens exactly once
// (opened_at guard); a retry after a crash returns ErrChestOpened.
func (e *Engine) OpenChest(ctx context.Context, userID, chestID string) (*ChestResult, error) {
	if e.db == nil {
		return nil, fmt.Errorf("achievements: OpenChest: nil db")
	}
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("achievements: open begin: %w", err)
	}
	defer tx.Rollback()

	var mechanic string
	err = tx.QueryRowContext(ctx, `
SELECT mechanic FROM quest_chests
WHERE id = $1::uuid AND user_id = $2 AND opened_at IS NULL`,
		chestID, userID).Scan(&mechanic)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrChestUnknown
		}
		return nil, fmt.Errorf("achievements: open chest read: %w", err)
	}
	m, ok := gamification.Lookup(mechanic)
	if !ok {
		return nil, fmt.Errorf("achievements: unknown chest mechanic %q", mechanic)
	}

	// Play the whole session server-side: Start, then tap until opened.
	st, err := gamification.Start(mechanic)
	if err != nil {
		return nil, fmt.Errorf("achievements: chest start: %w", err)
	}
	src := cryptoSource{}
	var ev gamification.Event
	for i := 0; i < 1000 && !st.IsOpened(); i++ {
		st, ev, err = gamification.Tap(st, src)
		if err != nil {
			return nil, fmt.Errorf("achievements: chest tap: %w", err)
		}
		_ = ev
	}
	if !st.IsOpened() {
		return nil, fmt.Errorf("achievements: chest did not open")
	}
	detail := gamification.RollRewards(m, st.FinalRarity, src)
	drops := 0
	for _, r := range detail {
		drops += r.Amount
	}
	var balance int
	if err := tx.QueryRowContext(ctx,
		"UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2 RETURNING COALESCE(drops, 0)",
		drops, userID).Scan(&balance); err != nil {
		return nil, fmt.Errorf("achievements: chest credit: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_type, description)
VALUES ($1, 'quest_reward', $2, $3, 'quest', $4)`,
		userID, drops, balance, fmt.Sprintf("Quest chest: +%d drops", drops)); err != nil {
		return nil, fmt.Errorf("achievements: chest credit ledger: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE quest_chests SET opened_at = NOW(), reward_drops = $1 WHERE id = $2::uuid",
		drops, chestID); err != nil {
		return nil, fmt.Errorf("achievements: chest close: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("achievements: open commit: %w", err)
	}
	return &ChestResult{Rarity: string(st.FinalRarity), Drops: drops, Detail: detail}, nil
}

// cryptoSource is a gamification.Source backed by crypto/rand.
type cryptoSource struct{}

func (cryptoSource) Float64() float64 {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0
	}
	// 53 random bits → [0,1).
	return float64(binary.BigEndian.Uint64(b[:])>>11) / (1 << 53)
}

// marshalRewards encodes the granted rewards for the claim ledger row.
func marshalRewards(rewards []Reward) (string, error) {
	b, err := json.Marshal(rewards)
	if err != nil {
		return "", fmt.Errorf("achievements: marshal rewards: %w", err)
	}
	return string(b), nil
}
