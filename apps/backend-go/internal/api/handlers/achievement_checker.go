package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gomo6/backend/internal/websocket"
)

// AchievementChecker handles automatic achievement awarding when users perform actions.
type AchievementChecker struct {
	db    *sql.DB
	redis interface{}
	wsHub interface{}
}

// NewAchievementChecker creates a new achievement checker.
func NewAchievementChecker(db *sql.DB) *AchievementChecker {
	return &AchievementChecker{db: db}
}

// SetRedis sets the Redis client for cache/notifications.
func (ac *AchievementChecker) SetRedis(redis interface{}) { ac.redis = redis }

// SetWebSocketHub sets the WebSocket hub for real-time notifications.
func (ac *AchievementChecker) SetWebSocketHub(hub interface{}) { ac.wsHub = hub }

// UnlockedAchievement represents an unlocked or upgraded achievement for notification purposes.
type UnlockedAchievement struct {
	ID          string `json:"id"`
	GroupKey    string `json:"group_key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Rarity      string `json:"rarity"`
	Category    string `json:"category"`
	Level       int    `json:"level"`
	MaxLevel    int    `json:"max_level"`
	IsFirstTime bool   `json:"is_first_time"`
	PrevLevel   int    `json:"prev_level"`
}

// ──────────────── Internal DB-row types ────────────────

type achievementRow struct {
	ID              string
	GroupKey        string
	Title           string
	Description     string
	Category        string
	Icon            string
	Rarity          string
	AchievementType string
	Hidden          bool
	LevelsJSON      string
}

type levelDef struct {
	Level       int    `json:"level"`
	Threshold   int    `json:"threshold"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Rarity      string `json:"rarity"`
	RewardType  string `json:"reward_type"`
	RewardValue string `json:"reward_value"`
}

// ──────────────── User stats ────────────────

type userStats struct {
	postCount     int
	threadCount   int
	likesReceived int
	likesGiven    int
	imageCount    int
}

// getUserStats loads all relevant stats for a user using direct COUNT(*) queries.
func (ac *AchievementChecker) getUserStats(userID string) *userStats {
	s := &userStats{}

	ac.db.QueryRow("SELECT COUNT(*) FROM posts WHERE user_id = $1", userID).Scan(&s.postCount)
	ac.db.QueryRow("SELECT COUNT(*) FROM threads WHERE user_id = $1", userID).Scan(&s.threadCount)

	ac.db.QueryRow(`
		SELECT COUNT(*) FROM post_likes pl
		JOIN posts p ON pl.post_id = p.id
		WHERE p.user_id = $1
	`, userID).Scan(&s.likesReceived)

	ac.db.QueryRow("SELECT COUNT(*) FROM post_likes WHERE user_id = $1", userID).Scan(&s.likesGiven)

	ac.db.QueryRow(`
		SELECT COUNT(*) FROM posts
		WHERE user_id = $1 AND image_url IS NOT NULL
	`, userID).Scan(&s.imageCount)

	return s
}

// ──────────────── DB loading ────────────────

func (ac *AchievementChecker) loadAchievements() []achievementRow {
	rows, err := ac.db.Query(`
		SELECT id, COALESCE(group_key, ''), COALESCE(title, name),
		       COALESCE(description, ''), COALESCE(category, ''),
		       COALESCE(icon, 'sparkles'), COALESCE(rarity, 'common'),
		       COALESCE(achievement_type, 'one_time'), COALESCE(hidden, false),
		       COALESCE(levels::text, '[]')
		FROM achievements
		ORDER BY COALESCE(sort_order, 0)
	`)
	if err != nil {
		log.Printf("[Achievements] loadAchievements: %v", err)
		return nil
	}
	defer rows.Close()

	var out []achievementRow
	for rows.Next() {
		var r achievementRow
		if err := rows.Scan(&r.ID, &r.GroupKey, &r.Title, &r.Description,
			&r.Category, &r.Icon, &r.Rarity, &r.AchievementType, &r.Hidden, &r.LevelsJSON); err != nil {
			log.Printf("[Achievements] loadAchievements scan: %v", err)
			continue
		}
		out = append(out, r)
	}
	return out
}

