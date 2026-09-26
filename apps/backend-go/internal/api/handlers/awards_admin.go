package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/notifications"
	stor "github.com/gomo6/backend/internal/storage"
	"github.com/google/uuid"
)

// awardsBucket is the public storage bucket holding award artwork. It is
// admin-curated and served without auth (like gift-layers/gamification).
const awardsBucket = "awards"

// maxAwardImageBytes bounds an award image upload.
const maxAwardImageBytes = 5 * 1024 * 1024

// awardKeyRe is the slug shape of a hand-granted award key.
var awardKeyRe = regexp.MustCompile(`^[a-z0-9_]{2,64}$`)

// AwardsAdminHandler manages hand-granted awards: the catalog entries
// (create/edit/delete/artwork) and the grants themselves (grant/revoke).
// Hand-granted awards are prestige marks, so every mutation is staff-gated
// (moderator or admin) and grant/revoke additionally notify the recipient.
type AwardsAdminHandler struct {
	db      *sql.DB
	storage *stor.StorageClient
	notif   *notifications.Service
}

// NewAwardsAdminHandler wires the handler. storage and notif may be nil
// (degraded deployments); artwork upload and notifications are skipped then.
func NewAwardsAdminHandler(db *sql.DB, storage *stor.StorageClient, notif *notifications.Service) *AwardsAdminHandler {
	return &AwardsAdminHandler{db: db, storage: storage, notif: notif}
}

// isStaff reports whether the user holds the platform moderator or admin role.
func (h *AwardsAdminHandler) isStaff(userID string) bool {
	if userID == "" {
		return false
	}
	var count int
	if err := h.db.QueryRow(
		`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role IN ('moderator', 'admin')`,
		userID).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

// requireStaff authenticates the caller and checks the staff role. It writes the
// error response and returns "" when the caller may not proceed.
func (h *AwardsAdminHandler) requireStaff(c *gin.Context) string {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return ""
	}
	if !h.isStaff(claims.UserID) {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Staff access required"))
		return ""
	}
	return claims.UserID
}

