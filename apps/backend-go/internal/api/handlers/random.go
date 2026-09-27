package handlers

import (
	"database/sql"
	"encoding/json"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

// RandomHandler serves «Mr. рандомность»: a mixed handful of random public
// content — a thread, a wall post, a profile, a wall comment, a g-sub — for the
// feed sidebar.
//
// `ORDER BY random()` is a full scan + sort, and this endpoint is public, so the
// pool of candidates is built at most once per TTL and cached in Redis; every
// request then just shuffles the cached pool (O(1), no DB work). The pool is
// refreshed lazily (first request after expiry, guarded by a short lock so a
// burst does not stampede the DB). Without Redis it falls back to building the
// pool per request.
type RandomHandler struct {
	db    *sql.DB
	redis *redis.Client
}

func NewRandomHandler(db *sql.DB, redisClient *redis.Client) *RandomHandler {
	return &RandomHandler{db: db, redis: redisClient}
}

// randomItem is one row of the random block. The frontend turns it into a link;
// `href` is intentionally not built here (routing lives in the app).
type randomItem struct {
	Type       string  `json:"type"` // thread | wall_post | profile | wall_comment | gomosub
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	Sublabel   string  `json:"sublabel,omitempty"`
	BoardSlug  string  `json:"board_slug,omitempty"`
	IsGomosub  bool    `json:"is_gomosub,omitempty"`
	WallUserID string  `json:"wall_user_id,omitempty"`
	PostID     string  `json:"post_id,omitempty"`
	Username   string  `json:"username,omitempty"`
	AvatarURL  *string `json:"avatar_url,omitempty"`
	// Media preview for the small square on the right of a thread/post row.
	ThumbURL  string `json:"thumb_url,omitempty"`
	MediaKind string `json:"media_kind,omitempty"` // "image" | "video"
}

const (
	// Candidates fetched per type when (re)building the cached pool.
	randomPoolPerType = 12
	randomDefault     = 6
	randomMax         = 20
	randomCacheTTL    = 5 * time.Minute
	randomLockTTL     = 30 * time.Second
	randomCacheKey    = "random:pool:v1"
	randomLockKey     = "random:pool:v1:lock"
)

// GetRandom godoc
// @Summary      Random public content for the sidebar
// @Tags         Random
// @Produce      json
// @Param        limit query int false "Max results (1-20)" default(6)
// @Router       /random [get]
func (h *RandomHandler) GetRandom(c *gin.Context) {
	limit := randomDefault
	if raw := c.Query("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= randomMax {
			limit = n
		}
	}

	items := h.pool(c)
	rand.Shuffle(len(items), func(i, j int) { items[i], items[j] = items[j], items[i] })
	if len(items) > limit {
		items = items[:limit]
	}

	count := len(items)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: items, Count: &count})
}

// pool returns the cached candidate pool, refreshing it on a miss.
func (h *RandomHandler) pool(c *gin.Context) []randomItem {
	if h.redis == nil {
		return h.buildPool()
	}
	ctx := c.Request.Context()

	if raw, err := h.redis.Get(ctx, randomCacheKey).Result(); err == nil && raw != "" {
		var cached []randomItem
		if json.Unmarshal([]byte(raw), &cached) == nil && len(cached) > 0 {
			return cached
		}
	}

	// Miss: only one request refreshes (short lock); the rest build directly so
	// they still answer without waiting on a full scan.
	locked, err := h.redis.SetNX(ctx, randomLockKey, "1", randomLockTTL).Result()
	if err == nil && locked {
		defer h.redis.Del(ctx, randomLockKey)
		items := h.buildPool()
		if data, mErr := json.Marshal(items); mErr == nil {
			h.redis.Set(ctx, randomCacheKey, data, randomCacheTTL)
		}
		return items
	}
	return h.buildPool()
}

// buildPool runs the (expensive) random sampling once per refresh.
func (h *RandomHandler) buildPool() []randomItem {
	items := []randomItem{}
	items = append(items, h.randomThreads(randomPoolPerType)...)
	items = append(items, h.randomWallPosts(randomPoolPerType)...)
	items = append(items, h.randomProfiles(randomPoolPerType)...)
	items = append(items, h.randomWallComments(randomPoolPerType)...)
	items = append(items, h.randomGomosubs(randomPoolPerType)...)
	return items
}

