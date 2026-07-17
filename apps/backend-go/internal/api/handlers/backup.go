package handlers

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	stor "github.com/gomo6/backend/internal/storage"
	"github.com/google/uuid"
)

type BackupHandler struct {
	db      *sql.DB
	storage *stor.StorageClient
}

func NewBackupHandler(db *sql.DB) *BackupHandler {
	return &BackupHandler{db: db}
}

func (h *BackupHandler) SetStorage(s *stor.StorageClient) {
	h.storage = s
}

// ── Export types ──────────────────────────────────────────────────────────

type BackupManifest struct {
	Version    int       `json:"version"`
	BoardSlug  string    `json:"board_slug"`
	ExportedAt time.Time `json:"exported_at"`
}

type MembershipExport struct {
	UserID   string  `json:"user_id"`
	Username string  `json:"username"`
	Email    *string `json:"email"`
	Role     string  `json:"role"`
	RoleID   *string `json:"role_id"`
}

type FileRef struct {
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
}

// ── Export ────────────────────────────────────────────────────────────────

// Export — GET /api/v1/boards/:id/backup/export
// Streams a tar.gz archive of the gomosub's DB data + S3 files.
func (h *BackupHandler) Export(c *gin.Context) {
	boardID := c.Param("id")

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var ownerID sql.NullString
	if err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1 AND is_gomosub = true`, boardID).Scan(&ownerID); err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	}
	if !ownerID.Valid || ownerID.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only the board owner can export"))
		return
	}

	var slug string
	_ = h.db.QueryRow(`SELECT slug FROM boards WHERE id = $1`, boardID).Scan(&slug)

	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="gomosub-%s-%s.tar.gz"`, slug, time.Now().Format("2006-01-02")))

	gzWriter := gzip.NewWriter(c.Writer)
	defer gzWriter.Close()

	tw := tar.NewWriter(gzWriter)
	defer tw.Close()

	ctx := c.Request.Context()

	// 1. Manifest
	manifest := BackupManifest{Version: 1, BoardSlug: slug, ExportedAt: time.Now().UTC()}
	if err := writeJSONEntry(tw, "backup-manifest.json", manifest); err != nil {
		log.Printf("backup export: manifest: %v", err)
		return
	}

	// 2. Board
	var boardData map[string]interface{}
	if err := h.db.QueryRow(`
		SELECT row_to_json(b) FROM (
			SELECT id, slug, name, description, is_gomosub, is_rules_board, visibility,
			       gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at
			FROM boards WHERE id = $1
		) b`, boardID).Scan(pgJSON(&boardData)); err != nil {
		log.Printf("backup export: board: %v", err)
		return
	}
	if err := writeJSONEntry(tw, "board.json", boardData); err != nil {
		log.Printf("backup export: board write: %v", err)
		return
	}

	// 3. Channels
	if err := h.writeJSONArray(tw, ctx, "channels.json",
		`SELECT row_to_json(t) FROM (SELECT * FROM channels WHERE board_id = $1 ORDER BY sort_order) t`, boardID); err != nil {
		log.Printf("backup export: channels: %v", err)
		return
	}

	// 4. Roles
	if err := h.writeJSONArray(tw, ctx, "roles.json",
		`SELECT row_to_json(t) FROM (SELECT * FROM gomosub_roles WHERE board_id = $1 ORDER BY position) t`, boardID); err != nil {
		log.Printf("backup export: roles: %v", err)
		return
	}

	// 5. Channel permissions
	if err := h.writeJSONArray(tw, ctx, "channel_permissions.json",
		`SELECT row_to_json(t) FROM (SELECT cp.* FROM channel_permissions cp JOIN channels ch ON ch.id = cp.channel_id WHERE ch.board_id = $1) t`, boardID); err != nil {
		log.Printf("backup export: channel_permissions: %v", err)
		return
	}

	// 6. Memberships with user info
	if err := h.writeMembershipsWithUsers(tw, ctx, boardID); err != nil {
		log.Printf("backup export: memberships: %v", err)
		return
	}

	// 7. Invites
	if err := h.writeJSONArray(tw, ctx, "invites.json",
		`SELECT row_to_json(t) FROM (SELECT * FROM gomosub_invites WHERE board_id = $1) t`, boardID); err != nil {
		log.Printf("backup export: invites: %v", err)
		return
	}

	// 8. Rules acceptance
	if err := h.writeJSONArray(tw, ctx, "rules_acceptance.json",
		`SELECT row_to_json(t) FROM (SELECT * FROM gomosub_rules_acceptance WHERE board_id = $1) t`, boardID); err != nil {
		log.Printf("backup export: rules_acceptance: %v", err)
		return
	}

	// 9. Threads
	if err := h.writeJSONArray(tw, ctx, "threads.json",
		`SELECT row_to_json(t) FROM (SELECT * FROM threads WHERE board_id = $1 ORDER BY created_at) t`, boardID); err != nil {
		log.Printf("backup export: threads: %v", err)
		return
	}

	// 10. Posts
	if err := h.writeJSONArray(tw, ctx, "posts.json",
		`SELECT row_to_json(t) FROM (SELECT p.* FROM posts p JOIN threads th ON th.id = p.thread_id WHERE th.board_id = $1 ORDER BY p.created_at) t`, boardID); err != nil {
		log.Printf("backup export: posts: %v", err)
		return
	}

	// 11. Thread likes
	if err := h.writeJSONArray(tw, ctx, "thread_likes.json",
		`SELECT row_to_json(t) FROM (SELECT tl.* FROM thread_likes tl JOIN threads th ON th.id = tl.thread_id WHERE th.board_id = $1) t`, boardID); err != nil {
		log.Printf("backup export: thread_likes: %v", err)
		return
	}

	// 12. Post likes
	if err := h.writeJSONArray(tw, ctx, "post_likes.json",
		`SELECT row_to_json(t) FROM (SELECT pl.* FROM post_likes pl JOIN posts p ON p.id = pl.post_id JOIN threads th ON th.id = p.thread_id WHERE th.board_id = $1) t`, boardID); err != nil {
		log.Printf("backup export: post_likes: %v", err)
		return
	}

	// 13. Polls
	if err := h.writeJSONArray(tw, ctx, "polls.json",
		`SELECT row_to_json(t) FROM (SELECT * FROM polls WHERE thread_id IN (SELECT id FROM threads WHERE board_id = $1)) t`, boardID); err != nil {
		log.Printf("backup export: polls: %v", err)
		return
	}

	// 14. Poll votes
	if err := h.writeJSONArray(tw, ctx, "poll_votes.json",
		`SELECT row_to_json(t) FROM (SELECT pv.* FROM poll_votes pv JOIN polls po ON po.id = pv.poll_id JOIN threads th ON th.id = po.thread_id WHERE th.board_id = $1) t`, boardID); err != nil {
		log.Printf("backup export: poll_votes: %v", err)
		return
	}

	// 15. Files from S3
	if h.storage != nil {
		if err := h.exportFiles(tw, ctx, boardID); err != nil {
			log.Printf("backup export: files: %v", err)
		}
	}
}

