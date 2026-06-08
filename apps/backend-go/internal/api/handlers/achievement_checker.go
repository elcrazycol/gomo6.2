package handlers

import (
	"database/sql"
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

// Achievement represents an unlocked achievement for notification purposes.
type UnlockedAchievement struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Rarity      string `json:"rarity"`
	Category    string `json:"category"`
}

// CheckAndAward checks all relevant achievements for a user action and awards any newly unlocked ones.
// Returns the list of newly unlocked achievements (for notification).
func (ac *AchievementChecker) CheckAndAward(userID string) []UnlockedAchievement {
	if userID == "" || ac.db == nil {
		return nil
	}

	var unlocked []UnlockedAchievement

	// Get user stats
	stats := ac.getUserStats(userID)
	if stats == nil {
		return nil
	}

	// Check each category
	unlocked = append(unlocked, ac.checkPostAchievements(userID, stats.postCount)...)
	unlocked = append(unlocked, ac.checkThreadAchievements(userID, stats.threadCount)...)
	unlocked = append(unlocked, ac.checkLikesReceivedAchievements(userID, stats.likesReceived)...)
	unlocked = append(unlocked, ac.checkLikesGivenAchievements(userID, stats.likesGiven)...)
	unlocked = append(unlocked, ac.checkImageAchievements(userID, stats.imageCount)...)
	unlocked = append(unlocked, ac.checkAnonymousPostsAchievements(userID, stats.anonymousPostCount)...)
	unlocked = append(unlocked, ac.checkAnonymousLikesAchievements(userID, stats.anonymousLikesReceived)...)

	// Send notification for each newly unlocked achievement
	for _, ach := range unlocked {
		ac.sendUnlockNotification(userID, ach)
	}

	return unlocked
}

// userStats holds aggregated user statistics for achievement checking.
type userStats struct {
	postCount              int
	threadCount            int
	likesReceived          int
	likesGiven             int
	imageCount             int
	anonymousPostCount     int
	anonymousLikesReceived int
}

// getUserStats loads all relevant stats for a user.
// Uses direct COUNT(*) queries instead of users.post_count/thread_count
// because RecomputeUserProfileStats runs asynchronously — there's a race.
func (ac *AchievementChecker) getUserStats(userID string) *userStats {
	s := &userStats{}

	// Post count — direct count, avoids race with async RecomputeUserProfileStats
	ac.db.QueryRow("SELECT COUNT(*) FROM posts WHERE user_id = $1", userID).Scan(&s.postCount)

	// Thread count — direct count
	ac.db.QueryRow("SELECT COUNT(*) FROM threads WHERE user_id = $1", userID).Scan(&s.threadCount)

	// Likes received (likes on user's posts)
	ac.db.QueryRow(`
		SELECT COUNT(*) FROM post_likes pl
		JOIN posts p ON pl.post_id = p.id
		WHERE p.user_id = $1
	`, userID).Scan(&s.likesReceived)

	// Likes given
	ac.db.QueryRow("SELECT COUNT(*) FROM post_likes WHERE user_id = $1", userID).Scan(&s.likesGiven)

	// Image count (posts with images)
	ac.db.QueryRow(`
		SELECT COUNT(*) FROM posts
		WHERE user_id = $1 AND image_url IS NOT NULL
	`, userID).Scan(&s.imageCount)

	// Anonymous posts
	ac.db.QueryRow(`
		SELECT COUNT(*) FROM posts p
		JOIN users u ON p.user_id = u.id
		WHERE p.user_id = $1 AND u.is_anonymous = TRUE
	`, userID).Scan(&s.anonymousPostCount)

	// Anonymous likes received
	ac.db.QueryRow(`
		SELECT COUNT(*) FROM post_likes pl
		JOIN posts p ON pl.post_id = p.id
		JOIN users u ON p.user_id = u.id
		WHERE p.user_id = $1 AND u.is_anonymous = TRUE
	`, userID).Scan(&s.anonymousLikesReceived)

	return s
}

