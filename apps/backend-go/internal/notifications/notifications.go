// Package notifications holds the notification-insertion subsystem shared
// between the api/handlers god package and the crudengine subsystem: a Service
// carrying the DB, Redis, WebSocket hub and optional push sender, plus the
// single INSERT + cache invalidation + WebSocket broadcast path every
// notification type funnels through. Extracted so the crudengine subsystem can
// leave the handlers package without dragging the whole notification domain
// with it.
package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/push"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// Service is the notification subsystem. The push sender is optional: nil
// disables Web Push delivery (VAPID keys not configured) while DB insert,
// cache invalidation and WebSocket broadcast keep working.
type Service struct {
	db    *sql.DB
	redis *redis.Client
	hub   *websocket.Hub
	push  *push.Service
}

// New builds a Service from its dependencies. pushSvc may be nil.
func New(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub, pushSvc *push.Service) *Service {
	return &Service{db: db, redis: redisClient, hub: hub, push: pushSvc}
}

// SetPushService wires (or unwires, with nil) the optional Web Push sender.
// Called from routes.setupRoutes after the VAPID-backed service is built.
func (s *Service) SetPushService(p *push.Service) {
	s.push = p
}

// CreateParams carries the fields for a new notification. Fill only the
// related-* pointers that apply to the notification type; leave the rest nil.
type CreateParams struct {
	UserID               string                     // recipient
	Type                 string                     // notification type
	Message              string                     // optional user-content snippet
	Params               *models.NotificationParams // structured display data (language-neutral)
	RelatedThreadID      *string
	RelatedPostID        *string
	RelatedUserID        *string // actor (who triggered the event)
	RelatedWallPostID    *string
	RelatedWallCommentID *string
	RelatedWallUserID    *string // wall owner
}

// notificationPayload is the data sent over WebSocket for a new notification
type notificationPayload struct {
	ID                   string                 `json:"id"`
	NotificationID       string                 `json:"notification_id"`
	UserID               string                 `json:"user_id"`
	Type                 string                 `json:"type"`
	Title                string                 `json:"title"`
	Message              string                 `json:"message"`
	RelatedThreadID      interface{}            `json:"related_thread_id"`
	RelatedPostID        interface{}            `json:"related_post_id"`
	RelatedUserID        interface{}            `json:"related_user_id"`
	RelatedWallPostID    interface{}            `json:"related_wall_post_id"`
	RelatedWallCommentID interface{}            `json:"related_wall_comment_id"`
	RelatedWallUserID    interface{}            `json:"related_wall_user_id"`
	RelatedWallPostIDs   models.JSONB           `json:"related_wall_post_ids"`
	IsRead               bool                   `json:"is_read"`
	GroupCount           int                    `json:"group_count"`
	Params               map[string]interface{} `json:"params"`
	CreatedAt            string                 `json:"created_at"`
}

// CreateNotification creates a forum notification (thread/post/user references),
// invalidates cache, and broadcasts via WebSocket. The display data is passed as
// structured `params` (language-neutral); title/message are kept empty for new
// rows except message, which may carry a user-content snippet.
func (s *Service) CreateNotification(p CreateParams) (*models.Notification, error) {
	return s.insertNotification(&models.Notification{
		UserID:          p.UserID,
		Type:            p.Type,
		Title:           "",
		Message:         p.Message,
		Params:          MarshalNotificationParams(p.Params),
		RelatedThreadID: p.RelatedThreadID,
		RelatedPostID:   p.RelatedPostID,
		RelatedUserID:   p.RelatedUserID,
	})
}

// CreateWallNotification creates a wall notification (profile wall post/comment
// references plus the actor). Shared cache invalidation + WebSocket delivery
// with CreateNotification via insertNotification.
func (s *Service) CreateWallNotification(p CreateParams) (*models.Notification, error) {
	return s.insertNotification(&models.Notification{
		UserID:               p.UserID,
		Type:                 p.Type,
		Title:                "",
		Message:              p.Message,
		Params:               MarshalNotificationParams(p.Params),
		RelatedUserID:        p.RelatedUserID,
		RelatedWallPostID:    p.RelatedWallPostID,
		RelatedWallCommentID: p.RelatedWallCommentID,
		RelatedWallUserID:    p.RelatedWallUserID,
	})
}

