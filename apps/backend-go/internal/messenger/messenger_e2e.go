package messenger

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

// ─── E2E envelope ─────────────────────────────────────────────────────────────
// Wire format (opaque to the server): `e2e1:<alg>:<base64(iv || ciphertext)>`.
// The conversation id + sender id are bound as AAD on the client, so the
// server only checks the shape here and never attempts to decrypt.

// parseE2EEnvelope splits an `e2e1:<alg>:<b64>` payload into its algorithm and
// body. Returns ok=false when the shape is wrong.
func parseE2EEnvelope(content string) (alg, body string, ok bool) {
	if !strings.HasPrefix(content, e2eContentMarker) {
		return "", "", false
	}
	rest := strings.TrimPrefix(content, e2eContentMarker)
	alg, body, found := strings.Cut(rest, ":")
	if !found || alg == "" || body == "" {
		return "", "", false
	}
	if alg != e2eAlgP256AESGCM {
		return "", "", false
	}
	return alg, body, true
}

// validateE2EPayload checks the shape + size of an opaque E2E blob.
func validateE2EPayload(content string) error {
	alg, body, ok := parseE2EEnvelope(content)
	if !ok || alg == "" || body == "" {
		return errInvalidE2EPayload
	}
	if len(content) > maxE2EContentLen {
		return errE2EPayloadTooLarge
	}
	return nil
}

// isE2EConversation reports whether the conversation uses client-side E2E
// (encryption_mode = 'e2e'). A nonexistent conversation is treated as regular —
// the caller's membership check rejects it next.
func (h *MessengerHandler) isE2EConversation(c *gin.Context, conversationID string) (bool, error) {
	var mode sql.NullString
	err := h.dbFor(c).QueryRow(
		"SELECT encryption_mode FROM chat_conversations WHERE id = $1",
		conversationID,
	).Scan(&mode)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return mode.Valid && mode.String == encryptionModeE2E, nil
}

// ─── Device key directory ────────────────────────────────────────────────────
// Public identity keys for E2E handshakes. Private keys never leave the device.

// DeviceKeyResponse is one public identity key.
type DeviceKeyResponse struct {
	UserID    string `json:"user_id"`
	DeviceID  string `json:"device_id"`
	PublicKey string `json:"public_key"`
	Alg       string `json:"alg"`
	UpdatedAt string `json:"updated_at"`
}

// PutDeviceKeyRequest is the PUT body for publishing a device public key.
type PutDeviceKeyRequest struct {
	DeviceID  string `json:"device_id" binding:"required,min=1,max=128"`
	PublicKey string `json:"public_key" binding:"required,min=32,max=4096"`
	Alg       string `json:"alg" binding:"omitempty,oneof=p256-aesgcm"`
}

// UpdateEncryptionModeRequest toggles a 1:1 conversation between server-side
// and client-side E2E encryption.
type UpdateEncryptionModeRequest struct {
	Mode string `json:"mode" binding:"required,oneof=server e2e"`
}

var (
	errInvalidE2EPayload  = errMsg("Invalid E2E payload")
	errE2EPayloadTooLarge = errMsg("E2E payload too large")
)

type errMsg string

func (e errMsg) Error() string { return string(e) }

// validateDeviceKey checks shape constraints not covered by binding tags.
func validateDeviceKey(deviceID, publicKey string) error {
	if strings.TrimSpace(deviceID) == "" || strings.TrimSpace(publicKey) == "" {
		return errMsg("device_id and public_key are required")
	}
	if strings.ContainsAny(deviceID, " \t\n\r") {
		return errMsg("invalid device_id")
	}
	return nil
}

// PutDeviceKey publishes (upserts) the caller's device public key.
// PUT /api/v1/messenger/keys
func (h *MessengerHandler) PutDeviceKey(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	var req PutDeviceKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("device_id and public_key are required"))
		return
	}
	req.DeviceID = strings.TrimSpace(req.DeviceID)
	req.PublicKey = strings.TrimSpace(req.PublicKey)
	if err := validateDeviceKey(req.DeviceID, req.PublicKey); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	alg := req.Alg
	if alg == "" {
		alg = e2eAlgP256AESGCM
	}
	var updatedAt string
	err := h.dbFor(c).QueryRow(`
		INSERT INTO messenger_device_keys (user_id, device_id, public_key, alg, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, device_id)
		DO UPDATE SET public_key = EXCLUDED.public_key, alg = EXCLUDED.alg, updated_at = NOW()
		RETURNING updated_at
	`, claims.UserID, req.DeviceID, req.PublicKey, alg).Scan(&updatedAt)
	if err != nil {
		httpx.ServerError(c, "put device key", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(DeviceKeyResponse{
		UserID:    claims.UserID,
		DeviceID:  req.DeviceID,
		PublicKey: req.PublicKey,
		Alg:       alg,
		UpdatedAt: updatedAt,
	}))
}