func (h *RandomHandler) randomThreads(n int) []randomItem {
	rows, err := h.db.Query(`
		SELECT t.id, COALESCE(t.title, ''), COALESCE(t.content, ''), COALESCE(b.slug, ''), COALESCE(b.is_gomosub, false),
		       t.image_url, t.image_urls, t.attachments
		FROM threads t
		LEFT JOIN boards b ON b.id = t.board_id
		WHERE t.channel_id IS NULL
		  AND NOT COALESCE(b.is_rules_board, false)
		  AND (t.board_id IS NULL OR COALESCE(b.visibility, 'public') <> 'private')
		ORDER BY random()
		LIMIT $1`, n)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []randomItem{}
	for rows.Next() {
		var id, title, content, slug string
		var isGomosub bool
		var imageURL sql.NullString
		var imageURLs, attachments []byte
		if err := rows.Scan(&id, &title, &content, &slug, &isGomosub, &imageURL, &imageURLs, &attachments); err != nil {
			continue
		}
		thumb, kind := mediaFromColumns(imageURL, imageURLs, attachments)
		label := title
		if strings.TrimSpace(label) == "" {
			label = truncate(content, 90)
		}
		if strings.TrimSpace(label) == "" && kind == "" {
			continue
		}
		label = placeholderFor(label, kind)
		sublabel := "тема"
		if slug != "" {
			if isGomosub {
				sublabel = "g/" + slug
			} else {
				sublabel = slug
			}
		}
		out = append(out, randomItem{
			Type: "thread", ID: id, Label: label, Sublabel: sublabel,
			BoardSlug: slug, IsGomosub: isGomosub, ThumbURL: thumb, MediaKind: kind,
		})
	}
	return out
}

func (h *RandomHandler) randomWallPosts(n int) []randomItem {
	rows, err := h.db.Query(`
		SELECT p.id, COALESCE(p.user_id::text, ''), COALESCE(p.content, ''),
		       COALESCE(u.username, ''), COALESCE(u.is_anonymous, false),
		       p.image_url, p.attachments
		FROM profile_wall_posts p
		JOIN users u ON u.id = p.author_id
		LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
		WHERE NOT COALESCE(ps.private_profile, false)
		  AND NOT COALESCE(ps.private_hide_wall, false)
		  AND u.username NOT LIKE '\_\_%'
		ORDER BY random()
		LIMIT $1`, n)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []randomItem{}
	for rows.Next() {
		var id, wallUserID, content, username string
		var isAnonymous bool
		var imageURL sql.NullString
		var attachments []byte
		if err := rows.Scan(&id, &wallUserID, &content, &username, &isAnonymous, &imageURL, &attachments); err != nil {
			continue
		}
		thumb, kind := mediaFromColumns(imageURL, nil, attachments)
		label := truncate(content, 90)
		if strings.TrimSpace(label) == "" && kind == "" {
			continue
		}
		label = placeholderFor(label, kind)
		sublabel := "пост на стене"
		if isAnonymous {
			sublabel = "Аноним · пост"
		} else if username != "" {
			sublabel = "@" + username
		}
		out = append(out, randomItem{
			Type: "wall_post", ID: id, Label: label,
			Sublabel: sublabel, WallUserID: wallUserID, Username: username,
			ThumbURL: thumb, MediaKind: kind,
		})
	}
	return out
}

func (h *RandomHandler) randomProfiles(n int) []randomItem {
	rows, err := h.db.Query(`
		SELECT u.id, COALESCE(u.username, ''), u.avatar_url
		FROM users u
		LEFT JOIN privacy_settings ps ON ps.user_id = u.id
		WHERE NOT COALESCE(ps.private_profile, false)
		  AND NOT COALESCE(u.is_anonymous, false)
		  AND u.id <> '00000000-0000-0000-0000-000000000000'
		  AND COALESCE(u.username, '') <> ''
		  AND u.username NOT LIKE '\_\_%'
		ORDER BY random()
		LIMIT $1`, n)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []randomItem{}
	for rows.Next() {
		var id, username string
		var avatar sql.NullString
		if err := rows.Scan(&id, &username, &avatar); err != nil {
			continue
		}
		out = append(out, randomItem{
			Type: "profile", ID: id, Label: username, Sublabel: "профиль",
			Username: username, AvatarURL: nullStringPtr(avatar),
		})
	}
	return out
}