// MarshalNotificationParams encodes structured notification params to JSONB,
// falling back to an empty object for nil params.
func MarshalNotificationParams(p *models.NotificationParams) json.RawMessage {
	if p == nil {
		return json.RawMessage("{}")
	}
	b, err := json.Marshal(p)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

// unmarshalNotificationParams decodes the stored params payload (tolerating
// malformed/empty input by returning a zero struct).
func unmarshalNotificationParams(raw json.RawMessage) models.NotificationParams {
	var p models.NotificationParams
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	return p
}

// notificationParamsJSON returns the raw params as a JSONB string, defaulting
// to "{}" for empty/missing payloads.
func notificationParamsJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	return string(raw)
}

// insertNotification is the single INSERT + cache invalidation + WebSocket
// broadcast path shared by every notification type across the codebase.
// Repeated same-actor, same-type events within the grouping window are folded
// into one row (group_count increments) instead of producing one row each.
func (s *Service) insertNotification(n *models.Notification) (*models.Notification, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	// Try to merge into an existing burst group first (best-effort).
	if merged := mergeNotificationGroup(s.db, n); merged != nil {
		s.afterNotificationCreated(merged)
		return merged, nil
	}

	now := time.Now()
	n.IsRead = false
	n.GroupCount = 1
	n.CreatedAt = &now

	// Seed the liked-post list: a wall_post_like always starts with its single
	// post; every other type keeps an empty array.
	ids := make([]string, 0, 1)
	if n.Type == "wall_post_like" && n.RelatedWallPostID != nil {
		ids = append(ids, *n.RelatedWallPostID)
	}
	n.RelatedWallPostIDs = stringSliceToJSONB(ids)

	query := `
		INSERT INTO notifications (user_id, type, title, message, related_thread_id, related_post_id, related_user_id, related_wall_post_id, related_wall_comment_id, related_wall_user_id, related_wall_post_ids, is_read, created_at, group_count, params)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15::jsonb)
		RETURNING id, user_id, type, title, message, related_thread_id, related_post_id, related_user_id, related_wall_post_id, related_wall_comment_id, related_wall_user_id, related_wall_post_ids, is_read, created_at, group_count, params
	`

	var retCreatedAt time.Time
	err := s.db.QueryRow(query,
		n.UserID, n.Type, n.Title, n.Message, n.RelatedThreadID, n.RelatedPostID, n.RelatedUserID,
		n.RelatedWallPostID, n.RelatedWallCommentID, n.RelatedWallUserID, wallPostIDsJSON(ids), false, now, 1, notificationParamsJSON(n.Params),
	).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Message, &n.RelatedThreadID,
		&n.RelatedPostID, &n.RelatedUserID, &n.RelatedWallPostID, &n.RelatedWallCommentID,
		&n.RelatedWallUserID, &n.RelatedWallPostIDs, &n.IsRead, &retCreatedAt, &n.GroupCount, &n.Params,
	)

	if err != nil {
		log.Printf("[Notifications] Error creating notification: %v", err)
		return nil, err
	}

	n.CreatedAt = &retCreatedAt
	s.afterNotificationCreated(n)

	return n, nil
}

// notificationGroupWindowMinutes is how long a burst of consecutive wall likes
// from one actor stays merged into a single notification row. New likes inside
// the window extend the group; a like after it starts a fresh notification.
const notificationGroupWindowMinutes = 1

// groupableNotificationTypes are the events folded into a burst group. Only
// wall_post_like groups — one-off and forum events are deliberately excluded
// (see notificationGroupWindowMinutes rationale above).
var groupableNotificationTypes = map[string]bool{
	"wall_post_like": true,
}