// checkPostAchievements checks posting milestones.
func (ac *AchievementChecker) checkPostAchievements(userID string, count int) []UnlockedAchievement {
	var unlocked []UnlockedAchievement
	milestones := map[int]string{
		1:     "a0000001-0000-0000-0000-000000000001", // Первое слово
		50:    "a0000001-0000-0000-0000-000000000002", // Писатель
		500:   "a0000001-0000-0000-0000-000000000003", // Романист
		5000:  "a0000001-0000-0000-0000-000000000004", // Классик
		10000: "a0000001-0000-0000-0000-000000000005", // Графоман
	}
	for threshold, achID := range milestones {
		if count >= threshold {
			if ach := ac.awardIfNew(userID, achID, count, threshold); ach != nil {
				unlocked = append(unlocked, *ach)
			}
		}
	}
	return unlocked
}

// checkThreadAchievements checks thread creation milestones.
func (ac *AchievementChecker) checkThreadAchievements(userID string, count int) []UnlockedAchievement {
	var unlocked []UnlockedAchievement
	milestones := map[int]string{
		1:   "a0000001-0000-0000-0000-000000000006", // Первая нить
		10:  "a0000001-0000-0000-0000-000000000007", // Ткач
		50:  "a0000001-0000-0000-0000-000000000008", // Архитектор
		100: "a0000001-0000-0000-0000-000000000009", // Вселенная
	}
	for threshold, achID := range milestones {
		if count >= threshold {
			if ach := ac.awardIfNew(userID, achID, count, threshold); ach != nil {
				unlocked = append(unlocked, *ach)
			}
		}
	}
	return unlocked
}

// checkLikesReceivedAchievements checks likes received milestones.
func (ac *AchievementChecker) checkLikesReceivedAchievements(userID string, count int) []UnlockedAchievement {
	var unlocked []UnlockedAchievement
	milestones := map[int]string{
		1:     "a0000001-0000-0000-0000-000000000010", // Замеченный
		100:   "a0000001-0000-0000-0000-000000000011", // Популярный
		1000:  "a0000001-0000-0000-0000-000000000012", // Звезда
		10000: "a0000001-0000-0000-0000-000000000013", // Легенда
	}
	for threshold, achID := range milestones {
		if count >= threshold {
			if ach := ac.awardIfNew(userID, achID, count, threshold); ach != nil {
				unlocked = append(unlocked, *ach)
			}
		}
	}
	return unlocked
}

// checkLikesGivenAchievements checks likes given milestones.
func (ac *AchievementChecker) checkLikesGivenAchievements(userID string, count int) []UnlockedAchievement {
	var unlocked []UnlockedAchievement
	milestones := map[int]string{
		1:    "a0000001-0000-0000-0000-000000000014", // Добрый
		100:  "a0000001-0000-0000-0000-000000000015", // Щедрый
		1000: "a0000001-0000-0000-0000-000000000016", // Меценат
	}
	for threshold, achID := range milestones {
		if count >= threshold {
			if ach := ac.awardIfNew(userID, achID, count, threshold); ach != nil {
				unlocked = append(unlocked, *ach)
			}
		}
	}
	return unlocked
}

// checkImageAchievements checks image upload milestones.
func (ac *AchievementChecker) checkImageAchievements(userID string, count int) []UnlockedAchievement {
	var unlocked []UnlockedAchievement
	milestones := map[int]string{
		1:    "a0000001-0000-0000-0000-000000000024", // Фотограф
		100:  "a0000001-0000-0000-0000-000000000025", // Галерист
		1000: "a0000001-0000-0000-0000-000000000026", // Фотохудожник
	}
	for threshold, achID := range milestones {
		if count >= threshold {
			if ach := ac.awardIfNew(userID, achID, count, threshold); ach != nil {
				unlocked = append(unlocked, *ach)
			}
		}
	}
	return unlocked
}

// checkAnonymousPostsAchievements checks anonymous posting milestones.
func (ac *AchievementChecker) checkAnonymousPostsAchievements(userID string, count int) []UnlockedAchievement {
	var unlocked []UnlockedAchievement
	if count >= 10 {
		if ach := ac.awardIfNew(userID, "a0000001-0000-0000-0000-000000000029", count, 10); ach != nil {
			unlocked = append(unlocked, *ach)
		}
	}
	return unlocked
}

// checkAnonymousLikesAchievements checks anonymous likes milestones.
func (ac *AchievementChecker) checkAnonymousLikesAchievements(userID string, count int) []UnlockedAchievement {
	var unlocked []UnlockedAchievement
	if count >= 50 {
		if ach := ac.awardIfNew(userID, "a0000001-0000-0000-0000-000000000030", count, 50); ach != nil {
			unlocked = append(unlocked, *ach)
		}
	}
	return unlocked
}

