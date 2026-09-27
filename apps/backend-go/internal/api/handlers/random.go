package handlers

import (
	"database/sql"
	"math/rand"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// RandomHandler serves «Mr. рандомность»: a mixed handful of random public
// content — a thread, a wall post, a profile, a wall comment, a g-sub — for the
// feed sidebar. Everything returned is already public (private profiles/walls
// and private boards are excluded), so guests get the same block.
type RandomHandler struct {
	db *sql.DB
}

func NewRandomHandler(db *sql.DB) *RandomHandler {
	return &RandomHandler{db: db}
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
}

const (
	randomPerType = 3
	randomDefault = 6
	randomMax     = 20
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

	items := []randomItem{}
	items = append(items, h.randomThreads()...)
	items = append(items, h.randomWallPosts()...)
	items = append(items, h.randomProfiles()...)
	items = append(items, h.randomWallComments()...)
	items = append(items, h.randomGomosubs()...)

	rand.Shuffle(len(items), func(i, j int) { items[i], items[j] = items[j], items[i] })
	if len(items) > limit {
		items = items[:limit]
	}

	count := len(items)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: items, Count: &count})
}

func (h *RandomHandler) randomThreads() []randomItem {
	rows, err := h.db.Query(`
		SELECT t.id, COALESCE(t.title, ''), COALESCE(b.slug, ''), COALESCE(b.is_gomosub, false)
		FROM threads t
		LEFT JOIN boards b ON b.id = t.board_id
		WHERE t.channel_id IS NULL
		  AND NOT COALESCE(b.is_rules_board, false)
		  AND (t.board_id IS NULL OR COALESCE(b.visibility, 'public') <> 'private')
		  AND COALESCE(t.title, '') <> ''
		ORDER BY random()
		LIMIT $1`, randomPerType)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []randomItem{}
	for rows.Next() {
		var id, title, slug string
		var isGomosub bool
		if err := rows.Scan(&id, &title, &slug, &isGomosub); err != nil {
			continue
		}
		sublabel := "тема"
		if slug != "" {
			if isGomosub {
				sublabel = "g/" + slug
			} else {
				sublabel = slug
			}
		}
		out = append(out, randomItem{
			Type: "thread", ID: id, Label: title, Sublabel: sublabel,
			BoardSlug: slug, IsGomosub: isGomosub,
		})
	}
	return out
}

func (h *RandomHandler) randomWallPosts() []randomItem {
	rows, err := h.db.Query(`
		SELECT p.id, COALESCE(p.user_id::text, ''), COALESCE(p.content, ''),
		       COALESCE(u.username, ''), COALESCE(u.is_anonymous, false)
		FROM profile_wall_posts p
		JOIN users u ON u.id = p.author_id
		LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
		WHERE NOT COALESCE(ps.private_profile, false)
		  AND NOT COALESCE(ps.private_hide_wall, false)
		  AND COALESCE(p.content, '') <> ''
		  AND u.username NOT LIKE '\_\_%'
		ORDER BY random()
		LIMIT $1`, randomPerType)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := []randomItem{}
	for rows.Next() {
		var id, wallUserID, content, username string
		var isAnonymous bool
		if err := rows.Scan(&id, &wallUserID, &content, &username, &isAnonymous); err != nil {
			continue
		}
		sublabel := "пост на стене"
		if isAnonymous {
			sublabel = "Аноним · пост"
		} else if username != "" {
			sublabel = "@" + username
		}
		out = append(out, randomItem{
			Type: "wall_post", ID: id, Label: truncate(content, 90),
			Sublabel: sublabel, WallUserID: wallUserID, Username: username,
		})
	}
	return out
}

func (h *RandomHandler) randomProfiles() []randomItem {
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
		LIMIT $1`, randomPerType)
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

func (h *RandomHandler) randomWallComments() []randomItem {
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
		LIMIT $1`, randomPerType)
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

func (h *RandomHandler) randomGomosubs() []randomItem {
	rows, err := h.db.Query(`
		SELECT id, slug, COALESCE(name, '')
		FROM boards
		WHERE is_gomosub = true AND visibility = 'public'
		ORDER BY random()
		LIMIT $1`, randomPerType)
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
