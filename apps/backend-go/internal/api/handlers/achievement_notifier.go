package handlers

import (
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/notifications"
)

// AchievementNotifier turns milestone level-ups into in-app notifications (a
// row in the notifications panel — no toast). It implements
// achievements.Notifier; the engine calls it only when a level actually rises,
// so notifications are naturally idempotent per level.
type AchievementNotifier struct {
	svc *notifications.Service
}

// NewAchievementNotifier wires the notifier. A nil service disables delivery.
func NewAchievementNotifier(svc *notifications.Service) *AchievementNotifier {
	return &AchievementNotifier{svc: svc}
}

// NotifyMilestone writes an "achievement_unlock" notification carrying the group
// key and reached level; the frontend localizes the title from the catalog.
func (n *AchievementNotifier) NotifyMilestone(userID string, g *achievements.Group, _, newLevel int) {
	if n == nil || n.svc == nil || userID == "" || g == nil {
		return
	}
	_, _ = n.svc.CreateNotification(notifications.CreateParams{
		RecipientID: userID,
		Type:        "achievement_unlock",
		Params: &models.NotificationParams{
			GroupKey: g.Key,
			Level:    newLevel,
		},
	})
}