func (h *RandomHandler) randomWallComments(n int) []randomItem {
	rows, err := h.db.Query(`
		SELECT c.id, COALESCE(c.post_id::text, ''), COALESCE(p.user_id::text, ''),
		       COALESCE(c.content, ''), COALESCE(u.username, ''), COALESCE(u.is_anonymous, false)
		FROM profile_wall_post_comments c
		JOIN profile_wall_posts p ON p.id = c.post_id
		JOIN users u ON u.id = c.user_id
		LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
		WHERE NOT COALESCE(ps.private_profile, false)
		  AND NOT COALESCE(ps.private_hide_wall, false)
		  AND NOT COALESCE(c.is_deleted, false)
		  AND COALESCE(c.content, '') <> ''
		  AND u.username NOT LIKE '\_\_%'
		ORDER BY random()
		LIMIT $1`, n)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []randomItem{}
	for rows.Next() {
		var id, postID, wallUserID, content, username string
		var isAnonymous bool
		if err := rows.Scan(&id, &postID, &wallUserID, &content, &username, &isAnonymous); err != nil {
			continue
		}
		sublabel := "комментарий"
		if isAnonymous {
			sublabel = "Аноним · комментарий"
		} else if username != "" {
			sublabel = "@" + username + " · комментарий"
		}
		out = append(out, randomItem{
			Type: "wall_comment", ID: id, Label: truncate(content, 90),
			Sublabel: sublabel, PostID: postID, WallUserID: wallUserID, Username: username,
		})
	}
	return out
}

func (h *RandomHandler) randomGomosubs(n int) []randomItem {
	rows, err := h.db.Query(`
		SELECT id, slug, COALESCE(name, '')
		FROM boards
		WHERE is_gomosub = true AND visibility = 'public'
		ORDER BY random()
		LIMIT $1`, n)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []randomItem{}
	for rows.Next() {
		var id, slug, name string
		if err := rows.Scan(&id, &slug, &name); err != nil {
			continue
		}
		out = append(out, randomItem{
			Type: "gomosub", ID: id, Label: "g/" + slug, Sublabel: name,
			BoardSlug: slug, IsGomosub: true,
		})
	}
	return out
}

// truncate keeps a random label short (runes, so Cyrillic counts correctly).
func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

// mediaFromColumns picks the first media of a thread/post for the small square:
// a compressed preview key for images (falling back to the original URL), or the
// video poster. Rich `attachments` win over the legacy image columns.
func mediaFromColumns(imageURL sql.NullString, imageURLs, attachments []byte) (thumb, kind string) {
	if len(attachments) > 0 {
		var list []struct {
			URL    string `json:"url"`
			Type   string `json:"type"`
			Poster string `json:"poster"`
			Meta   *struct {
				PreviewKey string `json:"preview_key"`
			} `json:"meta"`
		}
		if err := json.Unmarshal(attachments, &list); err == nil {
			for _, a := range list {
				switch a.Type {
				case "image":
					key := a.URL
					if a.Meta != nil && a.Meta.PreviewKey != "" {
						key = a.Meta.PreviewKey
					}
					if key != "" {
						return key, "image"
					}
				case "video":
					// The poster is the video's still frame — a perfect square thumb.
					return a.Poster, "video"
				}
			}
		}
	}
	if len(imageURLs) > 0 {
		var urls []string
		if err := json.Unmarshal(imageURLs, &urls); err == nil && len(urls) > 0 && urls[0] != "" {
			return urls[0], "image"
		}
	}
	if imageURL.Valid && imageURL.String != "" {
		return imageURL.String, "image"
	}
	return "", ""
}

// placeholderFor substitutes «Фото.» / «Видео.» when an item has media but no
// text of its own.
func placeholderFor(label, kind string) string {
	if strings.TrimSpace(label) != "" || kind == "" {
		return label
	}
	if kind == "video" {
		return "Видео."
	}
	return "Фото."
}
