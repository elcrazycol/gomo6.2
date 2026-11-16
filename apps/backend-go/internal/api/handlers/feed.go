package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/metrics"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/privacy"
)

// FeedHandler serves the unified personalized feed (threads + wall posts).
type FeedHandler struct {
	db *sql.DB
}

func NewFeedHandler(db *sql.DB) *FeedHandler {
	return &FeedHandler{db: db}
}

// ─── Singleflight for cold-feed stampedes ────────────────────────────────────
// The data-cache middleware serves most feed reads from Redis, but when the
// 30s entry expires (or the first guest arrives) every concurrent request
// misses at once and each would run the full SQL ranking. This tiny
// stdlib-only singleflight collapses simultaneous identical misses into one
// DB query: the losers wait on the winner's WaitGroup and share its page.
// Calls are keyed by viewer + cursors and the entry lives only for the query
// duration (no TTL, no stale data).

type feedInflightCall struct {
	wg    sync.WaitGroup
	items []feedItem
	err   error
}

var (
	feedFlightMu sync.Mutex
	feedFlight   = make(map[string]*feedInflightCall)
)

// doFeedSingleflight runs fn once per key; concurrent callers with the same
// key wait and share the result. The third return value reports a shared hit.
func doFeedSingleflight(key string, fn func() ([]feedItem, error)) ([]feedItem, error, bool) {
	feedFlightMu.Lock()
	if c, ok := feedFlight[key]; ok {
		feedFlightMu.Unlock()
		c.wg.Wait()
		return c.items, c.err, true
	}
	c := &feedInflightCall{}
	c.wg.Add(1)
	feedFlight[key] = c
	feedFlightMu.Unlock()

	c.items, c.err = fn()
	c.wg.Done()

	feedFlightMu.Lock()
	delete(feedFlight, key)
	feedFlightMu.Unlock()
	return c.items, c.err, false
}

func feedFlightKey(userID interface{}, limit int, sinceTS *time.Time, beforeSort *float64, beforeID *string) string {
	var sinceKey, sortKey, idKey string
	if sinceTS != nil {
		sinceKey = sinceTS.UTC().Format(time.RFC3339Nano)
	}
	if beforeSort != nil {
		sortKey = strconv.FormatFloat(*beforeSort, 'g', -1, 64)
	}
	if beforeID != nil {
		idKey = *beforeID
	}
	return strings.Join([]string{
		feedViewerKey(userID), strconv.Itoa(limit), sinceKey, sortKey, idKey,
	}, "|")
}

func feedViewerKey(userID interface{}) string {
	if s, ok := userID.(string); ok && s != "" {
		return s
	}
	return "anon"
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

	items, err, shared := doFeedSingleflight(
		feedFlightKey(userID, limit, sinceTS, beforeSort, beforeID),
		func() ([]feedItem, error) { return h.queryFeedPage(userID, limit, sinceTS, beforeSort, beforeID) },
	)
	if shared {
		metrics.App.FeedSingleflightHit()
	}
	if err != nil {
		httpx.ServerError(c, "feed query failed", err)
		return
	}

	itemCount := len(items)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: items, Count: &itemCount})
}

// queryFeedPage runs the single feed SQL query and hydrates the wire items.
// get_user_feed returns the fully ranked AND hydrated page (public_ids and
// liked_by_viewer included), so no second lookup round-trip is needed.
func (h *FeedHandler) queryFeedPage(userID interface{}, limit int, sinceTS *time.Time, beforeSort *float64, beforeID *string) ([]feedItem, error) {
	start := time.Now()
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
	        likes_count, comments_count, reposts_count, liked_by_viewer, views_count,
	        public_id, user_public_id, author_public_id
		 FROM get_user_feed($1, $2, $3, $4, $5)`,
		userID, limit, sinceTS, beforeSort, beforeID,
	)
	if err != nil {
		return nil, err
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
		var publicID, userPublicID, authorPublicID sql.NullInt64
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
			&publicID, &userPublicID, &authorPublicID,
		)
		if err != nil {
			return nil, err
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
			author := &feedAuthor{
				Username:        authorUsername.String,
				DisplayName:     nullStringPtr(authorDisplayName),
				NicknameEmojiID: nullStringPtr(authorNicknameEmojiID),
				IsAnonymous:     authorIsAnonymous,
				AvatarURL:       nullStringPtr(authorAvatarURL),
			}
			if authorPublicID.Valid {
				n := authorPublicID.Int64
				author.PublicID = &n
			}
			it.Author = author
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
		// public_ids come from the same SQL query (hydration phase) — no
		// second lookup round-trip.
		if publicID.Valid {
			n := publicID.Int64
			it.PublicID = &n
		}
		if userPublicID.Valid {
			n := userPublicID.Int64
			it.UserPublicID = &n
		}

		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Author avatars honor private_hide_avatar for non-friends — on public
	// and private profiles alike. Only authors that actually carry an avatar
	// need the visibility lookup. Fail-closed on resolution errors.
	var feedViewerID string
	if s, ok := userID.(string); ok {
		feedViewerID = s
	}
	if err := stripFeedAuthorAvatars(h.db, feedViewerID, items); err != nil {
		return nil, err
	}

	metrics.App.FeedSQLObserved(time.Since(start))
	return items, nil
}

func nullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	return &ns.String
}

// stripFeedAuthorAvatars nils out the embedded author avatar of every feed
// item whose author hides it from the viewer (private_hide_avatar on a public
// or private profile; the author and mutual friends are exempt). Only items
// that actually carry an avatar trigger the visibility lookup, so an
// all-avatarless page issues no extra queries. Fail-closed: a resolution
// error is returned and the caller must abort rather than serve unfiltered.
func stripFeedAuthorAvatars(db *sql.DB, viewerID string, items []feedItem) error {
	avatarAuthorIDs := make([]string, 0, len(items))
	seenAuthors := make(map[string]struct{}, len(items))
	for i := range items {
		if items[i].Author == nil || items[i].Author.AvatarURL == nil {
			continue
		}
		id := ""
		if items[i].AuthorID != nil {
			id = *items[i].AuthorID
		}
		if id == "" {
			continue
		}
		if _, ok := seenAuthors[id]; !ok {
			seenAuthors[id] = struct{}{}
			avatarAuthorIDs = append(avatarAuthorIDs, id)
		}
	}
	if len(avatarAuthorIDs) == 0 {
		return nil
	}
	hidden, err := privacy.HiddenAvatarIDs(db, viewerID, avatarAuthorIDs)
	if err != nil {
		return err
	}
	for i := range items {
		if items[i].Author == nil || items[i].AuthorID == nil {
			continue
		}
		if hidden[*items[i].AuthorID] {
			items[i].Author.AvatarURL = nil
		}
	}
	return nil
}
