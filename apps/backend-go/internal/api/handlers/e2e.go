package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// ─── E2E Key Management Handlers ─────────────────────────────────────────────

type E2EHandler struct {
	db *sql.DB
}

func NewE2EHandler(db *sql.DB) *E2EHandler {
	return &E2EHandler{db: db}
}

// ─── Register Device Keys ────────────────────────────────────────────────────

type RegisterKeysRequest struct {
	DeviceID              string     `json:"device_id" binding:"required"`
	PublicIdentityKey     string     `json:"public_identity_key" binding:"required"`
	PublicSignedPreKey    string     `json:"public_signed_pre_key" binding:"required"`
	SignedPreKeySignature string     `json:"signed_pre_key_signature" binding:"required"`
	OneTimePreKeys        []OPKInput `json:"one_time_pre_keys" binding:"required,min=1"`
}

type OPKInput struct {
	ID        string `json:"id" binding:"required"`
	PublicKey string `json:"public_key" binding:"required"`
}

func (h *E2EHandler) RegisterKeys(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var req RegisterKeysRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		serverError(c, "begin tx", err)
		return
	}
	defer tx.Rollback()

	// Upsert device
	var deviceID string
	err = tx.QueryRow(`
		INSERT INTO e2e_devices (user_id, device_id, public_identity_key, public_signed_pre_key, signed_pre_key_signature)
		VALUES ($1, $2, decode($3, 'base64'), decode($4, 'base64'), decode($5, 'base64'))
		ON CONFLICT (user_id, device_id) DO UPDATE SET
			public_identity_key = EXCLUDED.public_identity_key,
			public_signed_pre_key = EXCLUDED.public_signed_pre_key,
			signed_pre_key_signature = EXCLUDED.signed_pre_key_signature,
			updated_at = now()
		RETURNING id
	`, claims.UserID, req.DeviceID, req.PublicIdentityKey, req.PublicSignedPreKey, req.SignedPreKeySignature).Scan(&deviceID)
	if err != nil {
		serverError(c, "upsert device", err)
		return
	}

	// Insert one-time pre-keys
	for _, opk := range req.OneTimePreKeys {
		_, err = tx.Exec(`
			INSERT INTO e2e_one_time_pre_keys (device_id, public_key)
			VALUES ($1, decode($2, 'base64'))
			ON CONFLICT (device_id, public_key) DO NOTHING
		`, deviceID, opk.PublicKey)
		if err != nil {
			serverError(c, "insert opk", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		serverError(c, "commit tx", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"success":         true,
		"registered_keys": len(req.OneTimePreKeys),
	}))
}

// ─── Fetch User's Key Bundle ────────────────────────────────────────────────

type DeviceKeyBundle struct {
	DeviceID              string `json:"device_id"`
	PublicIdentityKey     string `json:"public_identity_key"`
	PublicSignedPreKey    string `json:"public_signed_pre_key"`
	SignedPreKeySignature string `json:"signed_pre_key_signature"`
	OneTimePreKey         *OPK   `json:"one_time_pre_key"`
}

type OPK struct {
	ID        string `json:"id"`
	PublicKey string `json:"public_key"`
}

func (h *E2EHandler) FetchKeyBundle(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	userID := c.Param("userId")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("userId is required"))
		return
	}

	rows, err := h.db.Query(`
		SELECT
			d.device_id,
			encode(d.public_identity_key, 'base64') AS pub_ik,
			encode(d.public_signed_pre_key, 'base64') AS pub_spk,
			encode(d.signed_pre_key_signature, 'base64') AS spk_sig,
			opk.id AS opk_id,
			encode(opk.public_key, 'base64') AS opk_pub
		FROM e2e_devices d
		LEFT JOIN LATERAL (
			SELECT id, public_key
			FROM e2e_one_time_pre_keys
			WHERE device_id = d.id AND consumed_at IS NULL
			LIMIT 1
		) opk ON true
		WHERE d.user_id = $1
		ORDER BY d.created_at ASC
	`, userID)
	if err != nil {
		serverError(c, "fetch key bundle", err)
		return
	}
	defer rows.Close()

	devices := []DeviceKeyBundle{}
	for rows.Next() {
		var d DeviceKeyBundle
		var opkID, opkPub sql.NullString
		if err := rows.Scan(&d.DeviceID, &d.PublicIdentityKey, &d.PublicSignedPreKey, &d.SignedPreKeySignature, &opkID, &opkPub); err != nil {
			serverError(c, "scan device", err)
			return
		}
		if opkID.Valid && opkPub.Valid {
			d.OneTimePreKey = &OPK{ID: opkID.String, PublicKey: opkPub.String}
		}
		devices = append(devices, d)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"devices": devices}))
}

// ─── Consume One-Time Pre-Key ───────────────────────────────────────────────

type ConsumePreKeyRequest struct {
	PreKeyID string `json:"prekey_id" binding:"required"`
}

func (h *E2EHandler) ConsumePreKey(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var req ConsumePreKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	result, err := h.db.Exec(`
		UPDATE e2e_one_time_pre_keys
		SET consumed_at = now()
		WHERE id = $1 AND consumed_at IS NULL
	`, req.PreKeyID)
	if err != nil {
		serverError(c, "consume prekey", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Pre-key not found or already consumed"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"success": true}))
}

// ─── Upload New One-Time Pre-Keys ──────────────────────────────────────────

type UploadPreKeysRequest struct {
	PreKeys []OPKInput `json:"prekeys" binding:"required,min=1"`
}

func (h *E2EHandler) UploadPreKeys(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var req UploadPreKeysRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Find user's device (use first device or require device_id)
	var deviceID string
	err := h.db.QueryRow(`
		SELECT id FROM e2e_devices WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1
	`, claims.UserID).Scan(&deviceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No registered device found. Call POST /e2e/keys first."))
		return
	}

	inserted := 0
	for _, opk := range req.PreKeys {
		result, err := h.db.Exec(`
			INSERT INTO e2e_one_time_pre_keys (device_id, public_key)
			VALUES ($1, decode($2, 'base64'))
			ON CONFLICT (device_id, public_key) DO NOTHING
		`, deviceID, opk.PublicKey)
		if err != nil {
			continue
		}
		n, _ := result.RowsAffected()
		inserted += int(n)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"success": true,
		"count":   inserted,
	}))
}

// ─── List User's Devices ────────────────────────────────────────────────────

func (h *E2EHandler) ListDevices(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	rows, err := h.db.Query(`
		SELECT device_id, created_at, updated_at
		FROM e2e_devices
		WHERE user_id = $1
		ORDER BY created_at ASC
	`, claims.UserID)
	if err != nil {
		serverError(c, "list devices", err)
		return
	}
	defer rows.Close()

	type DeviceInfo struct {
		DeviceID  string `json:"device_id"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}

	devices := []DeviceInfo{}
	for rows.Next() {
		var d DeviceInfo
		if err := rows.Scan(&d.DeviceID, &d.CreatedAt, &d.UpdatedAt); err != nil {
			serverError(c, "scan device", err)
			return
		}
		devices = append(devices, d)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"devices": devices}))
}

// ─── Delete Device ──────────────────────────────────────────────────────────

func (h *E2EHandler) DeleteDevice(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	deviceID := c.Param("deviceId")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("deviceId is required"))
		return
	}

	result, err := h.db.Exec(`
		DELETE FROM e2e_devices
		WHERE user_id = $1 AND device_id = $2
	`, claims.UserID, deviceID)
	if err != nil {
		serverError(c, "delete device", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Device not found"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"success": true}))
}