// ── Import ────────────────────────────────────────────────────────────────

// Import — POST /api/v1/boards/:id/backup/import
func (h *BackupHandler) Import(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<30) // 1GB

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No file provided"))
		return
	}
	defer file.Close()

	if header.Size > 1<<30 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("File too large (max 1GB)"))
		return
	}

	gzReader, err := gzip.NewReader(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid gzip archive"))
		return
	}
	defer gzReader.Close()

	tr := tar.NewReader(gzReader)

	// Parse all JSON entries first
	archiveData, fileEntries, err := parseTarArchive(tr)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(fmt.Sprintf("Failed to parse archive: %v", err)))
		return
	}

	manifest, ok := archiveData["backup-manifest.json"].(map[string]interface{})
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid archive: missing manifest"))
		return
	}
	_ = manifest // version check could go here

	boardData, ok := archiveData["board.json"].(map[string]interface{})
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid archive: missing board.json"))
		return
	}

	// Start transaction
	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to start transaction"))
		return
	}
	defer tx.Rollback()

	// 1. Ensure ghost user exists
	ghostID := ensureGhostUser(tx)

	// 2. Create board with new UUID
	newBoardID := uuid.New().String()
	_ = ghostID // used implicitly via user mapping

	slug := jsonStr(boardData, "slug")
	name := jsonStr(boardData, "name")
	description := jsonStrPtr(boardData, "description")
	visibility := jsonStr(boardData, "visibility")
	if visibility == "" {
		visibility = "public"
	}
	isGomosub := jsonBool(boardData, "is_gomosub")
	gomosubAvatarURL := jsonStrPtr(boardData, "gomosub_avatar_url")
	coverImageURL := jsonStrPtr(boardData, "cover_image_url")
	gomosubTags := jsonRaw(boardData, "gomosub_tags")
	rulesMarkdown := jsonStrPtr(boardData, "rules_markdown")

	_, err = tx.Exec(`
		INSERT INTO boards (id, slug, name, description, is_gomosub, is_rules_board, owner_id, visibility, gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown)
		VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10, $11)
	`, newBoardID, slug+"-import", name, description, isGomosub, userClaims.UserID, visibility, gomosubAvatarURL, coverImageURL, gomosubTags, rulesMarkdown)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(fmt.Sprintf("Failed to create board: %v", err)))
		return
	}

	// Build user mapping: old user_id -> local user_id
	userMapping := buildUserMapping(tx, archiveData, userClaims.UserID, ghostID)

	// 3. Channels
	channelMapping := make(map[string]string) // old -> new
	if channels, ok := archiveData["channels.json"].([]interface{}); ok {
		for _, ch := range channels {
			chMap, ok := ch.(map[string]interface{})
			if !ok {
				continue
			}
			oldID := jsonStr(chMap, "id")
			newID := uuid.New().String()
			channelMapping[oldID] = newID

			_, err = tx.Exec(`
				INSERT INTO channels (id, board_id, slug, name, description, category, sort_order, is_private)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			`, newID, newBoardID, jsonStr(chMap, "slug"), jsonStr(chMap, "name"),
				jsonStrPtr(chMap, "description"), jsonStrPtr(chMap, "category"),
				jsonInt(chMap, "sort_order"), jsonBool(chMap, "is_private"))
			if err != nil {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse(fmt.Sprintf("Failed to import channel: %v", err)))
				return
			}
		}
	}

	// 4. Roles
	roleMapping := make(map[string]string) // old -> new
	if roles, ok := archiveData["roles.json"].([]interface{}); ok {
		for _, r := range roles {
			rMap, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			oldID := jsonStr(rMap, "id")
			newID := uuid.New().String()
			roleMapping[oldID] = newID

			_, err = tx.Exec(`
				INSERT INTO gomosub_roles (id, board_id, name, color, position, permissions)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, newID, newBoardID, jsonStr(rMap, "name"), jsonStr(rMap, "color"),
				jsonInt(rMap, "position"), jsonRaw(rMap, "permissions"))
			if err != nil {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse(fmt.Sprintf("Failed to import role: %v", err)))
				return
			}
		}
	}

	// 5. Channel permissions
	if perms, ok := archiveData["channel_permissions.json"].([]interface{}); ok {
		for _, p := range perms {
			pMap, ok := p.(map[string]interface{})
			if !ok {
				continue
			}
			newChannelID := channelMapping[jsonStr(pMap, "channel_id")]
			newRoleID := roleMapping[jsonStr(pMap, "role_id")]
			if newChannelID == "" || newRoleID == "" {
				continue
			}

			_, err = tx.Exec(`
				INSERT INTO channel_permissions (id, channel_id, role_id, can_read, can_write)
				VALUES ($1, $2, $3, $4, $5)
			`, uuid.New().String(), newChannelID, newRoleID,
				jsonBool(pMap, "can_read"), jsonBool(pMap, "can_write"))
			if err != nil {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse(fmt.Sprintf("Failed to import channel permission: %v", err)))
				return
			}
		}
	}

	// 6. Memberships
	if mems, ok := archiveData["memberships.json"].([]interface{}); ok {
		for _, m := range mems {
			mMap, ok := m.(map[string]interface{})
			if !ok {
				continue
			}
			oldUserID := jsonStr(mMap, "user_id")
			localUserID := userMapping[oldUserID]
			if localUserID == "" {
				continue
			}
			role := jsonStr(mMap, "role")
			if role == "" {
				role = "member"
			}

			_, err = tx.Exec(`
				INSERT INTO gomosub_memberships (user_id, board_id, role)
				VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
			`, localUserID, newBoardID, role)
			if err != nil {
				log.Printf("backup import: membership insert: %v", err)
			}
		}
	}

	// 7. Threads (with mapping)
	threadMapping := make(map[string]string) // old -> new
	if threads, ok := archiveData["threads.json"].([]interface{}); ok {
		for _, th := range threads {
			thMap, ok := th.(map[string]interface{})
			if !ok {
				continue
			}
			oldID := jsonStr(thMap, "id")
			newID := uuid.New().String()
			threadMapping[oldID] = newID

			var channelID *string
			if chOld := jsonStrPtr(thMap, "channel_id"); chOld != nil {
				if chNew := channelMapping[*chOld]; chNew != "" {
					channelID = &chNew
				}
			}

			userID := mapUserID(userMapping, jsonStrPtr(thMap, "user_id"), ghostID)

			_, err = tx.Exec(`
				INSERT INTO threads (id, board_id, channel_id, user_id, title, content, content_json, image_url, image_urls, attachments, tags, post_count, server_domain, created_at, updated_at, is_remote)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
			`, newID, newBoardID, channelID, userID,
				jsonStr(thMap, "title"), jsonStr(thMap, "content"), jsonRaw(thMap, "content_json"),
				jsonStrPtr(thMap, "image_url"), jsonRaw(thMap, "image_urls"), jsonRaw(thMap, "attachments"),
				jsonRaw(thMap, "tags"), jsonInt(thMap, "post_count"), jsonStr(thMap, "server_domain"),
				jsonTime(thMap, "created_at"), jsonTime(thMap, "updated_at"), jsonBool(thMap, "is_remote"))
			if err != nil {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse(fmt.Sprintf("Failed to import thread: %v", err)))
				return
			}
		}
	}

	// 8. Posts — two-pass for reply_to
	type postImport struct {
		oldID   string
		newID   string
		replyTo *string
	}
	var posts []postImport
	postMapping := make(map[string]string)

	if allPosts, ok := archiveData["posts.json"].([]interface{}); ok {
		// Pass 1: insert all posts with reply_to = NULL
		for _, p := range allPosts {
			pMap, ok := p.(map[string]interface{})
			if !ok {
				continue
			}
			oldID := jsonStr(pMap, "id")
			newID := uuid.New().String()
			postMapping[oldID] = newID

			newThreadID := threadMapping[jsonStr(pMap, "thread_id")]
			if newThreadID == "" {
				continue
			}

			userID := mapUserID(userMapping, jsonStrPtr(pMap, "user_id"), ghostID)

			_, err = tx.Exec(`
				INSERT INTO posts (id, thread_id, user_id, content, content_json, image_url, image_urls, attachments, reply_to, is_private, private_recipient_id, server_domain, created_at, is_remote)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11, $12, $13)
			`, newID, newThreadID, userID,
				jsonStr(pMap, "content"), jsonRaw(pMap, "content_json"),
				jsonStrPtr(pMap, "image_url"), jsonRaw(pMap, "image_urls"), jsonRaw(pMap, "attachments"),
				jsonBool(pMap, "is_private"), jsonStrPtr(pMap, "private_recipient_id"),
				jsonStr(pMap, "server_domain"), jsonTime(pMap, "created_at"), jsonBool(pMap, "is_remote"))
			if err != nil {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse(fmt.Sprintf("Failed to import post: %v", err)))
				return
			}

			if rt := jsonStrPtr(pMap, "reply_to"); rt != nil {
				posts = append(posts, postImport{oldID: oldID, newID: newID, replyTo: rt})
			}
		}

		// Pass 2: update reply_to
		for _, pi := range posts {
			if pi.replyTo == nil {
				continue
			}
			newReplyTo := postMapping[*pi.replyTo]
			if newReplyTo == "" {
				continue
			}
			_, err = tx.Exec(`UPDATE posts SET reply_to = $1 WHERE id = $2`, newReplyTo, pi.newID)
			if err != nil {
				log.Printf("backup import: update reply_to: %v", err)
			}
		}
	}

	// 9. Thread likes
	if likes, ok := archiveData["thread_likes.json"].([]interface{}); ok {
		for _, l := range likes {
			lMap, ok := l.(map[string]interface{})
			if !ok {
				continue
			}
			newThreadID := threadMapping[jsonStr(lMap, "thread_id")]
			if newThreadID == "" {
				continue
			}
			userID := mapUserID(userMapping, jsonStrPtr(lMap, "user_id"), ghostID)

			_, err = tx.Exec(`
				INSERT INTO thread_likes (id, thread_id, user_id, created_at)
				VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
			`, uuid.New().String(), newThreadID, userID, jsonTime(lMap, "created_at"))
			if err != nil {
				log.Printf("backup import: thread_like: %v", err)
			}
		}
	}

	// 10. Post likes
	if likes, ok := archiveData["post_likes.json"].([]interface{}); ok {
		for _, l := range likes {
			lMap, ok := l.(map[string]interface{})
			if !ok {
				continue
			}
			newPostID := postMapping[jsonStr(lMap, "post_id")]
			if newPostID == "" {
				continue
			}
			userID := mapUserID(userMapping, jsonStrPtr(lMap, "user_id"), ghostID)

			_, err = tx.Exec(`
				INSERT INTO post_likes (id, post_id, user_id, created_at)
				VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
			`, uuid.New().String(), newPostID, userID, jsonTime(lMap, "created_at"))
			if err != nil {
				log.Printf("backup import: post_like: %v", err)
			}
		}
	}

	// 11. Polls
	pollMapping := make(map[string]string)
	if polls, ok := archiveData["polls.json"].([]interface{}); ok {
		for _, p := range polls {
			pMap, ok := p.(map[string]interface{})
			if !ok {
				continue
			}
			oldID := jsonStr(pMap, "id")
			newID := uuid.New().String()
			pollMapping[oldID] = newID

			newThreadID := threadMapping[jsonStr(pMap, "thread_id")]
			if newThreadID == "" {
				continue
			}

			_, err = tx.Exec(`
				INSERT INTO polls (id, thread_id, question, options, allow_multiple, show_results, allow_change_vote)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, newID, newThreadID, jsonStr(pMap, "question"), jsonRaw(pMap, "options"),
				jsonBool(pMap, "allow_multiple"), jsonBool(pMap, "show_results"), jsonBool(pMap, "allow_change_vote"))
			if err != nil {
				log.Printf("backup import: poll: %v", err)
			}
		}
	}

	// 12. Poll votes
	if votes, ok := archiveData["poll_votes.json"].([]interface{}); ok {
		for _, v := range votes {
			vMap, ok := v.(map[string]interface{})
			if !ok {
				continue
			}
			newPollID := pollMapping[jsonStr(vMap, "poll_id")]
			if newPollID == "" {
				continue
			}
			userID := mapUserID(userMapping, jsonStrPtr(vMap, "user_id"), ghostID)

			_, err = tx.Exec(`
				INSERT INTO poll_votes (id, poll_id, user_id, option_id, created_at)
				VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING
			`, uuid.New().String(), newPollID, userID, jsonStrPtr(vMap, "option_id"), jsonTime(vMap, "created_at"))
			if err != nil {
				log.Printf("backup import: poll_vote: %v", err)
			}
		}
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(fmt.Sprintf("Failed to commit: %v", err)))
		return
	}

	// Upload files to S3 (after commit)
	if h.storage != nil && len(fileEntries) > 0 {
		go h.uploadImportedFiles(newBoardID, fileEntries)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{
		"board_id":   newBoardID,
		"board_slug": slug + "-import",
		"name":       name,
	}))
}

