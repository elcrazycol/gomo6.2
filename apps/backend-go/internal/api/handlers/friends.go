package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// FriendsHandler handles friend request and friendship endpoints.
type FriendsHandler struct {
	db    *sql.DB
	hub   *websocket.Hub
	redis *redis.Client
}

func NewFriendsHandler(db *sql.DB) *FriendsHandler {
	return &FriendsHandler{db: db}
}

func (h *FriendsHandler) SetRedis(r *redis.Client) { h.redis = r }

func (h *FriendsHandler) SetWebSocketHub(hub *websocket.Hub) { h.hub = hub }

// invalidateFriendCaches clears Redis caches for friend-related endpoints.
func invalidateFriendCaches(redisClient *redis.Client, user1ID, user2ID string) {
	if redisClient == nil {
		return
	}
	patterns := []string{
		"data:/api/v1/friends*",
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

// SendRequest godoc
// @Summary      Send friend request
// @Description  Send a friend request to another user
// @Tags         Friends
// @Produce      json
// @Param        body body models.SendFriendRequest true "Friend request"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      409 {object} models.APIResponse
// @Router       /friends/request [post]
// @Security     BearerAuth
func (h *FriendsHandler) SendRequest(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var req models.SendFriendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	senderID := claims.UserID
	receiverID := req.ReceiverID

	// Validate receiver exists
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", receiverID).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("User not found"))
		return
	}

	// Cannot add yourself
	if senderID == receiverID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot add yourself as a friend"))
		return
	}

	// Check if already friends
	var alreadyFriends bool
	err = h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friendships 
			WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
		)`, senderID, receiverID).Scan(&alreadyFriends)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	if alreadyFriends {
		c.JSON(http.StatusConflict, models.ErrorResponse("Already friends"))
		return
	}

	// Check if there's already a pending request from sender to receiver
	var existingPending bool
	err = h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friend_requests 
			WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
		)`, senderID, receiverID).Scan(&existingPending)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	if existingPending {
		c.JSON(http.StatusConflict, models.ErrorResponse("Friend request already sent"))
		return
	}

	// Check if there's a pending request from receiver to sender (auto-accept)
	var reverseRequestID sql.NullString
	err = h.db.QueryRow(`
		SELECT id FROM friend_requests 
		WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
	`, receiverID, senderID).Scan(&reverseRequestID)
	if err != nil && err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	if reverseRequestID.Valid {
		// Auto-accept the reverse request (both want to be friends)
		err = h.acceptFriendRequest(c, reverseRequestID.String, receiverID, senderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
			return
		}
		// Notify the reverse request sender that their request was accepted
		h.createFriendNotification(receiverID, "friend_accepted",
			"Заявка принята", fmt.Sprintf("@%s принял вашу заявку в друзья", getUsernameFromDB(h.db, senderID)),
			&senderID)
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"status":  "friends",
			"message": "Friend request accepted automatically",
		}))
		return
	}

	// Check if there's a rejected request and update it to pending
	var existingRejectedID sql.NullString
	err = h.db.QueryRow(`
		SELECT id FROM friend_requests 
		WHERE sender_id = $1 AND receiver_id = $2 AND status = 'rejected'
	`, senderID, receiverID).Scan(&existingRejectedID)
	if err != nil && err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	if existingRejectedID.Valid {
		// Update the rejected request back to pending
		_, err = h.db.Exec(`
			UPDATE friend_requests SET status = 'pending', updated_at = NOW() WHERE id = $1
		`, existingRejectedID.String)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
			return
		}
	} else {
		// Create new request
		var requestID string
		err = h.db.QueryRow(`
			INSERT INTO friend_requests (sender_id, receiver_id, status)
			VALUES ($1, $2, 'pending')
			RETURNING id
		`, senderID, receiverID).Scan(&requestID)
		if err != nil {
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
				c.JSON(http.StatusConflict, models.ErrorResponse("Friend request already sent"))
				return
			}
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
			return
		}
	}

	// Invalidate caches for both users
	invalidateFriendCaches(h.redis, senderID, receiverID)

	// Notify the receiver
	senderUsername := getUsernameFromDB(h.db, senderID)
	h.createFriendNotification(receiverID, "friend_request",
		"Новая заявка в друзья", fmt.Sprintf("@%s хочет добавить вас в друзья", senderUsername),
		&senderID)

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{
		"status":  "pending",
		"message": "Friend request sent",
	}))
}