// mergeNotificationGroup folds n into the most recent matching wall-like group
// when it falls inside the short grouping window. It returns the merged
// notification, or nil when there is nothing to merge into (the caller then
// inserts a fresh row). Errors are non-fatal: the caller falls back to a normal
// insert, so a grouping hiccup never drops a notification.
func mergeNotificationGroup(db *sql.DB, n *models.Notification) *models.Notification {
	if n.RelatedUserID == nil || n.RelatedWallPostID == nil || !groupableNotificationTypes[n.Type] {
		return nil
	}

	var (
		existingID       string
		existingCount    int
		existingWallPost *string
		existingIDs      models.JSONB
	)

	err := db.QueryRow(`
		SELECT id, group_count, related_wall_post_id, related_wall_post_ids
		FROM notifications
		WHERE user_id = $1 AND type = $2 AND related_user_id = $3
		  AND created_at >= now() - $4 * interval '1 minute'
		ORDER BY created_at DESC
		LIMIT 1
	`, n.UserID, n.Type, *n.RelatedUserID, notificationGroupWindowMinutes).Scan(
		&existingID, &existingCount, &existingWallPost, &existingIDs,
	)
	if err != nil {
		return nil // no matching group (sql.ErrNoRows) or lookup error
	}

	ids := jsonbToStrings(existingIDs)
	ids = appendUniqueString(ids, *n.RelatedWallPostID)
	newCount := len(ids)
	if newCount == 0 {
		newCount = existingCount + 1
	}

	// Keep the actor and record the new count in the structured params so the
	// frontend renders "@actor liked N of your posts" in any language.
	params := unmarshalNotificationParams(n.Params)
	params.Count = newCount

	// The freshest post is the thumbnail; the full list is the burst.
	merged := *n
	merged.ID = existingID
	merged.Title = ""
	merged.Message = ""
	merged.Params = MarshalNotificationParams(&params)
	merged.RelatedWallPostID = firstNonNilString(n.RelatedWallPostID, existingWallPost)
	merged.RelatedWallPostIDs = stringSliceToJSONB(ids)
	merged.IsRead = false
	merged.GroupCount = newCount

	var retCreatedAt time.Time
	err = db.QueryRow(`
		UPDATE notifications
		SET group_count = $1, is_read = false, created_at = now(),
		    title = '', message = '',
		    related_wall_post_id = $2,
		    related_wall_post_ids = $3::jsonb,
		    params = $4::jsonb
		WHERE id = $5
		RETURNING created_at
	`, newCount, merged.RelatedWallPostID, wallPostIDsJSON(ids), notificationParamsJSON(merged.Params), existingID).Scan(&retCreatedAt)
	if err != nil {
		log.Printf("[Notifications] Error merging notification group: %v", err)
		return nil // fall back to a fresh insert
	}

	merged.CreatedAt = &retCreatedAt
	return &merged
}