// AwardOneTime awards a one-time achievement (e.g., first avatar, first bio, pin post, repost).
func (ac *AchievementChecker) AwardOneTime(userID string, achievementID string) *UnlockedAchievement {
	return ac.awardIfNew(userID, achievementID, 1, 1)
}

// awardIfNew inserts the achievement if not already unlocked. Returns achievement info if newly unlocked.
func (ac *AchievementChecker) awardIfNew(userID string, achievementID string, progress, target int) *UnlockedAchievement {
	if userID == "" || achievementID == "" {
		return nil
	}

	// Check if already unlocked
	var exists bool
	err := ac.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = $2)",
		userID, achievementID,
	).Scan(&exists)
	if err != nil || exists {
		return nil
	}

	// Get achievement details
	var name, description, icon, rarity string
	err = ac.db.QueryRow(
		"SELECT name, description, COALESCE(icon, ''), COALESCE(rarity, 'common') FROM achievements WHERE id = $1",
		achievementID,
	).Scan(&name, &description, &icon, &rarity)
	if err != nil {
		log.Printf("[Achievements] awardIfNew: achievement %s not found: %v", achievementID, err)
		return nil
	}

	// Insert user achievement with progress
	_, err = ac.db.Exec(`
		INSERT INTO user_achievements (user_id, achievement_id, level, progress_current, progress_target)
		VALUES ($1, $2, 1, $3, $4)
		ON CONFLICT (user_id, achievement_id) DO NOTHING
	`, userID, achievementID, progress, target)
	if err != nil {
		log.Printf("[Achievements] awardIfNew: insert error: %v", err)
		return nil
	}

	// Check if it was actually inserted (handle ON CONFLICT)
	err = ac.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = $2)",
		userID, achievementID,
	).Scan(&exists)
	if err != nil || !exists {
		return nil
	}

	// Apply reward
	ac.applyReward(userID, achievementID)

	log.Printf("[Achievements] Awarded %s (%s) to user %s", name, achievementID, userID)

	return &UnlockedAchievement{
		ID:          achievementID,
		Name:        name,
		Description: description,
		Icon:        icon,
		Rarity:      rarity,
		Category:    "",
	}
}

// applyReward applies the achievement's reward (garma bonus, username color, etc.)
func (ac *AchievementChecker) applyReward(userID string, achievementID string) {
	var rewardType, rewardValue sql.NullString
	err := ac.db.QueryRow(
		"SELECT reward_type, reward_value FROM achievements WHERE id = $1",
		achievementID,
	).Scan(&rewardType, &rewardValue)
	if err != nil || !rewardType.Valid {
		return
	}

	switch rewardType.String {
	case "garma":
		if rewardValue.Valid {
			_, err = ac.db.Exec("UPDATE users SET garma = COALESCE(garma, 0) + $1::integer WHERE id = $2", rewardValue.String, userID)
			if err != nil {
				log.Printf("[Achievements] Error awarding garma: %v", err)
			} else {
				log.Printf("[Achievements] Awarded %s garma to user %s", rewardValue.String, userID)
			}
		}
		// username_color is handled separately when checking for highest color achievement
	}
}

// sendUnlockNotification creates a notification and broadcasts via WebSocket.
func (ac *AchievementChecker) sendUnlockNotification(userID string, ach UnlockedAchievement) {
	// Create DB notification
	title := fmt.Sprintf("🏆 %s", ach.Name)
	message := ach.Description
	_, err := ac.db.Exec(`
		INSERT INTO notifications (user_id, type, title, message, created_at)
		VALUES ($1, 'achievement_unlock', $2, $3, $4)
	`, userID, title, message, time.Now())
	if err != nil {
		log.Printf("[Achievements] Error creating notification: %v", err)
	}

	// WebSocket real-time notification
	if ac.wsHub != nil {
		if hub, ok := ac.wsHub.(*websocket.Hub); ok {
			if err := hub.PublishNewNotification(map[string]interface{}{
				"user_id": userID,
				"type":    "achievement_unlock",
				"title":   title,
				"message": message,
				"achievement": map[string]interface{}{
					"id":          ach.ID,
					"name":        ach.Name,
					"description": ach.Description,
					"icon":        ach.Icon,
					"rarity":      ach.Rarity,
				},
			}); err != nil {
				log.Printf("[Achievements] Error publishing WS notification: %v", err)
			}
		}
	}
}