// AcceptRequest godoc
// @Summary      Accept friend request
// @Description  Accept an incoming friend request
// @Tags         Friends
// @Produce      json
// @Param        id path string true "Friend request ID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /friends/request/{id}/accept [put]
// @Security     BearerAuth
func (h *FriendsHandler) AcceptRequest(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	requestID := c.Param("id")
	if _, err := uuid.Parse(requestID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request ID"))
		return
	}

	// Get the request
	var request models.FriendRequest
	err := h.db.QueryRow(`
		SELECT id, sender_id, receiver_id, status FROM friend_requests WHERE id = $1
	`, requestID).Scan(&request.ID, &request.SenderID, &request.ReceiverID, &request.Status)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Friend request not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	// Only the receiver can accept
	if request.ReceiverID != claims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You can only accept requests sent to you"))
		return
	}

	// Must be pending
	if request.Status != "pending" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Request is not pending"))
		return
	}

	err = h.acceptFriendRequest(c, requestID, request.SenderID, request.ReceiverID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	// Notify the sender
	receiverUsername := getUsernameFromDB(h.db, claims.UserID)
	h.createFriendNotification(request.SenderID, "friend_accepted",
		"Заявка принята", fmt.Sprintf("@%s принял вашу заявку в друзья", receiverUsername),
		&request.ReceiverID)

	// Invalidate caches for both users
	invalidateFriendCaches(h.redis, request.SenderID, request.ReceiverID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"status":  "friends",
		"message": "Friend request accepted",
	}))
}

// acceptFriendRequest is the internal implementation for accepting a friend request.
func (h *FriendsHandler) acceptFriendRequest(c *gin.Context, requestID, senderID, receiverID string) error {
	tx, err := h.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Update request status to accepted
	_, err = tx.Exec(`
		UPDATE friend_requests SET status = 'accepted', updated_at = NOW() WHERE id = $1
	`, requestID)
	if err != nil {
		return err
	}

	// Create friendship (user1 < user2 for consistency)
	user1, user2 := senderID, receiverID
	if senderID > receiverID {
		user1, user2 = receiverID, senderID
	}

	_, err = tx.Exec(`
		INSERT INTO friendships (user1_id, user2_id) VALUES ($1, $2)
		ON CONFLICT (user1_id, user2_id) DO NOTHING
	`, user1, user2)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// RejectRequest godoc
// @Summary      Reject friend request
// @Description  Reject an incoming friend request
// @Tags         Friends
// @Produce      json
// @Param        id path string true "Friend request ID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /friends/request/{id}/reject [put]
// @Security     BearerAuth
func (h *FriendsHandler) RejectRequest(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	requestID := c.Param("id")
	if _, err := uuid.Parse(requestID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request ID"))
		return
	}

	// Get the request
	var receiverID, status string
	err := h.db.QueryRow(`
		SELECT receiver_id, status FROM friend_requests WHERE id = $1
	`, requestID).Scan(&receiverID, &status)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Friend request not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	// Only the receiver can reject
	if receiverID != claims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You can only reject requests sent to you"))
		return
	}

	// Must be pending
	if status != "pending" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Request is not pending"))
		return
	}

	_, err = h.db.Exec(`
		UPDATE friend_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1
	`, requestID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	// Invalidate caches
	invalidateFriendCaches(h.redis, claims.UserID, "")

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"status":  "rejected",
		"message": "Friend request rejected",
	}))
}

// CancelRequest godoc
// @Summary      Cancel outgoing friend request
// @Description  Cancel a friend request you sent
// @Tags         Friends
// @Produce      json
// @Param        id path string true "Friend request ID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /friends/request/{id} [delete]
// @Security     BearerAuth
func (h *FriendsHandler) CancelRequest(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	requestID := c.Param("id")
	if _, err := uuid.Parse(requestID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request ID"))
		return
	}

	// Get the request
	var senderID, status string
	err := h.db.QueryRow(`
		SELECT sender_id, status FROM friend_requests WHERE id = $1
	`, requestID).Scan(&senderID, &status)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Friend request not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	// Only the sender can cancel
	if senderID != claims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You can only cancel requests you sent"))
		return
	}

	// Must be pending
	if status != "pending" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Request is not pending"))
		return
	}

	_, err = h.db.Exec(`
		UPDATE friend_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1
	`, requestID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	invalidateFriendCaches(h.redis, claims.UserID, "")

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"status":  "cancelled",
		"message": "Friend request cancelled",
	}))
}

// RemoveFriend godoc
// @Summary      Remove friend
// @Description  Remove a user from your friends
// @Tags         Friends
// @Produce      json
// @Param        userId path string true "User ID to remove"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /friends/{userId} [delete]
// @Security     BearerAuth
func (h *FriendsHandler) RemoveFriend(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	targetUserID := c.Param("userId")
	if _, err := uuid.Parse(targetUserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID"))
		return
	}

	if claims.UserID == targetUserID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot remove yourself"))
		return
	}

	// Delete friendship
	result, err := h.db.Exec(`
		DELETE FROM friendships 
		WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
	`, claims.UserID, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Not friends with this user"))
		return
	}

	// Mark old friend requests as rejected so they can send new ones later
	h.db.Exec(`
		UPDATE friend_requests 
		SET status = 'rejected', updated_at = NOW()
		WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
		AND status = 'accepted'
	`, claims.UserID, targetUserID)

	// Invalidate caches for both users
	invalidateFriendCaches(h.redis, claims.UserID, targetUserID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"status":  "removed",
		"message": "Friend removed",
	}))
}