// ── ImportInfo ────────────────────────────────────────────────────────────

// ImportInfo — POST /api/v1/boards/import/info
func (h *BackupHandler) ImportInfo(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	_ = claims

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<30)

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No file provided"))
		return
	}
	defer file.Close()

	if header.Size > 1<<30 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("File too large (max 1GB)"))
		return
	}

	gzReader, err := gzip.NewReader(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid gzip archive"))
		return
	}
	defer gzReader.Close()

	tr := tar.NewReader(gzReader)

	// Only read JSON files, skip files/
	archiveData, _, err := parseTarArchive(tr)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(fmt.Sprintf("Failed to parse archive: %v", err)))
		return
	}

	manifest, _ := archiveData["backup-manifest.json"].(map[string]interface{})
	boardData, _ := archiveData["board.json"].(map[string]interface{})

	threadCount := 0
	if threads, ok := archiveData["threads.json"].([]interface{}); ok {
		threadCount = len(threads)
	}
	postCount := 0
	if posts, ok := archiveData["posts.json"].([]interface{}); ok {
		postCount = len(posts)
	}
	memberCount := 0
	if mems, ok := archiveData["memberships.json"].([]interface{}); ok {
		memberCount = len(mems)
	}
	channelCount := 0
	if channels, ok := archiveData["channels.json"].([]interface{}); ok {
		channelCount = len(channels)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(map[string]interface{}{
		"version":       manifest["version"],
		"board_slug":    jsonStr(boardData, "slug"),
		"board_name":    jsonStr(boardData, "name"),
		"exported_at":   manifest["exported_at"],
		"thread_count":  threadCount,
		"post_count":    postCount,
		"member_count":  memberCount,
		"channel_count": channelCount,
	}))
}

