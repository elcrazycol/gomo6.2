package handlers

import (
	"database/sql"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// HistoryHandler serves the per-user viewing history («История»): the threads
// and wall posts the viewer has opened, newest first, with the same wire shape
// as the unified feed so the frontend reuses the feed cards.
type HistoryHandler struct {
	db *sql.DB
}

func NewHistoryHandler(db *sql.DB) *HistoryHandler {
	return &HistoryHandler{db: db}
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isUUID(s string) bool { return uuidRe.MatchString(s) }

// historyListQuery unions the viewer's viewed threads and wall posts into one
// feed-shaped result set ordered by viewed_at. Columns and their order match
// the scan below (and, for the shared fields, get_user_feed).
const historyListQuery = `
SELECT * FROM (
  SELECT
    'thread'::text AS item_type,
    t.id AS item_id,
    t.created_at, t.updated_at,
    t.title::text, t.content::text, t.content_json, t.image_url, t.image_urls, t.attachments, t.tags, t.post_count,
    t.user_id AS author_id,
    u.username::text, u.display_name::text, u.nickname_emoji_id, COALESCE(u.is_anonymous, false), u.avatar_url,
    t.board_id, b.slug::text, b.name::text, COALESCE(b.is_gomosub, false),
    t.section_id, ts.slug::text, ts.name::text, ts.icon::text,
    t.subsection_id, tss.slug::text, tss.name::text,
    NULL::uuid AS wall_user_id,
    (SELECT COUNT(*)::bigint FROM thread_likes tl WHERE tl.thread_id = t.id) AS likes_count,
    t.post_count::bigint AS comments_count,
    0::bigint AS reposts_count,
    EXISTS(SELECT 1 FROM thread_likes tl WHERE tl.thread_id = t.id AND tl.user_id = $1) AS liked_by_viewer,
    0::bigint AS views_count,
    h.viewed_at
  FROM content_view_history h
  JOIN threads t ON t.id = h.item_id
  LEFT JOIN boards b ON b.id = t.board_id
  LEFT JOIN thread_sections ts ON ts.id = t.section_id
  LEFT JOIN thread_subsections tss ON tss.id = t.subsection_id
  LEFT JOIN users u ON u.id = t.user_id
  WHERE h.user_id = $1 AND h.item_type = 'thread'

  UNION ALL

  SELECT
    'wall_post'::text,
    p.id,
    p.created_at, p.updated_at,
    p.title::text, p.content::text, p.content_json, p.image_url, NULL::jsonb, p.attachments, NULL::jsonb, NULL::integer,
    p.author_id,
    u.username::text, u.display_name::text, u.nickname_emoji_id, COALESCE(u.is_anonymous, false), u.avatar_url,
    NULL::uuid, NULL::text, NULL::text, false,
    NULL::uuid, NULL::text, NULL::text, NULL::text,
    NULL::uuid, NULL::text, NULL::text,
    p.user_id,
    (SELECT COUNT(*)::bigint FROM profile_wall_post_likes l WHERE l.post_id = p.id),
    (SELECT COUNT(*)::bigint FROM profile_wall_post_comments cm WHERE cm.post_id = p.id),
    (SELECT COUNT(*)::bigint FROM profile_wall_post_reposts r WHERE r.post_id = p.id),
    EXISTS(SELECT 1 FROM profile_wall_post_likes l WHERE l.post_id = p.id AND l.user_id = $1),
    (SELECT COUNT(*)::bigint FROM profile_wall_post_views v WHERE v.post_id = p.id),
    h.viewed_at
  FROM content_view_history h
  JOIN profile_wall_posts p ON p.id = h.item_id
  LEFT JOIN users u ON u.id = p.author_id
  WHERE h.user_id = $1 AND h.item_type = 'wall_post'
) hist
ORDER BY viewed_at DESC
LIMIT $2 OFFSET $3`

// RecordView godoc
// @Summary      Record a content view
// @Tags         History
// @Accept       json
// @Produce      json
// @Router       /history [post]
func (h *HistoryHandler) RecordView(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var body struct {
		ItemType string `json:"item_type"`
		ItemID   string `json:"item_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	body.ItemType = strings.TrimSpace(body.ItemType)
	body.ItemID = strings.TrimSpace(body.ItemID)
	if body.ItemType != "thread" && body.ItemType != "wall_post" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item_type"})
		return
	}
	if !isUUID(body.ItemID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item_id"})
		return
	}

	// item_id is polymorphic (no FK), so confirm the target exists before
	// storing it — otherwise a stale/deleted id would linger in the history.
	var exists bool
	var err error
	if body.ItemType == "thread" {
		err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)", body.ItemID).Scan(&exists)
	} else {
		err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM profile_wall_posts WHERE id = $1)", body.ItemID).Scan(&exists)
	}
	if err != nil {
		httpx.ServerError(c, "history existence check failed", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if _, err := h.db.Exec(`
		INSERT INTO content_view_history (user_id, item_type, item_id, viewed_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET viewed_at = NOW()`,
		userID, body.ItemType, body.ItemID); err != nil {
		httpx.ServerError(c, "history upsert failed", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// GetHistory godoc
// @Summary      The viewer's viewing history
// @Tags         History
// @Produce      json
// @Param        limit  query int false "Max results (1-100)" default(30)
// @Param        offset query int false "Offset for pagination"
// @Router       /history [get]
func (h *HistoryHandler) GetHistory(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	limit := 30
	if raw := c.Query("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	offset := 0
	if raw := c.Query("offset"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			offset = n
		}
	}

	rows, err := h.db.Query(historyListQuery, userID, limit, offset)
	if err != nil {
		httpx.ServerError(c, "history query failed", err)
		return
	}
	defer rows.Close()

	items := []feedItem{}
	for rows.Next() {
		var it feedItem
		var updatedAt, viewedAt sql.NullTime
		var title, content, imageURL, authorID sql.NullString
		var contentJSON, imageURLs, attachments, tags []byte
		var postCount sql.NullInt64
		var authorUsername, authorDisplayName, authorNicknameEmojiID, authorAvatarURL sql.NullString
		var authorIsAnonymous bool
		var boardID, boardSlug, boardName sql.NullString
		var boardIsGomosub bool
		var sectionID, sectionSlug, sectionName, sectionIcon sql.NullString
		var subsectionID, subsectionSlug, subsectionName sql.NullString
		var wallUserID sql.NullString

		if err := rows.Scan(
			&it.ItemType, &it.ItemID, &it.CreatedAt, &updatedAt,
			&title, &content, &contentJSON, &imageURL, &imageURLs, &attachments,
			&tags, &postCount,
			&authorID, &authorUsername, &authorDisplayName, &authorNicknameEmojiID,
			&authorIsAnonymous, &authorAvatarURL,
			&boardID, &boardSlug, &boardName, &boardIsGomosub,
			&sectionID, &sectionSlug, &sectionName, &sectionIcon,
			&subsectionID, &subsectionSlug, &subsectionName,
			&wallUserID,
			&it.LikesCount, &it.CommentsCount, &it.RepostsCount, &it.LikedByViewer,
			&it.ViewsCount, &viewedAt,
		); err != nil {
			httpx.ServerError(c, "history row scan failed", err)
			return
		}

		if updatedAt.Valid {
			t := updatedAt.Time
			it.UpdatedAt = &t
		}
		if viewedAt.Valid {
			t := viewedAt.Time
			it.ViewedAt = &t
		}
		if title.Valid {
			it.Title = &title.String
		}
		if content.Valid {
			it.Content = &content.String
		}
		if len(contentJSON) > 0 {
			it.ContentJSON = contentJSON
		}
		if imageURL.Valid {
			it.ImageURL = &imageURL.String
		}
		if len(imageURLs) > 0 {
			it.ImageURLs = imageURLs
		}
		if len(attachments) > 0 {
			it.Attachments = attachments
		}
		if len(tags) > 0 {
			it.Tags = tags
		}
		if postCount.Valid {
			pc := int(postCount.Int64)
			it.PostCount = &pc
		}
		if authorID.Valid {
			it.AuthorID = &authorID.String
			it.Author = &feedAuthor{
				Username:        authorUsername.String,
				DisplayName:     nullStringPtr(authorDisplayName),
				NicknameEmojiID: nullStringPtr(authorNicknameEmojiID),
				IsAnonymous:     authorIsAnonymous,
				AvatarURL:       nullStringPtr(authorAvatarURL),
			}
		}
		if boardID.Valid {
			it.BoardID = &boardID.String
			it.Boards = &feedBoard{
				Slug:      boardSlug.String,
				Name:      boardName.String,
				IsGomosub: boardIsGomosub,
			}
		}
		if sectionID.Valid {
			it.SectionID = &sectionID.String
			it.Section = &feedSection{
				ID:     sectionID.String,
				Slug:   sectionSlug.String,
				Name:   sectionName.String,
				Icon:   nullStringPtr(sectionIcon),
				IsNSFW: false,
			}
		}
		if subsectionID.Valid {
			it.SubsectionID = &subsectionID.String
			it.Subsection = &feedSubsection{
				ID:   subsectionID.String,
				Slug: subsectionSlug.String,
				Name: subsectionName.String,
			}
		}
		if wallUserID.Valid {
			it.WallUserID = &wallUserID.String
		}

		items = append(items, it)
	}

	itemCount := len(items)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: items, Count: &itemCount})
}

// ClearHistory godoc
// @Summary      Clear the viewer's viewing history
// @Tags         History
// @Produce      json
// @Router       /history [delete]
func (h *HistoryHandler) ClearHistory(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if _, err := h.db.Exec("DELETE FROM content_view_history WHERE user_id = $1", userID); err != nil {
		httpx.ServerError(c, "history clear failed", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}