// wallPostIDsJSON marshals a list of wall post IDs into a JSON array string.
func wallPostIDsJSON(ids []string) string {
	if len(ids) == 0 {
		return "[]"
	}
	b, err := json.Marshal(ids)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// stringSliceToJSONB converts a []string into the models.JSONB representation.
func stringSliceToJSONB(ids []string) models.JSONB {
	out := make(models.JSONB, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

// jsonbToStrings converts a scanned models.JSONB array back into []string,
// tolerating non-string elements (dropped) and nil (empty).
func jsonbToStrings(j models.JSONB) []string {
	out := make([]string, 0, len(j))
	for _, v := range j {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// appendUniqueString appends id to ids unless it is already present.
func appendUniqueString(ids []string, id string) []string {
	for _, existing := range ids {
		if existing == id {
			return ids
		}
	}
	return append(ids, id)
}

// firstNonNilString returns a when non-nil, otherwise b.
func firstNonNilString(a, b *string) *string {
	if a != nil {
		return a
	}
	return b
}

// afterNotificationCreated invalidates the user's notification cache and
// broadcasts the notification over WebSocket. Shared by the fresh-insert and
// group-merge paths so both deliver identically.
func (s *Service) afterNotificationCreated(n *models.Notification) {
	if s.redis != nil {
		middleware.InvalidateCacheForNotification(s.redis, n.UserID)
	}

	if s.hub != nil {
		params := map[string]interface{}{}
		if len(n.Params) > 0 {
			_ = json.Unmarshal(n.Params, &params)
		}

		payload := notificationPayload{
			ID:                   n.ID,
			NotificationID:       n.ID,
			UserID:               n.UserID,
			Type:                 n.Type,
			Title:                n.Title,
			Message:              n.Message,
			RelatedThreadID:      jsonNullable(n.RelatedThreadID),
			RelatedPostID:        jsonNullable(n.RelatedPostID),
			RelatedUserID:        jsonNullable(n.RelatedUserID),
			RelatedWallPostID:    jsonNullable(n.RelatedWallPostID),
			RelatedWallCommentID: jsonNullable(n.RelatedWallCommentID),
			RelatedWallUserID:    jsonNullable(n.RelatedWallUserID),
			RelatedWallPostIDs:   n.RelatedWallPostIDs,
			IsRead:               n.IsRead,
			GroupCount:           n.GroupCount,
			Params:               params,
			CreatedAt:            n.CreatedAt.Format(time.RFC3339Nano),
		}

		if err := s.hub.PublishNewNotification(payload); err != nil {
			log.Printf("[Notifications] Error publishing WS event: %v", err)
		}
	}

	// Deliver as a Web Push (PWA) unless disabled or the type is muted by the
	// user. Runs in a goroutine so a slow push service never blocks the request
	// that created the notification. Best-effort — failures are logged, not
	// propagated, mirroring the WebSocket delivery above.
	if s.push != nil {
		pn := push.Notification{
			Title: pushTitleFor(n),
			Body:  pushBodyFor(n),
			URL:   "/notify",
			Icon:  "/pwa-192x192.png",
		}
		if len(n.Params) > 0 {
			// Carry the structured params so the service worker can deep-link or
			// enrich later; the UI already renders the in-app list from them.
			pn.Data = n.Params
		}
		go s.push.SendToUser(context.Background(), n.UserID, n.Type, pn)
	}
}

// jsonNullable returns nil if s is nil, otherwise returns *s as string
func jsonNullable(s *string) interface{} {
	if s == nil {
		return nil
	}
	return *s
}

// ── Push notification display text ─────────────────────────────────────────
// The in-app notification list is rendered client-side in the viewer's language
// from type + structured params. A push, however, is displayed by the OS based
// entirely on the payload the service worker receives, so the backend produces
// a small Russian title/body here (the platform's primary language) from the
// same params. Messages/chat pushes are deliberately out of scope for now.

func pushTitleFor(n *models.Notification) string {
	switch n.Type {
	case "like":
		return "Новая оценка"
	case "reply":
		return "Новый ответ"
	case "thread_reply":
		return "Новый ответ в теме"
	case "wall_post":
		return "Новая запись на стене"
	case "wall_post_like":
		return "Новые оценки"
	case "wall_comment":
		return "Новый комментарий на стене"
	case "wall_comment_reply":
		return "Новый ответ на комментарий"
	case "wall_repost":
		return "Новый репост"
	case "friend_request":
		return "Заявка в друзья"
	case "friend_accepted":
		return "Заявка в друзья принята"
	case "gift_received":
		return "Вам подарили подарок"
	default:
		return "gomo6"
	}
}

func pushBodyFor(n *models.Notification) string {
	params := unmarshalNotificationParams(n.Params)
	actor := params.Actor

	// Prefer stored Russian message when present (legacy rows), else the
	// message carries a user-content snippet but not the full sentence.
	if msg := n.Message; msg != "" {
		if actor != "" {
			return "@" + actor + ": " + msg
		}
		return msg
	}

	switch n.Type {
	case "like":
		if actor != "" {
			return "@" + actor + " оценил(а) ваш контент"
		}
		return "Ваш контент оценили"
	case "reply":
		if actor != "" {
			return "@" + actor + " ответил(а) вам"
		}
		return "Кто-то ответил вам"
	case "thread_reply":
		if actor != "" {
			return "@" + actor + " ответил(а) в теме"
		}
		return "Новый ответ в теме"
	case "wall_post":
		if actor != "" {
			return "@" + actor + " написал(а) на вашей стене"
		}
		return "Новая запись на вашей стене"
	case "wall_post_like":
		if params.Count > 1 {
			if actor != "" {
				return "@" + actor + " и другие оценили ваши записи"
			}
			return "Ваши записи оценили"
		}
		if actor != "" {
			return "@" + actor + " оценил(а) вашу запись"
		}
		return "Вашу запись оценили"
	case "wall_comment":
		if actor != "" {
			return "@" + actor + " прокомментировал(а) вашу запись"
		}
		return "Вашу запись прокомментировали"
	case "wall_comment_reply":
		if actor != "" {
			return "@" + actor + " ответил(а) на ваш комментарий"
		}
		return "Ответ на ваш комментарий"
	case "wall_repost":
		if actor != "" {
			return "@" + actor + " сделал(а) репост вашей записи"
		}
		return "Репост вашей записи"
	case "friend_request":
		if actor != "" {
			return "@" + actor + " хочет добавить вас в друзья"
		}
		return "Новая заявка в друзья"
	case "friend_accepted":
		if actor != "" {
			return "@" + actor + " принял(а) вашу заявку"
		}
		return "Заявка в друзья принята"
	case "gift_received":
		if params.GiftName != "" {
			return "Подарок: " + params.GiftName
		}
		return "Вам отправили подарок"
	default:
		return "Новое уведомление в gomo6"
	}
}