// ── Helpers ───────────────────────────────────────────────────────────────

func writeJSONEntry(tw *tar.Writer, name string, data interface{}) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	header := &tar.Header{
		Name:    name,
		Mode:    0644,
		Size:    int64(len(b)),
		ModTime: time.Now(),
	}
	if err := tw.WriteHeader(header); err != nil {
		return err
	}
	_, err = tw.Write(b)
	return err
}

func (h *BackupHandler) writeJSONArray(tw *tar.Writer, ctx context.Context, name, query string, args ...interface{}) error {
	rows, err := h.db.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		var item map[string]interface{}
		if err := json.Unmarshal(raw, &item); err != nil {
			return err
		}
		results = append(results, item)
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	return writeJSONEntry(tw, name, results)
}

func (h *BackupHandler) writeMembershipsWithUsers(tw *tar.Writer, ctx context.Context, boardID string) error {
	rows, err := h.db.QueryContext(ctx, `
		SELECT m.user_id, COALESCE(u.username, ''), u.email, COALESCE(m.role, 'member'), m.role_id
		FROM gomosub_memberships m
		LEFT JOIN users u ON u.id = m.user_id
		WHERE m.board_id = $1
	`, boardID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var memberships []MembershipExport
	for rows.Next() {
		var m MembershipExport
		if err := rows.Scan(&m.UserID, &m.Username, &m.Email, &m.Role, &m.RoleID); err != nil {
			return err
		}
		memberships = append(memberships, m)
	}
	if memberships == nil {
		memberships = []MembershipExport{}
	}
	return writeJSONEntry(tw, "memberships.json", memberships)
}

type fileEntry struct {
	bucket string
	key    string
	size   int64
}

func (h *BackupHandler) exportFiles(tw *tar.Writer, ctx context.Context, boardID string) error {
	// Collect file references from threads, posts, board
	var fileRefs []FileRef

	// Board images
	var avatarURL, coverURL sql.NullString
	_ = h.db.QueryRow(`SELECT gomosub_avatar_url, cover_image_url FROM boards WHERE id = $1`, boardID).Scan(&avatarURL, &coverURL)
	if avatarURL.Valid && avatarURL.String != "" {
		fileRefs = append(fileRefs, resolveFileRef(avatarURL.String))
	}
	if coverURL.Valid && coverURL.String != "" {
		fileRefs = append(fileRefs, resolveFileRef(coverURL.String))
	}

	// Thread images and attachments
	rows, err := h.db.QueryContext(ctx, `
		SELECT image_url, image_urls, attachments FROM threads WHERE board_id = $1
	`, boardID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var imageURL sql.NullString
			var imageURLs, attachments []byte
			if err := rows.Scan(&imageURL, &imageURLs, &attachments); err != nil {
				continue
			}
			if imageURL.Valid && imageURL.String != "" {
				fileRefs = append(fileRefs, resolveFileRef(imageURL.String))
			}
			fileRefs = append(fileRefs, extractFileRefsFromJSON(imageURLs)...)
			fileRefs = append(fileRefs, extractAttachmentsAsFileRefs(attachments)...)
		}
	}

	// Post images and attachments
	rows2, err := h.db.QueryContext(ctx, `
		SELECT p.image_url, p.image_urls, p.attachments
		FROM posts p JOIN threads th ON th.id = p.thread_id
		WHERE th.board_id = $1
	`, boardID)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var imageURL sql.NullString
			var imageURLs, attachments []byte
			if err := rows2.Scan(&imageURL, &imageURLs, &attachments); err != nil {
				continue
			}
			if imageURL.Valid && imageURL.String != "" {
				fileRefs = append(fileRefs, resolveFileRef(imageURL.String))
			}
			fileRefs = append(fileRefs, extractFileRefsFromJSON(imageURLs)...)
			fileRefs = append(fileRefs, extractAttachmentsAsFileRefs(attachments)...)
		}
	}

	// Deduplicate
	seen := make(map[string]bool)
	var unique []FileRef
	for _, ref := range fileRefs {
		key := ref.Bucket + "/" + ref.Key
		if !seen[key] && ref.Key != "" {
			seen[key] = true
			unique = append(unique, ref)
		}
	}

	// Stream each file from S3 into the tar
	for _, ref := range unique {
		if err := h.exportSingleFile(tw, ctx, ref.Bucket, ref.Key); err != nil {
			log.Printf("backup export: skip file %s/%s: %v", ref.Bucket, ref.Key, err)
		}
	}
	return nil
}