// GetFriends godoc
// @Summary      Get friends list
// @Description  Get list of friends for the authenticated user
// @Tags         Friends
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends [get]
// @Security     BearerAuth
func (h *FriendsHandler) GetFriends(c *gin.Context) {
	claims := ensureAuth(c)
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
	shouldFilter, ps, err := ShouldFilterPrivateProfile(h.db, claims.UserID, targetUserID)
	if err == nil && shouldFilter && ps.PrivateHideFriends {
		c.JSON(http.StatusOK, models.SuccessResponse([]models.FriendResponse{}))
		return
	}

	rows, err := h.db.Query(`
		SELECT 
			f.id AS friendship_id,
			CASE WHEN f.user1_id = $1 THEN f.user2_id ELSE f.user1_id END AS friend_id,
			p.username,
			p.display_name,
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
		if err := rows.Scan(&friend.FriendshipID, &friend.UserID, &friend.Username, &friend.DisplayName, &friend.AvatarURL, &friend.IsOnline); err != nil {
			continue
		}
		friends = append(friends, friend)
	}

	if friends == nil {
		friends = []models.FriendResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(friends))
}

// GetRequests godoc
// @Summary      Get incoming friend requests
// @Description  Get pending friend requests sent to the authenticated user
// @Tags         Friends
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends/requests [get]
// @Security     BearerAuth
func (h *FriendsHandler) GetRequests(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	rows, err := h.db.Query(`
		SELECT 
			fr.id,
			fr.sender_id,
			fr.receiver_id,
			fr.status,
			fr.created_at,
			p.username,
			p.avatar_url,
			p.display_name
		FROM friend_requests fr
		JOIN profiles p ON p.id = fr.sender_id
		WHERE fr.receiver_id = $1 AND fr.status = 'pending'
		ORDER BY fr.created_at DESC
	`, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	defer rows.Close()

	var requests []models.FriendRequestResponse
	for rows.Next() {
		var req models.FriendRequestResponse
		var createdAt time.Time
		if err := rows.Scan(&req.ID, &req.SenderID, &req.ReceiverID, &req.Status, &createdAt, &req.SenderUsername, &req.SenderAvatarURL, &req.SenderDisplayName); err != nil {
			continue
		}
		req.CreatedAt = createdAt.Format(time.RFC3339)
		requests = append(requests, req)
	}

	if requests == nil {
		requests = []models.FriendRequestResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(requests))
}

// GetFriendStatus godoc
// @Summary      Get friend status
// @Description  Get the friendship status with another user
// @Tags         Friends
// @Produce      json
// @Param        userId path string true "User ID"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /friends/status/{userId} [get]
// @Security     BearerAuth
func (h *FriendsHandler) GetFriendStatus(c *gin.Context) {
	claims := ensureAuth(c)
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

	// Check if friends
	var isFriend bool
	err := h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friendships 
			WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
		)
	`, claims.UserID, targetUserID).Scan(&isFriend)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	if isFriend {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"status": "friends"}))
		return
	}

	// Check for pending request sent by current user
	var outgoingPending bool
	err = h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friend_requests 
			WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
		)
	`, claims.UserID, targetUserID).Scan(&outgoingPending)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	if outgoingPending {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"status": "pending_sent"}))
		return
	}

	// Check for pending request received from target user
	var incomingPending bool
	err = h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friend_requests 
			WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
		)
	`, targetUserID, claims.UserID).Scan(&incomingPending)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
		return
	}
	if incomingPending {
		// Also return the request ID so the frontend can accept/reject
		var requestID string
		_ = h.db.QueryRow(`
			SELECT id FROM friend_requests 
			WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
		`, targetUserID, claims.UserID).Scan(&requestID)
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"status":     "pending_received",
			"request_id": requestID,
		}))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"status": "none"}))
}

// createFriendNotification sends a WebSocket notification for friend events.
func (h *FriendsHandler) createFriendNotification(userID, notifType, title, message string, relatedUserID *string) {
	if h.db == nil {
		return
	}
	_, err := CreateNotification(h.db, h.redis, h.hub, userID, notifType, title, message, nil, nil, relatedUserID)
	if err != nil {
		log.Printf("[Friends] Failed to create notification: %v", err)
	}
}

// getUsernameFromDB fetches a username by user ID.
func getUsernameFromDB(db *sql.DB, userID string) string {
	var username string
	err := db.QueryRow("SELECT username FROM profiles WHERE id = $1", userID).Scan(&username)
	if err != nil {
		return "unknown"
	}
	return username
}
