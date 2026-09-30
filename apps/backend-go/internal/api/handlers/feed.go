package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/lib/pq"
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
	PublicID      *int64          `json:"public_id,omitempty"`
	UserPublicID  *int64          `json:"user_public_id,omitempty"`
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
	SectionID     *string         `json:"section_id,omitempty"`
	Section       *feedSection    `json:"section,omitempty"`
	SubsectionID  *string         `json:"subsection_id,omitempty"`
	Subsection    *feedSubsection `json:"subsection,omitempty"`
	WallUserID    *string         `json:"wall_user_id,omitempty"`
	LikesCount    int64           `json:"likes_count"`
	CommentsCount int64           `json:"comments_count"`
	RepostsCount  int64           `json:"reposts_count"`
	LikedByViewer bool            `json:"liked_by_viewer"`
	ViewsCount    int64           `json:"views_count"`
	// Set only by the history endpoint (the unified feed leaves it nil).
	ViewedAt *time.Time `json:"viewed_at,omitempty"`
	// Set only by the favorites endpoint.
	SavedAt *time.Time `json:"saved_at,omitempty"`
}

type feedAuthor struct {
	Username        string  `json:"username"`
	PublicID        *int64  `json:"public_id,omitempty"`
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

type feedSection struct {
	ID     string  `json:"id"`
	Slug   string  `json:"slug"`
	Name   string  `json:"name"`
	Icon   *string `json:"icon,omitempty"`
	IsNSFW bool    `json:"is_nsfw"`
}

type feedSubsection struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
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
// @Param        since  query string false "RFC3339 timestamp; return only newer items"
// @Param        before query string false "Keyset cursor \"score:item_id\" for load-more"
// @Success      200 {object} models.APIResponse
// @Router       /feed [get]
func (h *FeedHandler) GetUserFeed(c *gin.Context) {
	// The viewer comes from the optional-auth claims set by the middleware.
	// Anonymous callers get the global stream (user_uuid = NULL in SQL).
	var userID interface{}
	if uid := httpx.AuthenticatedUserID(c); uid != "" {
		userID = uid
	}

	limit := 20
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}

	// `since` — RFC3339 timestamp; return only items created after it (the
	// pull-to-refresh "new posts" cursor).
	var sinceTS *time.Time
	if sinceStr := c.Query("since"); sinceStr != "" {
		if t, err := time.Parse(time.RFC3339, sinceStr); err == nil {
			sinceTS = &t
		}
	}

	// `before` — keyset cursor "<score>:<item_id>" from the last item of the
	// previous page. Replaces OFFSET, which drifted as the score changed and
	// caused duplicate/skipped items on fast refresh.
	var beforeSort *float64
	var beforeID *string
	if beforeStr := c.Query("before"); beforeStr != "" {
		if parts := strings.SplitN(beforeStr, ":", 2); len(parts) == 2 {
			if f, err := strconv.ParseFloat(parts[0], 64); err == nil {
				beforeSort = &f
				beforeID = &parts[1]
			}
		}
	}

	rows, err := h.db.Query(
		`SELECT item_type, item_id, score, created_at, updated_at,
		        title, content, content_json, image_url, image_urls, attachments,
		        tags, post_count,
		        author_id, author_username, author_display_name, author_nickname_emoji_id,
		        author_is_anonymous, author_avatar_url,
		        board_id, board_slug, board_name, board_is_gomosub,
		        section_id, section_slug, section_name, section_icon,
		        subsection_id, subsection_slug, subsection_name,
		        wall_user_id,
	        likes_count, comments_count, reposts_count, liked_by_viewer, views_count
		 FROM get_user_feed($1, $2, $3, $4, $5)`,
		userID, limit, sinceTS, beforeSort, beforeID,
	)
	if err != nil {
		httpx.ServerError(c, "feed query failed", err)
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
		var sectionID, sectionSlug, sectionName, sectionIcon sql.NullString
		var sectionIsNSFW bool
		var subsectionID, subsectionSlug, subsectionName sql.NullString
		var wallUserID sql.NullString
		var score float64

		err := rows.Scan(
			&it.ItemType, &it.ItemID, &score, &it.CreatedAt, &updatedAt,
			&title, &content, &contentJSON, &imageURL, &imageURLs, &attachments,
			&tags, &postCount,
			&authorID, &authorUsername, &authorDisplayName, &authorNicknameEmojiID,
			&authorIsAnonymous, &authorAvatarURL,
			&boardID, &boardSlug, &boardName, &boardIsGomosub,
			&sectionID, &sectionSlug, &sectionName, &sectionIcon,
			&subsectionID, &subsectionSlug, &subsectionName,
			&wallUserID,
			&it.LikesCount, &it.CommentsCount, &it.RepostsCount, &it.LikedByViewer,
			&it.ViewsCount,
		)
		if err != nil {
			httpx.ServerError(c, "feed row scan failed", err)
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
		if sectionID.Valid {
			it.SectionID = &sectionID.String
			it.Section = &feedSection{
				ID:     sectionID.String,
				Slug:   sectionSlug.String,
				Name:   sectionName.String,
				Icon:   nullStringPtr(sectionIcon),
				IsNSFW: sectionIsNSFW,
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

	h.fillPublicIDs(items)

	itemCount := len(items)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: items, Count: &itemCount})
}

// fillPublicIDs attaches the human-readable numbers the client needs to build
// links. It is a second pass on purpose: wrapping get_user_feed in a join would
// risk reordering the score-ordered feed, so the function stays the single
// source of truth for order and only the numbers are looked up by primary key.
//
// One query for the whole page: the feed is behind the viewer-keyed data cache,
// so this runs on cache misses only.
func (h *FeedHandler) fillPublicIDs(items []feedItem) {
	if len(items) == 0 {
		return
	}
	var threadIDs, wallPostIDs, authorIDs []string
	seenAuthors := make(map[string]bool, len(items))
	for _, it := range items {
		switch it.ItemType {
		case "thread":
			threadIDs = append(threadIDs, it.ItemID)
		case "wall_post":
			wallPostIDs = append(wallPostIDs, it.ItemID)
		}
		if it.AuthorID != nil && !seenAuthors[*it.AuthorID] {
			seenAuthors[*it.AuthorID] = true
			authorIDs = append(authorIDs, *it.AuthorID)
		}
	}

	threadPublic := make(map[string]int64, len(threadIDs))
	wallPostPublic := make(map[string]int64, len(wallPostIDs))
	wallOwnerPublic := make(map[string]int64, len(wallPostIDs))
	authorPublic := make(map[string]int64, len(authorIDs))

	rows, err := h.db.Query(`
		SELECT 'thread'::text AS kind, t.id, t.public_id, NULL::bigint
		  FROM threads t WHERE t.id = ANY($1::uuid[])
		UNION ALL
		SELECT 'wall_post', p.id, p.public_id, ow.public_id
		  FROM profile_wall_posts p
		  LEFT JOIN users ow ON ow.id = p.user_id
		 WHERE p.id = ANY($1::uuid[])
		UNION ALL
		SELECT 'user', u.id, u.public_id, NULL::bigint
		  FROM users u WHERE u.id = ANY($2::uuid[])`,
		pq.Array(threadIDs), pq.Array(authorIDs))
	if err != nil {
		// Best-effort enrichment: a failure here must not fail the feed — the
		// client falls back to UUID links.
		log.Printf("[feed] public_id lookup failed: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var kind, id string
		var publicID int64
		var ownerPublicID sql.NullInt64
		if err := rows.Scan(&kind, &id, &publicID, &ownerPublicID); err != nil {
			continue
		}
		switch kind {
		case "thread":
			threadPublic[id] = publicID
		case "wall_post":
			wallPostPublic[id] = publicID
			if ownerPublicID.Valid {
				wallOwnerPublic[id] = ownerPublicID.Int64
			}
		case "user":
			authorPublic[id] = publicID
		}
	}

	for i := range items {
		it := &items[i]
		switch it.ItemType {
		case "thread":
			if n, ok := threadPublic[it.ItemID]; ok {
				it.PublicID = &n
			}
		case "wall_post":
			if n, ok := wallPostPublic[it.ItemID]; ok {
				it.PublicID = &n
			}
			if n, ok := wallOwnerPublic[it.ItemID]; ok {
				it.UserPublicID = &n
			}
		}
		if it.AuthorID != nil && it.Author != nil {
			if n, ok := authorPublic[*it.AuthorID]; ok {
				it.Author.PublicID = &n
			}
		}
	}
}

func nullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	return &ns.String
}