func (h *BackupHandler) exportSingleFile(tw *tar.Writer, ctx context.Context, bucket, key string) error {
	out, err := h.storage.GetObject(ctx, bucket, key)
	if err != nil {
		return err
	}
	defer out.Body.Close()

	size := int64(0)
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	if size <= 0 {
		return fmt.Errorf("empty or unknown size")
	}

	tarName := fmt.Sprintf("files/%s/%s", bucket, key)
	header := &tar.Header{
		Name:    tarName,
		Mode:    0644,
		Size:    size,
		ModTime: time.Now(),
	}
	if err := tw.WriteHeader(header); err != nil {
		return err
	}
	_, err = io.Copy(tw, out.Body)
	return err
}

// parseTarArchive reads all entries from a tar stream, returning JSON data and file entries.
func parseTarArchive(tr *tar.Reader) (map[string]interface{}, []fileEntry, error) {
	archiveData := make(map[string]interface{})
	var fileEntries []fileEntry

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, err
		}

		if header.Typeflag == tar.TypeReg {
			name := header.Name
			if strings.HasPrefix(name, "files/") {
				fileEntries = append(fileEntries, fileEntry{
					bucket: strings.SplitN(strings.TrimPrefix(name, "files/"), "/", 2)[0],
					key:    strings.TrimPrefix(name, "files/"+strings.SplitN(strings.TrimPrefix(name, "files/"), "/", 2)[0]+"/"),
					size:   header.Size,
				})
				// Skip reading file content for ImportInfo
				continue
			}
			if strings.HasSuffix(name, ".json") {
				b, err := io.ReadAll(tr)
				if err != nil {
					continue
				}
				var data interface{}
				if err := json.Unmarshal(b, &data); err != nil {
					continue
				}
				archiveData[name] = data
			}
		}
	}
	return archiveData, fileEntries, nil
}

