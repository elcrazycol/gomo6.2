package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/push"
)

// PushHandler manages Web Push subscriptions and per-type preferences for the
// authenticated user. It is deliberately thin — all logic lives in the push
// package (push.Service) so the same behavior is reused by the notification
// delivery path.
type PushHandler struct {
	srv *push.Service
}

func NewPushHandler(srv *push.Service) *PushHandler {
	return &PushHandler{srv: srv}
}

// NewPushService builds the push service from the DB (VAPID keys from env).
// Returns nil when VAPID keys are not configured.
func NewPushService(db *sql.DB) *push.Service {
	return push.New(db)
}

// currentUserID extracts the authenticated user ID from the request context.
func currentUserID(c *gin.Context) (string, bool) {
	claimsValue, exists := c.Get("claims")
	claims, ok := claimsValue.(*auth.Claims)
	if !exists || !ok || claims == nil {
		return "", false
	}
	return claims.UserID, true
}

// GetVAPIDPublicKey returns the public VAPID key the frontend passes to
// PushManager.subscribe. Public — the key is not secret.
func (h *PushHandler) GetVAPIDPublicKey(c *gin.Context) {
	if h.srv == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Push notifications are not configured"))
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"vapid_public_key": h.srv.PublicKey(),
		"available_types":  h.srv.NotificationTypes(),
	}))
}

// SubscribeRequest is the PushSubscription object from the browser.
type SubscribeRequest struct {
	Endpoint  string `json:"endpoint" binding:"required"`
	P256dh    string `json:"p256dh" binding:"required"`
	Auth      string `json:"auth" binding:"required"`
	UserAgent string `json:"user_agent"`
}

// Subscribe registers (or refreshes) the caller's push subscription.
func (h *PushHandler) Subscribe(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	if h.srv == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Push notifications are not configured"))
		return
	}

	var req SubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid subscription payload"))
		return
	}
	if req.Endpoint == "" || req.P256dh == "" || req.Auth == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("endpoint, p256dh and auth are required"))
		return
	}

	if err := h.srv.UpsertSubscription(c.Request.Context(), userID, req.Endpoint, req.P256dh, req.Auth, req.UserAgent); err != nil {
		serverError(c, "failed to save subscription", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"subscribed": true}))
}

// UnsubscribeRequest identifies which subscription to remove (by endpoint).
type UnsubscribeRequest struct {
	Endpoint string `json:"endpoint" binding:"required"`
}

// Unsubscribe removes a push subscription for the caller.
func (h *PushHandler) Unsubscribe(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	if h.srv == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Push notifications are not configured"))
		return
	}

	var req UnsubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Endpoint == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("endpoint is required"))
		return
	}

	if err := h.srv.DeleteSubscription(c.Request.Context(), userID, req.Endpoint); err != nil {
		serverError(c, "failed to remove subscription", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"unsubscribed": true}))
}

// GetPreferences returns the user's per-type push preference map plus the
// catalog of toggleable notification types.
func (h *PushHandler) GetPreferences(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	if h.srv == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Push notifications are not configured"))
		return
	}

	prefs, err := h.srv.Preferences(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "failed to load preferences", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"type_map":         prefs,
		"available_types":  h.srv.NotificationTypes(),
		"vapid_public_key": h.srv.PublicKey(),
	}))
}

// UpdatePreferencesRequest is the {type: bool} map of push preferences.
type UpdatePreferencesRequest struct {
	TypeMap map[string]bool `json:"type_map"`
}

// UpdatePreferences persists the user's per-type push preferences.
func (h *PushHandler) UpdatePreferences(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	if h.srv == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Push notifications are not configured"))
		return
	}

	var req UpdatePreferencesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid preferences payload"))
		return
	}
	if req.TypeMap == nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("type_map is required"))
		return
	}
	if err := h.srv.SetPreferences(c.Request.Context(), userID, req.TypeMap); err != nil {
		serverError(c, "failed to save preferences", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}