// CreateAward — POST /api/v1/admin/awards
// Creates a hand-granted award (origin=admin) that becomes a permanent part of
// the catalog. Title/description are literal text (not i18n keys).
func (h *AwardsAdminHandler) CreateAward(c *gin.Context) {
	staffID := h.requireStaff(c)
	if staffID == "" {
		return
	}

	var req struct {
		Key         string `json:"key"`
		Title       string `json:"title" binding:"required"`
		Description string `json:"description"`
		Icon        string `json:"icon"`
		ImageURL    string `json:"image_url"`
		SortOrder   *int   `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	key := strings.TrimSpace(req.Key)
	if key == "" {
		key = "custom_" + randomHex(4)
	}
	if !awardKeyRe.MatchString(key) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("key must match [a-z0-9_]{2,64}"))
		return
	}
	if req.Icon == "" {
		req.Icon = "trophy"
	}
	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}

	var (
		id, title, description, icon, imageURL string
		order                                  int
	)
	err := h.db.QueryRow(`
INSERT INTO achievements (id, group_key, name, title, description, category, icon,
                          achievement_type, kind, origin, image_url, hidden, sort_order,
                          levels, definition_hash, updated_at)
VALUES ($1, $2, $3::text, $3::text, $4, 'awards', $5, 'award', 'award', 'admin', $6, FALSE, $7,
        '[]'::jsonb, '', NOW())
RETURNING id, group_key, title, description, icon, image_url, sort_order`,
		achievements.GroupID(key), key, req.Title, req.Description, req.Icon, req.ImageURL, sortOrder,
	).Scan(&id, &key, &title, &description, &icon, &imageURL, &order)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{
		"id": id, "key": key, "title": title, "description": description,
		"icon": icon, "image_url": imageURL, "sort_order": order, "origin": "admin",
	}))
}

// UpdateAward — PATCH /api/v1/admin/awards (body key)
// Edits an admin-created award. Code awards come from the Go catalog and cannot
// be edited here (the sync would overwrite them anyway).
func (h *AwardsAdminHandler) UpdateAward(c *gin.Context) {
	if h.requireStaff(c) == "" {
		return
	}

	var req struct {
		Key         string  `json:"key" binding:"required"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Icon        *string `json:"icon"`
		ImageURL    *string `json:"image_url"`
		SortOrder   *int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	key := req.Key

	var exists bool
	if err := h.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM achievements WHERE group_key = $1 AND origin = 'admin')`, key,
	).Scan(&exists); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Award not found or not editable"))
		return
	}

	query := "UPDATE achievements SET updated_at = NOW()"
	var args []interface{}
	argIndex := 1
	add := func(column string, value interface{}) {
		query += ", " + column + " = $" + strconv.Itoa(argIndex)
		args = append(args, value)
		argIndex++
	}
	if req.Title != nil {
		add("title", *req.Title)
		add("name", *req.Title)
	}
	if req.Description != nil {
		add("description", *req.Description)
	}
	if req.Icon != nil {
		add("icon", *req.Icon)
	}
	if req.ImageURL != nil {
		add("image_url", *req.ImageURL)
	}
	if req.SortOrder != nil {
		add("sort_order", *req.SortOrder)
	}
	query += " WHERE group_key = $" + strconv.Itoa(argIndex) + " AND origin = 'admin'"
	args = append(args, key)

	if _, err := h.db.Exec(query, args...); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// DeleteAward — DELETE /api/v1/admin/awards?key=<key>
// Deletes an admin-created award, but only while it has no grants (so history
// is never orphaned). Code awards cannot be deleted here.
func (h *AwardsAdminHandler) DeleteAward(c *gin.Context) {
	if h.requireStaff(c) == "" {
		return
	}
	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("key is required"))
		return
	}

	var grants int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM user_awards WHERE award_key = $1`, key).Scan(&grants); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if grants > 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(
			fmt.Sprintf("Award already granted to %d user(s); revoke the grants first", grants)))
		return
	}

	res, err := h.db.Exec(`DELETE FROM achievements WHERE group_key = $1 AND origin = 'admin'`, key)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Award not found or not deletable"))
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// GrantAward — POST /api/v1/admin/awards/grant
// Grants an award to a user. Repeatable (each grant is its own history row).
// The recipient is notified after the row is committed.
func (h *AwardsAdminHandler) GrantAward(c *gin.Context) {
	staffID := h.requireStaff(c)
	if staffID == "" {
		return
	}

	var req struct {
		UserID   string `json:"user_id" binding:"required"`
		AwardKey string `json:"award_key" binding:"required"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	var kind string
	if err := h.db.QueryRow(`SELECT kind FROM achievements WHERE group_key = $1`, req.AwardKey).Scan(&kind); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Award not found"))
			return
		}
		httpx.ServerError(c, "handler error", err)
		return
	}
	if kind != string(achievements.KindAward) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Not a hand-granted award"))
		return
	}

	var grantID string
	if err := h.db.QueryRow(`
INSERT INTO user_awards (user_id, award_key, awarded_by, reason)
VALUES ($1, $2, $3, $4) RETURNING id`,
		req.UserID, req.AwardKey, staffID, req.Reason,
	).Scan(&grantID); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	// Notify after a successful commit — never before, so a failed insert
	// cannot produce a phantom notification.
	h.notify(req.UserID, "award_granted", &models.NotificationParams{
		AwardKey: req.AwardKey,
		Reason:   req.Reason,
		Actor:    h.username(staffID),
	})

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{"id": grantID}))
}

// RevokeAward — POST /api/v1/admin/awards/revoke
// Revokes an active grant (soft, with history). Notifies the recipient.
func (h *AwardsAdminHandler) RevokeAward(c *gin.Context) {
	staffID := h.requireStaff(c)
	if staffID == "" {
		return
	}

	var req struct {
		ID     string `json:"id" binding:"required"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	var (
		userID   string
		awardKey string
	)
	err := h.db.QueryRow(`
UPDATE user_awards
SET revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
WHERE id = $1 AND revoked_at IS NULL
RETURNING user_id, award_key`, req.ID, staffID, req.Reason).Scan(&userID, &awardKey)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Active grant not found"))
			return
		}
		httpx.ServerError(c, "handler error", err)
		return
	}

	h.notify(userID, "award_revoked", &models.NotificationParams{
		AwardKey: awardKey,
		Reason:   req.Reason,
		Actor:    h.username(staffID),
	})

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// UploadAwardImage — POST /api/v1/admin/awards/image (multipart: key, file)
// Uploads award artwork under a unique key (<uuid>) so replacing the art of an
// existing award is never served stale from a browser cache.
func (h *AwardsAdminHandler) UploadAwardImage(c *gin.Context) {
	if h.requireStaff(c) == "" {
		return
	}
	key := strings.TrimSpace(c.PostForm("key"))
	if key == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("key is required"))
		return
	}
	if h.storage == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Storage unavailable"))
		return
	}

	var levelsCount int
	qerr := h.db.QueryRow(
		`SELECT COALESCE(jsonb_array_length(levels), 0) FROM achievements WHERE group_key = $1`, key,
	).Scan(&levelsCount)
	if qerr != nil {
		if qerr == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Achievement not found"))
			return
		}
		httpx.ServerError(c, "handler error", qerr)
		return
	}

	// Optional level for multi-level milestones: each level gets its own trophy.
	level := 0
	if raw := strings.TrimSpace(c.PostForm("level")); raw != "" {
		n, convErr := strconv.Atoi(raw)
		if convErr != nil || n < 1 || levelsCount == 0 || n > levelsCount {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("invalid level"))
			return
		}
		level = n
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("no file provided"))
		return
	}
	defer file.Close()
	if header.Size > maxAwardImageBytes {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("file too large (max 5MB)"))
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	contentType, ok := imageContentType(ext)
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("unsupported image type: "+ext))
		return
	}

	data := make([]byte, 0, header.Size)
	buf := make([]byte, 32*1024)
	for {
		n, rerr := file.Read(buf)
		if n > 0 {
			data = append(data, buf[:n]...)
			if len(data) > maxAwardImageBytes {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("file too large (max 5MB)"))
				return
			}
		}
		if rerr != nil {
			break
		}
	}

	objectKey := fmt.Sprintf("awards/%s/%s%s", key, uuid.NewString(), ext)
	if _, err := h.storage.UploadFile(awardsBucket, objectKey, data, contentType); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	imageURL := "/storage/v1/object/" + awardsBucket + "/" + objectKey

	if level > 0 {
		if _, err := h.db.Exec(
			`UPDATE achievements SET level_images = jsonb_set(level_images, ARRAY[$2::text], to_jsonb($3::text), true), updated_at = NOW() WHERE group_key = $1`,
			key, strconv.Itoa(level), imageURL); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
	} else {
		if _, err := h.db.Exec(
			`UPDATE achievements SET image_url = $2, updated_at = NOW() WHERE group_key = $1`,
			key, imageURL); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"image_url": imageURL, "level": level}))
}

