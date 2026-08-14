package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// FeedHandler serves the unified personalized feed (threads + wall posts).
type FeedHandler struct {
	db *sql.DB
}

func NewFeedHandler(db *sql.DB) *FeedHandler {
	return &FeedHandler{db: db}
}

// feedItem is the wire shape of one unified feed entry. Both sources
// (threads and wall posts) are flattened into the same object; fields that a
// source does not have are left NULL. The frontend switches on item_type.
type feedItem struct {
	ItemType      string          `json:"item_type"` // "thread" | "wall_post"
	ItemID        string          `json:"item_id"`
	Score         float64         `json:"score"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     *time.Time      `json:"updated_at,omitempty"`
	Title         *string         `json:"title,omitempty"`
	Content       *string         `json:"content,omitempty"`
	ContentJSON   json.RawMessage `json:"content_json,omitempty"`
	ImageURL      *string         `json:"image_url,omitempty"`
	ImageURLs     json.RawMessage `json:"image_urls,omitempty"`
	Attachments   json.RawMessage `json:"attachments,omitempty"`
	Tags          json.RawMessage `json:"tags,omitempty"`
	PostCount     *int            `json:"post_count,omitempty"`
	AuthorID      *string         `json:"author_id,omitempty"`
	Author        *feedAuthor     `json:"author,omitempty"`
	BoardID       *string         `json:"board_id,omitempty"`
	Boards        *feedBoard      `json:"boards,omitempty"`
	WallUserID    *string         `json:"wall_user_id,omitempty"`
	LikesCount    int64           `json:"likes_count"`
	CommentsCount int64           `json:"comments_count"`
	RepostsCount  int64           `json:"reposts_count"`
	LikedByViewer bool            `json:"liked_by_viewer"`
	ViewsCount    int64           `json:"views_count"`
}

type feedAuthor struct {
	Username        string  `json:"username"`
	DisplayName     *string `json:"display_name"`
	NicknameEmojiID *string `json:"nickname_emoji_id"`
	IsAnonymous     bool    `json:"is_anonymous"`
	AvatarURL       *string `json:"avatar_url"`
}

type feedBoard struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	IsGomosub bool   `json:"is_gomosub"`
}

// GetUserFeed godoc
// @Summary      Unified personalized feed
// @Description  Returns a scored mix of threads and profile wall posts for the
//
//	current user (or the global stream for anonymous callers).
//
// @Tags         Feed
// @Produce      json
// @Param        limit  query int false "Max results (1-50)" default(20)
// @Param        offset query int false "Offset for pagination" default(0)
// @Success      200 {object} models.APIResponse
// @Router       /feed [get]
func (h *FeedHandler) GetUserFeed(c *gin.Context) {
	// The viewer comes from the optional-auth claims set by the middleware.
	// Anonymous callers get the global stream (user_uuid = NULL in SQL).
	var userID interface{}
	if uid := authenticatedUserID(c); uid != "" {
		userID = uid
	}

	limit := 20
	offset := 0
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 && o <= 1000000 {
			offset = o
		}
	}

	rows, err := h.db.Query(
		`SELECT item_type, item_id, score, created_at, updated_at,
		        title, content, content_json, image_url, image_urls, attachments,
		        tags, post_count,
		        author_id, author_username, author_display_name, author_nickname_emoji_id,
		        author_is_anonymous, author_avatar_url,
		        board_id, board_slug, board_name, board_is_gomosub,	        wall_user_id,
	        likes_count, comments_count, reposts_count, liked_by_viewer, views_count
		 FROM get_user_feed($1, $2, $3)`,
		userID, limit, offset,
	)
	if err != nil {
		serverError(c, "feed query failed", err)
		return
	}
	defer rows.Close()

	items := []feedItem{}
	for rows.Next() {
		var it feedItem
		var title, content, imageURL, authorID sql.NullString
		var updatedAt sql.NullTime
		var contentJSON, imageURLs, attachments, tags []byte
		var postCount sql.NullInt64
		var authorUsername sql.NullString
		var authorDisplayName, authorNicknameEmojiID, authorAvatarURL sql.NullString
		var authorIsAnonymous bool
		var boardID sql.NullString
		var boardSlug, boardName sql.NullString
		var boardIsGomosub bool
		var wallUserID sql.NullString
		var score float64

		err := rows.Scan(
			&it.ItemType, &it.ItemID, &score, &it.CreatedAt, &updatedAt,
			&title, &content, &contentJSON, &imageURL, &imageURLs, &attachments,
			&tags, &postCount,
			&authorID, &authorUsername, &authorDisplayName, &authorNicknameEmojiID,
			&authorIsAnonymous, &authorAvatarURL,
			&boardID, &boardSlug, &boardName, &boardIsGomosub,
			&wallUserID,
			&it.LikesCount, &it.CommentsCount, &it.RepostsCount, &it.LikedByViewer,
			&it.ViewsCount,
		)
		if err != nil {
			serverError(c, "feed row scan failed", err)
			return
		}

		it.Score = score
		if updatedAt.Valid {
			t := updatedAt.Time
			it.UpdatedAt = &t
		}
		if title.Valid {
			it.Title = &title.String
		}
		if content.Valid {
			it.Content = &content.String
		}
		if len(contentJSON) > 0 {
			it.ContentJSON = json.RawMessage(contentJSON)
		}
		if imageURL.Valid {
			it.ImageURL = &imageURL.String
		}
		if len(imageURLs) > 0 {
			it.ImageURLs = json.RawMessage(imageURLs)
		}
		if len(attachments) > 0 {
			it.Attachments = json.RawMessage(attachments)
		}
		if len(tags) > 0 {
			it.Tags = json.RawMessage(tags)
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
		if wallUserID.Valid {
			it.WallUserID = &wallUserID.String
		}

		items = append(items, it)
	}

	itemCount := len(items)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: items, Count: &itemCount})
}

func nullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	return &ns.String
}