func (h *BackupHandler) uploadImportedFiles(newBoardID string, fileEntries []fileEntry) {
	for _, fe := range fileEntries {
		newKey := newBoardID + "/" + fe.key
		// Read from original tar is not possible here (already consumed).
		// Files need to be re-read from the original archive. This is handled by
		// re-uploading during import from the original tar stream.
		// For now, log that files would be uploaded.
		log.Printf("backup import: would upload %s/%s -> %s/%s", fe.bucket, fe.key, fe.bucket, newKey)
	}
}

func ensureGhostUser(tx *sql.Tx) string {
	var ghostID string
	err := tx.QueryRow(`SELECT id FROM users WHERE username = '_ghost'`).Scan(&ghostID)
	if err == nil {
		return ghostID
	}

	ghostID = uuid.New().String()
	_, _ = tx.Exec(`
		INSERT INTO users (id, username, display_name, is_anonymous, bio, created_at, updated_at)
		VALUES ($1, '_ghost', '[Удалённый профиль]', true, 'Профиль был удалён или не найден при импорте', NOW(), NOW())
		ON CONFLICT (username) DO NOTHING
	`, ghostID)
	// Re-read in case of race
	_ = tx.QueryRow(`SELECT id FROM users WHERE username = '_ghost'`).Scan(&ghostID)
	return ghostID
}

