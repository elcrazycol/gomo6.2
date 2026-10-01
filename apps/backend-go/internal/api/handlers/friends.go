package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/gomo6/backend/internal/privacy"
	"github.com/gomo6/backend/internal/profiles"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// FriendsHandler handles subscription and friendship endpoints.
//
// The social graph is one-directional at its base: subscribing to a user needs
// no approval. A friendship is the mutual case — when both directions of a
// subscription pair exist — and is materialized in the `friendships` table so
// every privacy/wall/messenger/feed/WS consumer keeps working unchanged.
type FriendsHandler struct {
	db    *sql.DB
	hub   *websocket.Hub
	redis *redis.Client
	notif *notifications.Service
}

func NewFriendsHandler(db *sql.DB) *FriendsHandler {
	return &FriendsHandler{db: db}
}

func (h *FriendsHandler) SetRedis(r *redis.Client) { h.redis = r }

func (h *FriendsHandler) SetWebSocketHub(hub *websocket.Hub) { h.hub = hub }

func (h *FriendsHandler) SetNotifier(n *notifications.Service) { h.notif = n }

// invalidateFriendCaches clears Redis caches for friend/subscription endpoints.
func invalidateFriendCaches(redisClient *redis.Client, user1ID, user2ID string) {
	if redisClient == nil {
		return
	}
	patterns := []string{
		"data:/api/v1/friends*",
		// Purge wall cache entries cached under these two viewers: after
		// unfollowing, an ex-friend must not keep receiving the private wall
		// from cache (the key embeds the viewer identity).
		fmt.Sprintf("data:/api/v1/profile_wall_posts*viewer=%s*", user1ID),
		fmt.Sprintf("data:/api/v1/profile_wall_posts*viewer=%s*", user2ID),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for _, pattern := range patterns {
		var cursor uint64
		for {
			keys, nextCursor, err := redisClient.Scan(ctx, cursor, pattern, 100).Result()
			if err != nil {
				log.Printf("[Friends] cache invalidation scan error: %v", err)
				break
			}
			if len(keys) > 0 {
				redisClient.Del(ctx, keys...)
			}
			cursor = nextCursor
			if cursor == 0 {
				break
			}
		}
	}
}

// orderPair returns the two ids ordered with the smaller first, matching the
// friendships CHECK (user1_id < user2_id).
func orderPair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}