// ListMyKeys returns the caller's own published device keys.
// GET /api/v1/messenger/keys
func (h *MessengerHandler) ListMyKeys(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	keys, err := h.listDeviceKeys(c, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "list device keys", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(keys))
}

// GetUserKeys returns the public device keys of another user (handshake).
// GET /api/v1/messenger/users/:userId/keys
func (h *MessengerHandler) GetUserKeys(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	userID := c.Param("userId")
	if !isUUID(userID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	keys, err := h.listDeviceKeys(c, userID)
	if err != nil {
		httpx.ServerError(c, "get user keys", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(keys))
}

// DeleteDeviceKey removes one of the caller's device keys.
// DELETE /api/v1/messenger/keys/:deviceId
func (h *MessengerHandler) DeleteDeviceKey(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	deviceID := c.Param("deviceId")
	if strings.TrimSpace(deviceID) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid device_id"))
		return
	}
	result, err := h.dbFor(c).Exec(
		`DELETE FROM messenger_device_keys WHERE user_id = $1 AND device_id = $2`,
		claims.UserID, deviceID,
	)
	if err != nil {
		httpx.ServerError(c, "delete device key", err)
		return
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Device key not found"))
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}

// listDeviceKeys reads public keys for a user, newest first.
func (h *MessengerHandler) listDeviceKeys(c *gin.Context, userID string) ([]DeviceKeyResponse, error) {
	rows, err := h.dbFor(c).Query(`
		SELECT user_id, device_id, public_key, alg, updated_at
		FROM messenger_device_keys
		WHERE user_id = $1
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []DeviceKeyResponse{}
	for rows.Next() {
		var k DeviceKeyResponse
		if err := rows.Scan(&k.UserID, &k.DeviceID, &k.PublicKey, &k.Alg, &k.UpdatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return keys, nil
}

// UpdateEncryptionMode switches a 1:1 conversation between server-side and
// client-side E2E encryption. Groups, notes self-chats and service threads
// are rejected: E2E is a 1:1-only mode in this contract.
// POST /api/v1/messenger/conversations/:id/encryption
func (h *MessengerHandler) UpdateEncryptionMode(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}
	conversationID := c.Param("id")
	if !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}
	var req UpdateEncryptionModeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("mode must be 'server' or 'e2e'"))
		return
	}
	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}
	var isGroup, isNotes, isService bool
	if err := h.dbFor(c).QueryRow(
		`SELECT COALESCE(is_group, false), COALESCE(is_notes, false), COALESCE(is_service, false)
		 FROM chat_conversations WHERE id = $1`,
		conversationID,
	).Scan(&isGroup, &isNotes, &isService); err != nil {
		httpx.ServerError(c, "check conversation kind", err)
		return
	}
	if isGroup || isNotes || isService {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("E2E is only available for 1:1 conversations"))
		return
	}
	if _, err := h.dbFor(c).Exec(
		`UPDATE chat_conversations SET encryption_mode = $2, updated_at = NOW() WHERE id = $1`,
		conversationID, req.Mode,
	); err != nil {
		httpx.ServerError(c, "update encryption mode", err)
		return
	}
	queueAfterCommit(c, func() {
		if h.hub == nil {
			return
		}
		payload := map[string]interface{}{
			"conversation_id": conversationID,
			"encryption_mode": req.Mode,
			"event":           "conversation_updated",
		}
		if memberIDs := h.listConversationMemberIDs(conversationID); len(memberIDs) > 0 {
			payload["recipient_ids"] = memberIDs
		}
		_ = h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
			Type:    "conversation_updated",
			Payload: payload,
		})
	})
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"encryption_mode": req.Mode}))
}