// ListAwardGrants — GET /api/v1/admin/awards/grants?award_key=&user_id=&include_revoked=1
// Lists grants (active by default) with the recipient's handle, for the admin
// panel's grant/revoke view.
func (h *AwardsAdminHandler) ListAwardGrants(c *gin.Context) {
	if h.requireStaff(c) == "" {
		return
	}
	awardKey := c.Query("award_key")
	userID := c.Query("user_id")
	includeRevoked := c.Query("include_revoked") == "1"
	limit := 100
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}

	query := `
SELECT ua.id, ua.user_id, COALESCE(u.username, ''), ua.award_key, ua.reason,
       ua.awarded_at, ua.revoked_at, ua.revoke_reason
FROM user_awards ua
LEFT JOIN users u ON u.id = ua.user_id
WHERE 1=1`
	var args []interface{}
	argIndex := 1
	if !includeRevoked {
		query += " AND ua.revoked_at IS NULL"
	}
	if awardKey != "" {
		query += " AND ua.award_key = $" + strconv.Itoa(argIndex)
		args = append(args, awardKey)
		argIndex++
	}
	if userID != "" {
		query += " AND ua.user_id = $" + strconv.Itoa(argIndex)
		args = append(args, userID)
		argIndex++
	}
	query += " ORDER BY ua.awarded_at DESC LIMIT $" + strconv.Itoa(argIndex)
	args = append(args, limit)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	type grant struct {
		ID           string  `json:"id"`
		UserID       string  `json:"user_id"`
		Username     string  `json:"username"`
		AwardKey     string  `json:"award_key"`
		Reason       string  `json:"reason"`
		AwardedAt    string  `json:"awarded_at"`
		RevokedAt    *string `json:"revoked_at,omitempty"`
		RevokeReason string  `json:"revoke_reason,omitempty"`
	}
	var out []grant
	for rows.Next() {
		var g grant
		var awardedAt time.Time
		var revokedAt sql.NullTime
		if err := rows.Scan(&g.ID, &g.UserID, &g.Username, &g.AwardKey, &g.Reason,
			&awardedAt, &revokedAt, &g.RevokeReason); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		g.AwardedAt = awardedAt.UTC().Format(time.RFC3339)
		if revokedAt.Valid {
			s := revokedAt.Time.UTC().Format(time.RFC3339)
			g.RevokedAt = &s
		}
		out = append(out, g)
	}
	if out == nil {
		out = []grant{}
	}
	c.JSON(http.StatusOK, models.SuccessResponse(out))
}

// notify sends an in-app notification (no toast), best-effort.
func (h *AwardsAdminHandler) notify(userID, notifType string, params *models.NotificationParams) {
	if h.notif == nil || userID == "" {
		return
	}
	if _, err := h.notif.CreateNotification(notifications.CreateParams{
		RecipientID: userID,
		Type:        notifType,
		Params:      params,
	}); err != nil {
		// The grant is already committed; a failed notification must not fail
		// the request nor roll anything back.
		_ = err
	}
}

// username resolves a user's display handle for notification params.
func (h *AwardsAdminHandler) username(userID string) string {
	var name string
	_ = h.db.QueryRow(`SELECT username FROM users WHERE id = $1`, userID).Scan(&name)
	return name
}

// imageContentType maps an image extension to a server-derived content type.
func imageContentType(ext string) (string, bool) {
	switch ext {
	case ".png":
		return "image/png", true
	case ".jpg", ".jpeg":
		return "image/jpeg", true
	case ".webp":
		return "image/webp", true
	case ".gif":
		return "image/gif", true
	default:
		return "", false
	}
}