// Subscribe godoc
// @Summary      Subscribe to a user
// @Description  Follow a user. If they already follow you, the pair becomes friends.
// @Tags         Friends
// @Produce      json
// @Param        body body models.SubscribeRequest true "Subscription"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends/subscribe [post]
// @Security     BearerAuth
func (h *FriendsHandler) Subscribe(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	var req models.SubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	subscriberID := claims.UserID
	targetID := req.UserID

	if !h.validateSubscribeTarget(c, subscriberID, targetID) {
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	defer tx.Rollback()

	// Idempotent insert. RowsAffected tells us whether this was a new follow so
	// we do not re-notify on a repeat click.
	result, err := tx.Exec(`
		INSERT INTO subscriptions (subscriber_id, target_id)
		VALUES ($1, $2)
		ON CONFLICT (subscriber_id, target_id) DO NOTHING
	`, subscriberID, targetID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	inserted, _ := result.RowsAffected()

	// Mutual? If the target already follows the subscriber, the pair is friends.
	var mutual bool
	if err := tx.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM subscriptions WHERE subscriber_id = $1 AND target_id = $2
		)
	`, targetID, subscriberID).Scan(&mutual); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	becameFriends := false
	if mutual {
		user1, user2 := orderPair(subscriberID, targetID)
		var friendshipID string
		err := tx.QueryRow(`
			INSERT INTO friendships (user1_id, user2_id) VALUES ($1, $2)
			ON CONFLICT (user1_id, user2_id) DO NOTHING
			RETURNING id
		`, user1, user2).Scan(&friendshipID)
		switch {
		case err == sql.ErrNoRows:
			// Already friends — nothing new to materialize.
		case err != nil:
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
			return
		default:
			becameFriends = true
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	invalidateFriendCaches(h.redis, subscriberID, targetID)

	// Only notify on a genuinely new follow.
	if inserted > 0 {
		subscriberUsername := profiles.UsernameByID(h.db, subscriberID)
		h.createFriendNotification(targetID, "new_subscriber", subscriberUsername, &subscriberID)
		if becameFriends {
			// The person who completed the mutual pair already knows; tell the
			// target that the friendship is now real.
			h.createFriendNotification(targetID, "friend_mutual", subscriberUsername, &subscriberID)
		}
	}

	status := "subscribed"
	if mutual {
		status = "friends"
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"status":         status,
		"became_friends": becameFriends,
	}))
}

// validateSubscribeTarget applies the preconditions of a follow: the target
// must exist and must not be the caller. It writes the rejection response and
// returns false on any violation.
func (h *FriendsHandler) validateSubscribeTarget(c *gin.Context, subscriberID, targetID string) bool {
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", targetID).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("User not found"))
		return false
	}

	if subscriberID == targetID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot subscribe to yourself"))
		return false
	}
	return true
}

// Unsubscribe godoc
// @Summary      Unsubscribe from a user
// @Description  Stop following a user. If the pair was mutual, the friendship is dissolved.
// @Tags         Friends
// @Produce      json
// @Param        userId path string true "User ID to unsubscribe from"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /friends/subscribe/{userId} [delete]
// @Security     BearerAuth
func (h *FriendsHandler) Unsubscribe(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	targetUserID := c.Param("userId")
	if _, err := uuid.Parse(targetUserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID"))
		return
	}

	if claims.UserID == targetUserID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot unsubscribe from yourself"))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	defer tx.Rollback()

	result, err := tx.Exec(`
		DELETE FROM subscriptions WHERE subscriber_id = $1 AND target_id = $2
	`, claims.UserID, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	removed, _ := result.RowsAffected()

	// A friendship only exists while both directions do, so dissolve it.
	friendResult, err := tx.Exec(`
		DELETE FROM friendships
		WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
	`, claims.UserID, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	wasFriend, _ := friendResult.RowsAffected()

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	if removed == 0 && wasFriend == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Not subscribed to this user"))
		return
	}

	// H1/M1: when a friendship is dissolved, revoke live WebSocket
	// subscriptions to each other's wall and now-playing rooms so an ex-friend
	// stops receiving private realtime events immediately.
	if wasFriend > 0 && h.hub != nil {
		h.hub.ForceUnsubscribeFromWallRooms(claims.UserID, targetUserID)
		h.hub.ForceUnsubscribeFromWallRooms(targetUserID, claims.UserID)
		h.hub.ForceUnsubscribeFromNowPlayingRooms(claims.UserID, targetUserID)
		h.hub.ForceUnsubscribeFromNowPlayingRooms(targetUserID, claims.UserID)
	}

	invalidateFriendCaches(h.redis, claims.UserID, targetUserID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"status":     "unsubscribed",
		"was_friend": wasFriend > 0,
	}))
}

// GetFriends godoc
// @Summary      Get friends list
// @Description  Get the mutual (friendship) list for a user
// @Tags         Friends
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends [get]
// @Security     BearerAuth
func (h *FriendsHandler) GetFriends(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	// Support viewing another user's friends via ?user_id=X
	targetUserID := c.Query("user_id")
	if targetUserID == "" {
		targetUserID = claims.UserID
	} else if _, err := uuid.Parse(targetUserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}

	// Private profile: block friends list from non-friends
	shouldFilter, ps, err := privacy.ShouldFilterPrivateProfile(h.db, claims.UserID, targetUserID)
	if err == nil && shouldFilter && ps.PrivateHideFriends {
		c.JSON(http.StatusOK, models.SuccessResponse([]models.FriendResponse{}))
		return
	}

	rows, err := h.db.Query(`
		SELECT 
			f.id AS friendship_id,
			CASE WHEN f.user1_id = $1 THEN f.user2_id ELSE f.user1_id END AS friend_id,
			p.username,
			p.public_id,
			p.display_name,
			p.nickname_emoji_id,
			p.avatar_url,
			p.is_online
		FROM friendships f
		JOIN profiles p ON p.id = CASE WHEN f.user1_id = $1 THEN f.user2_id ELSE f.user1_id END
		WHERE f.user1_id = $1 OR f.user2_id = $1
		ORDER BY p.username ASC
	`, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	defer rows.Close()

	var friends []models.FriendResponse
	for rows.Next() {
		var friend models.FriendResponse
		if err := rows.Scan(&friend.FriendshipID, &friend.UserID, &friend.Username, &friend.PublicID, &friend.DisplayName, &friend.NicknameEmojiID, &friend.AvatarURL, &friend.IsOnline); err != nil {
			continue
		}
		friends = append(friends, friend)
	}

	if friends == nil {
		friends = []models.FriendResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(friends))
}

// GetSubscribers godoc
// @Summary      Get subscribers
// @Description  Get the users who follow the target (defaults to the caller)
// @Tags         Friends
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends/subscribers [get]
// @Security     BearerAuth
func (h *FriendsHandler) GetSubscribers(c *gin.Context) {
	targetUserID, hidden, ok := h.subscriptionListTarget(c)
	if !ok {
		return
	}
	if hidden {
		c.JSON(http.StatusOK, models.SuccessResponse([]models.SubscriptionUser{}))
		return
	}

	h.querySubscriptionUsers(c, `
		SELECT
			s.subscriber_id,
			p.username,
			p.public_id,
			p.display_name,
			p.nickname_emoji_id,
			p.avatar_url,
			p.is_online,
			EXISTS(
				SELECT 1 FROM friendships f
				WHERE (f.user1_id = $1 AND f.user2_id = s.subscriber_id)
				   OR (f.user1_id = s.subscriber_id AND f.user2_id = $1)
			) AS is_friend,
			s.created_at
		FROM subscriptions s
		JOIN profiles p ON p.id = s.subscriber_id
		WHERE s.target_id = $1
		ORDER BY s.created_at DESC, p.username ASC
	`, targetUserID)
}

// GetSubscriptions godoc
// @Summary      Get subscriptions
// @Description  Get the users the target follows (defaults to the caller)
// @Tags         Friends
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends/subscriptions [get]
// @Security     BearerAuth
func (h *FriendsHandler) GetSubscriptions(c *gin.Context) {
	targetUserID, hidden, ok := h.subscriptionListTarget(c)
	if !ok {
		return
	}
	if hidden {
		c.JSON(http.StatusOK, models.SuccessResponse([]models.SubscriptionUser{}))
		return
	}

	h.querySubscriptionUsers(c, `
		SELECT
			s.target_id,
			p.username,
			p.public_id,
			p.display_name,
			p.nickname_emoji_id,
			p.avatar_url,
			p.is_online,
			EXISTS(
				SELECT 1 FROM friendships f
				WHERE (f.user1_id = $1 AND f.user2_id = s.target_id)
				   OR (f.user1_id = s.target_id AND f.user2_id = $1)
			) AS is_friend,
			s.created_at
		FROM subscriptions s
		JOIN profiles p ON p.id = s.target_id
		WHERE s.subscriber_id = $1
		ORDER BY s.created_at DESC, p.username ASC
	`, targetUserID)
}

// subscriptionListTarget resolves the user whose subscriber/subscription list
// is requested (the caller by default), enforcing the same private-profile gate
// as the friends list. Returns (target, hidden, ok): hidden=true means the list
// must be returned empty; ok=false means a response was already written.
func (h *FriendsHandler) subscriptionListTarget(c *gin.Context) (string, bool, bool) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return "", false, false
	}

	targetUserID := c.Query("user_id")
	if targetUserID == "" {
		targetUserID = claims.UserID
	} else if _, err := uuid.Parse(targetUserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return "", false, false
	}

	shouldFilter, ps, err := privacy.ShouldFilterPrivateProfile(h.db, claims.UserID, targetUserID)
	if err == nil && shouldFilter && ps.PrivateHideFriends {
		return targetUserID, true, true
	}
	return targetUserID, false, true
}

// querySubscriptionUsers runs a list query (column order: user_id, username,
// public_id, display_name, nickname_emoji_id, avatar_url, is_online, is_friend,
// created_at) and writes the SubscriptionUser list.
func (h *FriendsHandler) querySubscriptionUsers(c *gin.Context, query, targetUserID string) {
	rows, err := h.db.Query(query, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	defer rows.Close()

	users := []models.SubscriptionUser{}
	for rows.Next() {
		var u models.SubscriptionUser
		var createdAt time.Time
		if err := rows.Scan(&u.UserID, &u.Username, &u.PublicID, &u.DisplayName, &u.NicknameEmojiID, &u.AvatarURL, &u.IsOnline, &u.IsFriend, &createdAt); err != nil {
			continue
		}
		u.SubscribedAt = createdAt.Format(time.RFC3339)
		users = append(users, u)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(users))
}

// GetFriendStatus godoc
// @Summary      Get relationship status
// @Description  Get the subscription/friendship status with another user
// @Tags         Friends
// @Produce      json
// @Param        userId path string true "User ID"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends/status/{userId} [get]
// @Security     BearerAuth
func (h *FriendsHandler) GetFriendStatus(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	targetUserID := c.Param("userId")
	if _, err := uuid.Parse(targetUserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID"))
		return
	}

	if claims.UserID == targetUserID {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"status": "self"}))
		return
	}

	var isFriend, iFollow, theyFollow bool
	err := h.db.QueryRow(`
		SELECT
			EXISTS(
				SELECT 1 FROM friendships
				WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
			),
			EXISTS(
				SELECT 1 FROM subscriptions WHERE subscriber_id = $1 AND target_id = $2
			),
			EXISTS(
				SELECT 1 FROM subscriptions WHERE subscriber_id = $2 AND target_id = $1
			)
	`, claims.UserID, targetUserID).Scan(&isFriend, &iFollow, &theyFollow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	if isFriend {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"status":      "friends",
			"follows_you": true,
		}))
		return
	}

	status := "none"
	if iFollow {
		status = "subscribed"
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"status":      status,
		"follows_you": theyFollow,
	}))
}

// createFriendNotification sends a WebSocket notification for social events.
func (h *FriendsHandler) createFriendNotification(userID, notifType, actorUsername string, relatedUserID *string) {
	if h.notif == nil {
		return
	}
	params := &models.NotificationParams{Actor: actorUsername}
	_, err := h.notif.CreateNotification(notifications.CreateParams{
		RecipientID: userID,
		Type:        notifType,
		Params:      params,
		ActorID:     relatedUserID,
	})
	if err != nil {
		log.Printf("[Friends] Failed to create notification: %v", err)
	}
}
