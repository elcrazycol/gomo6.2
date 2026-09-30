package handlers

import (
	"database/sql"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// FavoritesHandler serves «Избранное»: per-user bookmarks on threads and wall
// posts. The list reuses the unified-feed wire shape so the frontend renders
// the shared cards; a compact ids endpoint lets every card show its bookmark
// state without per-card requests.
type FavoritesHandler struct {
	db *sql.DB
}

func NewFavoritesHandler(db *sql.DB) *FavoritesHandler {
	return &FavoritesHandler{db: db}
}

// favoritesListQuery unions the viewer's bookmarked threads and wall posts into
// one feed-shaped result set ordered by saved_at. Column order matches the scan
// below (and, for shared fields, get_user_feed).
const favoritesListQuery = `
SELECT * FROM (
  SELECT
    'thread'::text AS item_type,
    t.id AS item_id,
    t.public_id AS public_id,
    t.created_at, t.updated_at,
    t.title::text, t.content::text, t.content_json, t.image_url, t.image_urls, t.attachments, t.tags, t.post_count,
    t.user_id AS author_id,
    u.username::text, u.public_id, u.display_name::text, u.nickname_emoji_id, COALESCE(u.is_anonymous, false), u.avatar_url,
    t.board_id, b.slug::text, b.name::text, COALESCE(b.is_gomosub, false),
    t.section_id, ts.slug::text, ts.name::text, ts.icon::text,
    t.subsection_id, tss.slug::text, tss.name::text,
    NULL::uuid AS wall_user_id,
    NULL::bigint AS user_public_id,
    (SELECT COUNT(*)::bigint FROM thread_likes tl WHERE tl.thread_id = t.id) AS likes_count,
    t.post_count::bigint AS comments_count,
    0::bigint AS reposts_count,
    EXISTS(SELECT 1 FROM thread_likes tl WHERE tl.thread_id = t.id AND tl.user_id = $1) AS liked_by_viewer,
    0::bigint AS views_count,
    f.created_at AS saved_at
  FROM content_favorites f
  JOIN threads t ON t.id = f.item_id
  LEFT JOIN boards b ON b.id = t.board_id
  LEFT JOIN thread_sections ts ON ts.id = t.section_id
  LEFT JOIN thread_subsections tss ON tss.id = t.subsection_id
  LEFT JOIN users u ON u.id = t.user_id
  WHERE f.user_id = $1 AND f.item_type = 'thread'

  UNION ALL

  SELECT
    'wall_post'::text,
    p.id,
    p.public_id,
    p.created_at, p.updated_at,
    p.title::text, p.content::text, p.content_json, p.image_url, NULL::jsonb, p.attachments, NULL::jsonb, NULL::integer,
    p.author_id,
    u.username::text, u.public_id, u.display_name::text, u.nickname_emoji_id, COALESCE(u.is_anonymous, false), u.avatar_url,
    NULL::uuid, NULL::text, NULL::text, false,
    NULL::uuid, NULL::text, NULL::text, NULL::text,
    NULL::uuid, NULL::text, NULL::text,
    p.user_id,
    ow.public_id,
    (SELECT COUNT(*)::bigint FROM profile_wall_post_likes l WHERE l.post_id = p.id),
    (SELECT COUNT(*)::bigint FROM profile_wall_post_comments cm WHERE cm.post_id = p.id),
    (SELECT COUNT(*)::bigint FROM profile_wall_post_reposts r WHERE r.post_id = p.id),
    EXISTS(SELECT 1 FROM profile_wall_post_likes l WHERE l.post_id = p.id AND l.user_id = $1),
    (SELECT COUNT(*)::bigint FROM profile_wall_post_views v WHERE v.post_id = p.id),
    f.created_at
  FROM content_favorites f
  JOIN profile_wall_posts p ON p.id = f.item_id
  LEFT JOIN users u ON u.id = p.author_id
  LEFT JOIN users ow ON ow.id = p.user_id
  WHERE f.user_id = $1 AND f.item_type = 'wall_post'
) fav
ORDER BY saved_at DESC
LIMIT $2 OFFSET $3`

// validItemType reports whether the given item type is bookmarkable.
func validItemType(raw string) bool {
	return raw == "thread" || raw == "wall_post"
}

// AddFavorite godoc
// @Summary      Add an item to favorites
// @Tags         Favorites
// @Accept       json
// @Produce      json
// @Router       /favorites [post]
func (h *FavoritesHandler) AddFavorite(c *gin.Context) {
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
	if !validItemType(body.ItemType) || !isUUID(body.ItemID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item"})
		return
	}

	// item_id is polymorphic (no FK) — confirm the target exists.
	var exists bool
	var err error
	if body.ItemType == "thread" {
		err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)", body.ItemID).Scan(&exists)
	} else {
		err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM profile_wall_posts WHERE id = $1)", body.ItemID).Scan(&exists)
	}
	if err != nil {
		httpx.ServerError(c, "favorite existence check failed", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if _, err := h.db.Exec(`
		INSERT INTO content_favorites (user_id, item_type, item_id, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
		userID, body.ItemType, body.ItemID); err != nil {
		httpx.ServerError(c, "favorite insert failed", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// RemoveFavorite godoc
// @Summary      Remove an item from favorites
// @Tags         Favorites
// @Produce      json
// @Router       /favorites/{itemType}/{itemId} [delete]
func (h *FavoritesHandler) RemoveFavorite(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	itemType := c.Param("itemType")
	itemID := c.Param("itemId")
	if !validItemType(itemType) || !isUUID(itemID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item"})
		return
	}
	if _, err := h.db.Exec(
		"DELETE FROM content_favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3",
		userID, itemType, itemID); err != nil {
		httpx.ServerError(c, "favorite delete failed", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// GetFavoriteIds godoc
// @Summary      Ids of the viewer's favorites (for per-card bookmark state)
// @Tags         Favorites
// @Produce      json
// @Router       /favorites/ids [get]
func (h *FavoritesHandler) GetFavoriteIds(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	rows, err := h.db.Query(
		"SELECT item_type, item_id FROM content_favorites WHERE user_id = $1", userID)
	if err != nil {
		httpx.ServerError(c, "favorite ids query failed", err)
		return
	}
	defer rows.Close()

	type favoriteID struct {
		ItemType string `json:"item_type"`
		ItemID   string `json:"item_id"`
	}
	ids := []favoriteID{}
	for rows.Next() {
		var it favoriteID
		if err := rows.Scan(&it.ItemType, &it.ItemID); err != nil {
			httpx.ServerError(c, "favorite id scan failed", err)
			return
		}
		ids = append(ids, it)
	}
	count := len(ids)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: ids, Count: &count})
}

// GetFavorites godoc
// @Summary      The viewer's favorites
// @Tags         Favorites
// @Produce      json
// @Param        limit  query int false "Max results (1-100)" default(30)
// @Param        offset query int false "Offset for pagination"
// @Router       /favorites [get]
func (h *FavoritesHandler) GetFavorites(c *gin.Context) {
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

	rows, err := h.db.Query(favoritesListQuery, userID, limit, offset)
	if err != nil {
		httpx.ServerError(c, "favorites query failed", err)
		return
	}
	defer rows.Close()

	items := []feedItem{}
	for rows.Next() {
		var it feedItem
		var updatedAt, savedAt sql.NullTime
		var title, content, imageURL, authorID sql.NullString
		var contentJSON, imageURLs, attachments, tags []byte
		var postCount sql.NullInt64
		var authorUsername, authorDisplayName, authorNicknameEmojiID, authorAvatarURL sql.NullString
		var authorPublicID *int64
		var authorIsAnonymous bool
		var boardID, boardSlug, boardName sql.NullString
		var boardIsGomosub bool
		var sectionID, sectionSlug, sectionName, sectionIcon sql.NullString
		var subsectionID, subsectionSlug, subsectionName sql.NullString
		var wallUserID sql.NullString

		if err := rows.Scan(
			&it.ItemType, &it.ItemID, &it.PublicID, &it.CreatedAt, &updatedAt,
			&title, &content, &contentJSON, &imageURL, &imageURLs, &attachments,
			&tags, &postCount,
			&authorID, &authorUsername, &authorPublicID, &authorDisplayName, &authorNicknameEmojiID,
			&authorIsAnonymous, &authorAvatarURL,
			&boardID, &boardSlug, &boardName, &boardIsGomosub,
			&sectionID, &sectionSlug, &sectionName, &sectionIcon,
			&subsectionID, &subsectionSlug, &subsectionName,
			&wallUserID, &it.UserPublicID,
			&it.LikesCount, &it.CommentsCount, &it.RepostsCount, &it.LikedByViewer,
			&it.ViewsCount, &savedAt,
		); err != nil {
			httpx.ServerError(c, "favorites row scan failed", err)
			return
		}

		if updatedAt.Valid {
			t := updatedAt.Time
			it.UpdatedAt = &t
		}
		if savedAt.Valid {
			t := savedAt.Time
			it.SavedAt = &t
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
				PublicID:        authorPublicID,
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