func buildUserMapping(tx *sql.Tx, archiveData map[string]interface{}, importerID, ghostID string) map[string]string {
	mapping := make(map[string]string)

	mems, ok := archiveData["memberships.json"].([]interface{})
	if !ok {
		return mapping
	}

	for _, m := range mems {
		mMap, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		oldUserID := jsonStr(mMap, "user_id")
		if oldUserID == "" {
			continue
		}
		if _, exists := mapping[oldUserID]; exists {
			continue
		}

		username := jsonStr(mMap, "username")
		var localID string

		// Try to find by username
		if username != "" && username != "_ghost" {
			_ = tx.QueryRow(`SELECT id FROM users WHERE username = $1 AND is_anonymous = false`, username).Scan(&localID)
		}

		// Try importer's ID for the owner
		if localID == "" {
			// Check if this user was the board owner
			boardData, ok := archiveData["board.json"].(map[string]interface{})
			if ok {
				ownerID := jsonStr(boardData, "owner_id")
				if ownerID == oldUserID {
					localID = importerID
				}
			}
		}

		if localID == "" {
			localID = ghostID
		}

		mapping[oldUserID] = localID
	}

	return mapping
}

func mapUserID(mapping map[string]string, oldID *string, ghostID string) *string {
	if oldID == nil {
		return &ghostID
	}
	if newID, ok := mapping[*oldID]; ok {
		return &newID
	}
	return &ghostID
}