func (ac *AchievementChecker) loadAchievementByKey(groupKey string) *achievementRow {
	var r achievementRow
	err := ac.db.QueryRow(`
		SELECT id, COALESCE(group_key, ''), COALESCE(title, name),
		       COALESCE(description, ''), COALESCE(category, ''),
		       COALESCE(icon, 'sparkles'), COALESCE(rarity, 'common'),
		       COALESCE(achievement_type, 'one_time'), COALESCE(hidden, false),
		       COALESCE(levels::text, '[]')
		FROM achievements
		WHERE group_key = $1
	`, groupKey).Scan(&r.ID, &r.GroupKey, &r.Title, &r.Description,
		&r.Category, &r.Icon, &r.Rarity, &r.AchievementType, &r.Hidden, &r.LevelsJSON)
	if err != nil {
		log.Printf("[Achievements] loadAchievementByKey(%s): %v", groupKey, err)
		return nil
	}
	return &r
}

func (ac *AchievementChecker) parseLevels(jsonStr string) []levelDef {
	var levels []levelDef
	if err := json.Unmarshal([]byte(jsonStr), &levels); err != nil {
		log.Printf("[Achievements] parseLevels: %v", err)
		return nil
	}
	return levels
}

// ──────────────── Main check loop ────────────────

// CheckAndAward checks all progressive achievements for a user and
// upgrades levels where thresholds are met. Returns newly unlocked achievements.
func (ac *AchievementChecker) CheckAndAward(userID string) []UnlockedAchievement {
	if userID == "" || ac.db == nil {
		return nil
	}

	stats := ac.getUserStats(userID)
	if stats == nil {
		return nil
	}

	achievements := ac.loadAchievements()

	var unlocked []UnlockedAchievement

	for _, ach := range achievements {
		if ach.AchievementType != "progressive" {
			continue
		}

		count := ac.statForGroup(ach.GroupKey, ach.Category, stats)
		levels := ac.parseLevels(ach.LevelsJSON)
		if len(levels) == 0 {
			continue
		}

		// Find highest qualifying level
		maxQualified := 0
		for _, lvl := range levels {
			if count >= lvl.Threshold && lvl.Level > maxQualified {
				maxQualified = lvl.Level
			}
		}

		if maxQualified > 0 {
			if result := ac.upgradeLevel(userID, ach, levels, maxQualified, count); result != nil {
				unlocked = append(unlocked, *result)
			}
		}
	}

	for i := range unlocked {
		ac.sendUnlockNotification(userID, unlocked[i])
	}

	return unlocked
}

// AwardOneTime awards a one-time achievement (avatar, bio, style) by group_key.
// Sends WebSocket notification for toast display.
func (ac *AchievementChecker) AwardOneTime(userID string, groupKey string) *UnlockedAchievement {
	if userID == "" || groupKey == "" {
		return nil
	}

	ach := ac.loadAchievementByKey(groupKey)
	if ach == nil {
		return nil
	}

	levels := ac.parseLevels(ach.LevelsJSON)
	if len(levels) == 0 {
		return nil
	}

	result := ac.upgradeLevel(userID, *ach, levels, 1, 1)
	if result != nil {
		ac.sendUnlockNotification(userID, *result)
	}
	return result
}

// statForGroup returns the relevant stat count based on group_key (primary) or category (fallback).
func (ac *AchievementChecker) statForGroup(groupKey string, category string, stats *userStats) int {
	// Check group_key first — handles secret achievements mapped to real stats
	switch groupKey {
	case "posting", "secret_posts":
		return stats.postCount
	case "threads":
		return stats.threadCount
	case "likes_received":
		return stats.likesReceived
	case "likes_given", "secret_likes":
		return stats.likesGiven
	case "images":
		return stats.imageCount
	}

	// Fallback to category
	switch category {
	case "posting":
		return stats.postCount
	case "threads":
		return stats.threadCount
	case "likes_received":
		return stats.likesReceived
	case "likes_given":
		return stats.likesGiven
	case "images":
		return stats.imageCount
	}
	return 0
}

