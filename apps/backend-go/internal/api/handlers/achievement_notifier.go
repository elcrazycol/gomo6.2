package handlers

import (
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/notifications"
)

// AchievementNotifier turns milestone level-ups and automatic award grants
// into in-app notifications (rows in the notifications panel — no toasts). It
// implements achievements.Notifier and achievements.AwardNotifier; the engine
// calls it only for real unlocks/grants, so notifications are naturally
// idempotent.
type AchievementNotifier struct {
	svc *notifications.Service
}

// NewAchievementNotifier wires the notifier. A nil service disables delivery.
func NewAchievementNotifier(svc *notifications.Service) *AchievementNotifier {
	return &AchievementNotifier{svc: svc}
}

// NotifyAwardGranted writes an "award_granted" notification carrying the award
// key and the granter's username. It implements achievements.AwardNotifier;
// the auto-award engine calls it only for newly inserted grants, so
// notifications are naturally idempotent per (award, user).
func (n *AchievementNotifier) NotifyAwardGranted(userID, awardKey, actor string) {
	if n == nil || n.svc == nil || userID == "" {
		return
	}
	_, _ = n.svc.CreateNotification(notifications.CreateParams{
		RecipientID: userID,
		Type:        "award_granted",
		Params: &models.NotificationParams{
			AwardKey: awardKey,
			Actor:    actor,
		},
	})
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