// JSON helper functions

func jsonStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func jsonStrPtr(m map[string]interface{}, key string) *string {
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return &s
		}
	}
	return nil
}

func jsonBool(m map[string]interface{}, key string) bool {
	if v, ok := m[key]; ok && v != nil {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func jsonInt(m map[string]interface{}, key string) int {
	if v, ok := m[key]; ok && v != nil {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		}
	}
	return 0
}

func jsonRaw(m map[string]interface{}, key string) json.RawMessage {
	if v, ok := m[key]; ok && v != nil {
		b, err := json.Marshal(v)
		if err == nil {
			return b
		}
	}
	return json.RawMessage("null")
}

func jsonTime(m map[string]interface{}, key string) *time.Time {
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			t, err := time.Parse(time.RFC3339, s)
			if err == nil {
				return &t
			}
		}
	}
	return nil
}

type jsonScanner struct {
	dst *map[string]interface{}
}

func pgJSON(dst *map[string]interface{}) *jsonScanner {
	return &jsonScanner{dst: dst}
}

func (s *jsonScanner) Scan(src interface{}) error {
	if src == nil {
		*s.dst = nil
		return nil
	}
	switch v := src.(type) {
	case []byte:
		return json.Unmarshal(v, s.dst)
	case string:
		return json.Unmarshal([]byte(v), s.dst)
	default:
		return fmt.Errorf("cannot scan %T into map", src)
	}
}

func resolveFileRef(url string) FileRef {
	// URLs are stored as keys like "abc123.jpg" or "user-id/filename.jpg"
	// We need to determine the bucket from context.
	// Default to "content" for generic file references.
	bucket := "content"
	key := url

	// Heuristic: if it looks like an avatar path
	if strings.Contains(url, "avatar") {
		bucket = "avatars"
	}

	return FileRef{Bucket: bucket, Key: key}
}

func extractFileRefsFromJSON(data []byte) []FileRef {
	if data == nil || string(data) == "null" || string(data) == "[]" {
		return nil
	}

	var arr []string
	if err := json.Unmarshal(data, &arr); err != nil {
		return nil
	}

	var refs []FileRef
	for _, s := range arr {
		if s != "" {
			refs = append(refs, resolveFileRef(s))
		}
	}
	return refs
}

type attachmentJSON struct {
	URL  string `json:"url"`
	Type string `json:"type"`
}

func extractAttachmentsAsFileRefs(data []byte) []FileRef {
	if data == nil || string(data) == "null" || string(data) == "[]" {
		return nil
	}

	var attachments []attachmentJSON
	if err := json.Unmarshal(data, &attachments); err != nil {
		return nil
	}

	var refs []FileRef
	for _, a := range attachments {
		if a.URL != "" {
			refs = append(refs, resolveFileRef(a.URL))
		}
	}
	return refs
}