// ──────────────── Level upgrade ────────────────

// upgradeLevel upserts user_achievements with the new level.
// Returns achievement info if the level actually increased (or was newly unlocked).
func (ac *AchievementChecker) upgradeLevel(userID string, ach achievementRow, levels []levelDef, newLevel int, progress int) *UnlockedAchievement {
	// Get current level
	var currentLevel int
	ac.db.QueryRow(
		"SELECT COALESCE(current_level, 0) FROM user_achievements WHERE user_id = $1 AND achievement_id = $2",
		userID, ach.ID,
	).Scan(&currentLevel)

	if newLevel <= currentLevel {
		return nil // already at this level or higher
	}

	idx := newLevel - 1
	if idx < 0 || idx >= len(levels) {
		return nil
	}
	levelInfo := levels[idx]

	// Upsert
	_, err := ac.db.Exec(`
		INSERT INTO user_achievements (user_id, achievement_id, current_level, progress_current)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, achievement_id)
		DO UPDATE SET current_level = $3, progress_current = $4, unlocked_at = NOW()
	`, userID, ach.ID, newLevel, progress)

	if err != nil {
		log.Printf("[Achievements] upgradeLevel upsert: %v", err)
		return nil
	}

	// Apply reward (only for the delta — first time for each level)
	ac.applyReward(userID, levelInfo.RewardType, levelInfo.RewardValue)

	isFirstTime := currentLevel == 0
	log.Printf("[Achievements] %s (%s) L%d → L%d for user %s (first=%v)",
		ach.GroupKey, levelInfo.Name, currentLevel, newLevel, userID, isFirstTime)

	return &UnlockedAchievement{
		ID:          ach.ID,
		GroupKey:    ach.GroupKey,
		Name:        levelInfo.Name,
		Description: levelInfo.Description,
		Icon:        ach.Icon,
		Rarity:      levelInfo.Rarity,
		Category:    ach.Category,
		Level:       newLevel,
		MaxLevel:    len(levels),
		IsFirstTime: isFirstTime,
		PrevLevel:   currentLevel,
	}
}

// ──────────────── Reward ────────────────

func (ac *AchievementChecker) applyReward(userID string, rewardType string, rewardValue string) {
	if rewardType == "" {
		return
	}

	switch rewardType {
	case "garma":
		_, err := ac.db.Exec("UPDATE users SET garma = COALESCE(garma, 0) + $1::integer WHERE id = $2", rewardValue, userID)
		if err != nil {
			log.Printf("[Achievements] garma reward error: %v", err)
		} else {
			log.Printf("[Achievements] +%s garma → user %s", rewardValue, userID)
		}
	}
}

// ──────────────── Notification ────────────────

func (ac *AchievementChecker) sendUnlockNotification(userID string, ach UnlockedAchievement) {
	title := fmt.Sprintf("🏆 %s", ach.Name)
	message := ach.Description
	_, err := ac.db.Exec(`
		INSERT INTO notifications (user_id, type, title, message, created_at)
		VALUES ($1, 'achievement_unlock', $2, $3, $4)
	`, userID, title, message, time.Now())
	if err != nil {
		log.Printf("[Achievements] notification insert error: %v", err)
	}

	if ac.wsHub != nil {
		if hub, ok := ac.wsHub.(*websocket.Hub); ok {
			if err := hub.PublishNewNotification(map[string]interface{}{
				"user_id": userID,
				"type":    "achievement_unlock",
				"title":   title,
				"message": message,
				"achievement": map[string]interface{}{
					"id":            ach.ID,
					"group_key":     ach.GroupKey,
					"name":          ach.Name,
					"description":   ach.Description,
					"icon":          ach.Icon,
					"rarity":        ach.Rarity,
					"level":         ach.Level,
					"max_level":     ach.MaxLevel,
					"is_first_time": ach.IsFirstTime,
					"prev_level":    ach.PrevLevel,
				},
			}); err != nil {
				log.Printf("[Achievements] WS notification error: %v", err)
			}
		}
	}
}
