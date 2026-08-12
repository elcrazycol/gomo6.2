package handlers

import (
	"database/sql"
	"encoding/json"
	"html/template"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/middleware"
)

// ─────────────────────────────────────────────────────────────────────────────
// Social previews (Open Graph / Twitter Cards)
//
// The web app is a client-side React SPA, so every deep link (wall post,
// thread, profile, board) returns the same bare index.html with static meta
// tags. Link-preview crawlers (Telegram, WhatsApp, X/Twitter, Reddit, Discord,
// Slack, VK, LinkedIn, Facebook, iMessage…) do not execute JavaScript — they
// only read the server's response. This handler renders a full HTML page with
// per-content Open Graph + Twitter Card meta tags for those crawlers, so a
// shared link shows a rich card (title, description, image) instead of a blank
// preview, just like X/Reddit embeds.
//
// Caddy routes requests whose User-Agent matches a social crawler to the Go
// backend (see the Caddyfile @bot matcher). The handler is registered as the
// Gin NoRoute fallback, so it only ever sees paths the API router did not
// match — i.e. SPA deep links.
// ─────────────────────────────────────────────────────────────────────────────

// socialCrawlerUAs are User-Agent substrings of link-preview / social crawlers
// that need server-side OG tags. Deliberately excludes SEO crawlers (Googlebot,
// Bingbot, YandexBot, …) which render JavaScript and should keep getting the
// real SPA for indexing.
var socialCrawlerUAs = []string{
	"telegrambot", "twitterbot", "facebookexternalhit", "facebot", "discordbot",
	"slackbot", "slack-imgproxy", "vkshare", "vk.com", "linkedinbot", "whatsapp",
	"viber", "pinterest", "redditbot", "skypeuripreview", "snapchat", "applebot",
	"instagram", "embedly", "microsoftteams", "linbot", "yoozbot", "mj12bot",
	"dotbot", "duckduckbot", "bytespider", "petalbot", "telemetrie",
}

// isSocialCrawler reports whether the User-Agent belongs to a link-preview
// crawler (case-insensitive substring match).
func isSocialCrawler(ua string) bool {
	ua = strings.ToLower(ua)
	for _, c := range socialCrawlerUAs {
		if strings.Contains(ua, c) {
			return true
		}
	}
	return false
}

// isBackendPath reports whether the path belongs to the backend API surface.
// Such paths must never be handled by the OG renderer even when they reach
// NoRoute (defense in depth on top of the Caddy @bot matcher).
func isBackendPath(path string) bool {
	return strings.HasPrefix(path, "/api/") ||
		strings.HasPrefix(path, "/rest/") ||
		strings.HasPrefix(path, "/rpc/") ||
		strings.HasPrefix(path, "/storage/") ||
		strings.HasPrefix(path, "/oauth") ||
		strings.HasPrefix(path, "/federation/") ||
		strings.HasPrefix(path, "/.well-known/") ||
		strings.HasPrefix(path, "/docs/") ||
		path == "/ws" || strings.HasPrefix(path, "/ws/") ||
		path == "/health" || path == "/ready" || path == "/metrics"
}

// SocialPreviewHandler renders Open Graph pages for link-preview crawlers.
type SocialPreviewHandler struct {
	db          *sql.DB
	rateLimiter *middleware.AuthRateLimiter
}

func NewSocialPreviewHandler(db *sql.DB) *SocialPreviewHandler {
	return &SocialPreviewHandler{db: db}
}

// SetRateLimiter attaches a per-IP budget to the renderer. The limiter is
// consulted for every crawler request that passes the API-path guard — i.e.
// everything that reaches content resolution, including paths that 404 after
// the DB lookup (non-crawler traffic and API 404s never deplete it). Fail
// open when nil or when Redis is unavailable.
func (h *SocialPreviewHandler) SetRateLimiter(l *middleware.AuthRateLimiter) {
	h.rateLimiter = l
}

// ogMeta carries everything the OG page needs. All string fields are escaped
// by html/template on render; image/canonical URLs are absolutized in
// finalize().
type ogMeta struct {
	// Head meta
	Title       string
	Description string
	ImageURL    string
	ImageAlt    string
	URL         string // canonical absolute URL of the shared page
	Type        string // website | article | profile
	SiteName    string
	// Visible card body — for crawlers that render the page (Reddit, Slack,
	// iMessage) and for humans who land on the backend directly.
	AuthorName   string
	AuthorAvatar string
	BodyContent  string
	BodyImage    string
	BodyImageAlt string
	CTA          string
	// Storage bucket used to resolve bare-key image references (avatars live
	// in post-images, thread media in content, wall media in the private wall
	// bucket). Only consulted when the stored value is not already a URL.
	ImageBucket string
}

// defaultSiteMeta is the fallback card (root page, unknown content, private
// content whose details must not leak into cached previews).
func defaultSiteMeta(description string) *ogMeta {
	return &ogMeta{
		Title:       "gomo6",
		Description: description,
		Type:        "website",
		SiteName:    "gomo6",
		ImageURL:    "/photoes/gomo6.png",
		ImageAlt:    "gomo6",
		BodyContent: description,
		CTA:         "Открыть gomo6",
	}
}

// Render handles an unmatched GET/HEAD path for a social crawler: resolves the
// path to a content item, queries the DB and serves a complete HTML page with
// Open Graph / Twitter Card meta tags.
func (h *SocialPreviewHandler) Render(c *gin.Context) {
	// A plain c.Status(404) without a body never reaches the client in this
	// Gin version (WriteHeader is deferred until the first Write), so every
	// 404 path below writes an explicit body via c.String.
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.String(http.StatusNotFound, "Not found")
		return
	}
	// Only link-preview crawlers are served the OG page. Everything else that
	// somehow reaches NoRoute keeps the old 404 behaviour.
	if !isSocialCrawler(c.Request.UserAgent()) {
		c.String(http.StatusNotFound, "Not found")
		return
	}
	if isBackendPath(c.Request.URL.Path) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

	// Per-IP budget for the renderer itself. Each render runs 1–2 DB queries,
	// so unauthenticated spam (anyone can fake a crawler UA) must not be able
	// to hammer the database through deep-link URLs.
	if h.rateLimiter != nil {
		middleware.IPRateLimitMiddleware(h.rateLimiter)(c)
		if c.IsAborted() {
			return
		}
	}

	meta := h.resolve(c)
	if meta == nil {
		c.String(http.StatusNotFound, "Not found")
		return
	}
	meta.finalize(c)

	// This handler is registered via router.NoRoute. Gin's serveError sets
	// writermem.status = 404 BEFORE invoking NoRoute handlers and only
	// flushes it on the first Write — so a successful render used to ship as
	// "404 + full OG body", which link-preview crawlers treat as a missing
	// page and drop the card. Override the status explicitly before writing.
	c.Status(http.StatusOK)
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=900")
	if err := ogPageTemplate.Execute(c.Writer, meta); err != nil {
		c.String(http.StatusInternalServerError, "Internal error")
	}
}

// resolve maps the request path to an ogMeta card.
func (h *SocialPreviewHandler) resolve(c *gin.Context) *ogMeta {
	path := strings.TrimSuffix(c.Request.URL.Path, "/")
	if path == "" {
		path = "/"
	}
	segs := splitPath(path)
	switch {
	case path == "/":
		return defaultSiteMeta("gomo6 — социальная сеть с мессенджером, досками и обсуждениями.")
	case len(segs) >= 4 && segs[0] == "profile" && segs[2] == "wall":
		// /profile/:userId/wall/:postId
		return h.resolveWallPost(c, segs[3])
	case len(segs) >= 2 && segs[0] == "profile":
		// /profile/:userId
		return h.resolveProfile(c, segs[1])
	}

	// Thread deep links:
	//   /g/:slug/thread/:threadId
	//   /g/:slug/c/:channelSlug/thread/:threadId
	//   /:slug/thread/:threadId
	var slug, threadID string
	switch {
	case len(segs) >= 4 && segs[0] == "g" && segs[2] == "thread":
		slug, threadID = segs[1], segs[3]
	case len(segs) >= 6 && segs[0] == "g" && segs[2] == "c" && segs[4] == "thread":
		slug, threadID = segs[1], segs[5]
	case len(segs) >= 3 && segs[1] == "thread":
		slug, threadID = segs[0], segs[2]
	}
	if threadID != "" {
		return h.resolveThread(c, slug, threadID)
	}

	// Board deep links:
	//   /g/:slug  and  /g/:slug/c/:channelSlug
	if len(segs) >= 2 && segs[0] == "g" && (len(segs) == 2 || (len(segs) == 4 && segs[2] == "c")) {
		return h.resolveBoard(c, segs[1])
	}
	// /:slug — legacy board path (only when the slug resolves to a real board;
	// reserved app routes like /auth, /settings are declared before Board in
	// the SPA, so matching a DB row is the safe discriminator here).
	if len(segs) == 1 {
		if meta := h.resolveBoard(c, segs[0]); meta != nil {
			return meta
		}
	}
	return nil
}

// ── Content resolvers ────────────────────────────────────────────────────────

// resolveWallPost renders the card for /profile/:userId/wall/:postId.
func (h *SocialPreviewHandler) resolveWallPost(c *gin.Context, postID string) *ogMeta {
	const q = `
SELECT p.title, p.content, p.image_url, p.attachments,
       u.username, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
       COALESCE(ps.private_profile, false), COALESCE(ps.private_hide_wall, false),
       COALESCE(author_ps.private_hide_avatar, false)
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
LEFT JOIN privacy_settings author_ps ON author_ps.user_id = u.id
WHERE p.id = $1`

	var title, content, imageURL, authorAvatar sql.NullString
	var attachments []byte
	var username, displayName string
	var privateProfile, hideWall, hideAuthorAvatar bool
	err := h.db.QueryRowContext(c.Request.Context(), q, postID).Scan(
		&title, &content, &imageURL, &attachments,
		&username, &displayName, &authorAvatar,
		&privateProfile, &hideWall, &hideAuthorAvatar,
	)
	if err != nil {
		return nil
	}

	// Private wall (private_profile or hidden wall): never leak content or
	// images into cached previews — show a neutral card instead.
	if privateProfile || hideWall {
		m := defaultSiteMeta("Эта запись доступна не всем. Открой gomo6, чтобы посмотреть.")
		m.CTA = "Открыть в gomo6"
		return m
	}

	author := displayName
	if author == "" {
		author = username
	}
	if author == "" {
		author = "Пользователь"
	}

	meta := &ogMeta{
		Title:        firstNonEmpty(title.String, author+" · запись на стене"),
		Description:  content.String,
		ImageAlt:     firstNonEmpty(title.String, "Запись на стене"),
		Type:         "article",
		SiteName:     "gomo6",
		AuthorName:   author,
		AuthorAvatar: authorAvatar.String,
		BodyContent:  content.String,
		CTA:          "Открыть запись",
		ImageBucket:  "wall",
	}
	if hideAuthorAvatar {
		// Respect the author's private_hide_avatar toggle in the card header.
		meta.AuthorAvatar = ""
	}
	if img := firstImageFromAttachments(attachments); img != "" {
		meta.ImageURL = img
	} else {
		meta.ImageURL = imageURL.String
	}
	return meta
}

// resolveProfile renders the card for /profile/:userId.
func (h *SocialPreviewHandler) resolveProfile(c *gin.Context, userID string) *ogMeta {
	const q = `
SELECT COALESCE(u.display_name, ''), u.username, COALESCE(u.avatar_url, ''),
       COALESCE(u.bio, ''), COALESCE(u.is_anonymous, false),
       COALESCE(ps.private_profile, false), COALESCE(ps.private_hide_avatar, false)
FROM users u
LEFT JOIN privacy_settings ps ON ps.user_id = u.id
WHERE u.id = $1`

	var displayName, username, avatarURL, bio string
	var isAnonymous, privateProfile, hideAvatar bool
	err := h.db.QueryRowContext(c.Request.Context(), q, userID).Scan(
		&displayName, &username, &avatarURL, &bio, &isAnonymous,
		&privateProfile, &hideAvatar,
	)
	if err != nil {
		return nil
	}

	if privateProfile {
		m := defaultSiteMeta("Этот профиль закрыт — посмотреть могут только избранные пользователи.")
		m.CTA = "Открыть в gomo6"
		return m
	}

	name := displayName
	if name == "" {
		name = "@" + username
	}
	meta := &ogMeta{
		Title:       name + " · gomo6",
		Description: bio,
		ImageAlt:    name,
		Type:        "profile",
		SiteName:    "gomo6",
		AuthorName:  name,
		BodyContent: bio,
		CTA:         "Открыть профиль",
	}
	if !hideAvatar {
		meta.ImageURL = avatarURL
		meta.AuthorAvatar = avatarURL
	}
	return meta
}

// resolveThread renders the card for /…/thread/:threadId.
func (h *SocialPreviewHandler) resolveThread(c *gin.Context, slug, threadID string) *ogMeta {
	const q = `
SELECT t.title, t.content, t.image_url, t.image_urls, t.attachments,
       COALESCE(u.display_name, ''), COALESCE(u.username, ''), COALESCE(u.avatar_url, ''),
       COALESCE(b.visibility, 'public')
FROM threads t
LEFT JOIN users u ON u.id = t.user_id
LEFT JOIN boards b ON t.board_id = b.id
WHERE t.id = $1 AND b.slug = $2`

	var title, content, imageURL, authorAvatar sql.NullString
	var imageURLs, attachments []byte
	var displayName, username string
	var boardVisibility string
	err := h.db.QueryRowContext(c.Request.Context(), q, threadID, slug).Scan(
		&title, &content, &imageURL, &imageURLs, &attachments,
		&displayName, &username, &authorAvatar, &boardVisibility,
	)
	if err != nil {
		return nil
	}

	if boardVisibility == "private" {
		m := defaultSiteMeta("Это сообщество закрытое. Открой gomo6, чтобы посмотреть.")
		m.CTA = "Открыть в gomo6"
		return m
	}

	author := displayName
	if author == "" {
		author = username
	}
	meta := &ogMeta{
		Title:        firstNonEmpty(title.String, "Обсуждение на gomo6"),
		Description:  content.String,
		ImageAlt:     firstNonEmpty(title.String, "Обсуждение"),
		Type:         "article",
		SiteName:     "gomo6",
		AuthorName:   author,
		AuthorAvatar: authorAvatar.String,
		BodyContent:  content.String,
		CTA:          "Открыть обсуждение",
		ImageBucket:  "content",
	}
	meta.ImageURL = firstImageCandidate(imageURL.String, imageURLs, attachments)
	return meta
}

// resolveBoard renders the card for /g/:slug (and /:slug).
func (h *SocialPreviewHandler) resolveBoard(c *gin.Context, slug string) *ogMeta {
	const q = `
SELECT name, COALESCE(description, ''), COALESCE(gomosub_avatar_url, ''),
       COALESCE(cover_image_url, ''), COALESCE(visibility, 'public')
FROM boards
WHERE slug = $1`

	var name, description, avatarURL, coverURL, visibility string
	err := h.db.QueryRowContext(c.Request.Context(), q, slug).Scan(&name, &description, &avatarURL, &coverURL, &visibility)
	if err != nil {
		return nil
	}
	if visibility == "private" {
		m := defaultSiteMeta("Это сообщество закрытое. Открой gomo6, чтобы посмотреть.")
		m.CTA = "Открыть в gomo6"
		return m
	}
	meta := &ogMeta{
		Title:        name + " · gomo6",
		Description:  description,
		ImageAlt:     name,
		Type:         "website",
		SiteName:     "gomo6",
		AuthorName:   name,
		AuthorAvatar: avatarURL,
		BodyContent:  description,
		CTA:          "Открыть сообщество",
	}
	meta.ImageURL = firstNonEmpty(coverURL, avatarURL)
	return meta
}

// ── Image extraction helpers ─────────────────────────────────────────────────

// attachmentMeta mirrors the frontend AttachmentMeta shape (a subset of the
// JSONB `attachments` column).
type attachmentMeta struct {
	URL  string `json:"url"`
	Type string `json:"type"`
	Mime string `json:"mime"`
}

// firstImageFromAttachments returns the URL of the first image attachment, or
// "" when there are none.
func firstImageFromAttachments(raw []byte) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var atts []attachmentMeta
	if err := json.Unmarshal(raw, &atts); err != nil {
		return ""
	}
	for _, a := range atts {
		if a.Type == "image" || strings.HasPrefix(strings.ToLower(a.Mime), "image/") {
			if u := strings.TrimSpace(a.URL); u != "" {
				return u
			}
		}
	}
	return ""
}

// firstImageCandidate picks the first usable image URL from the thread's
// attachment list, then image_urls, then the legacy single image_url.
func firstImageCandidate(legacy string, imageURLs, attachments []byte) string {
	if img := firstImageFromAttachments(attachments); img != "" {
		return img
	}
	if len(imageURLs) > 0 && string(imageURLs) != "null" {
		var urls []string
		if err := json.Unmarshal(imageURLs, &urls); err == nil {
			for _, u := range urls {
				if strings.TrimSpace(u) != "" {
					return u
				}
			}
		}
	}
	return legacy
}

// ── URL / text normalization ────────────────────────────────────────────────

// absoluteURL makes an absolute URL from a site-relative path. Crawler requests
// arrive via Caddy, which preserves the Host header and sets
// X-Forwarded-Proto.
func absoluteURL(c *gin.Context, path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	scheme := "http"
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		scheme = strings.Split(proto, ",")[0]
	} else if c.Request.TLS != nil {
		scheme = "https"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return scheme + "://" + c.Request.Host + path
}

// imageURL normalizes a stored image reference to an absolute, crawler-fetchable
// URL. References in the private `wall` bucket are rewritten to the public OG
// proxy (/og/wall/<key>), which enforces the same wall-visibility predicate as
// the app itself. defaultBucket is used only for bare keys (e.g. avatars).
func imageURL(c *gin.Context, raw, defaultBucket string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	if i := strings.Index(raw, "/storage/v1/object/"); i >= 0 {
		rest := raw[i+len("/storage/v1/object/"):]
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) == 2 {
			bucket, key := parts[0], strings.TrimSuffix(parts[1], ".preview.jpg")
			if bucket == "wall" || bucket == "uploads" {
				return absoluteURL(c, "/og/wall/"+key)
			}
			return absoluteURL(c, "/storage/v1/object/"+bucket+"/"+key)
		}
	}
	if strings.HasPrefix(raw, "/") {
		return absoluteURL(c, raw)
	}
	key := strings.TrimSuffix(strings.TrimPrefix(raw, "/"), ".preview.jpg")
	if defaultBucket == "wall" {
		return absoluteURL(c, "/og/wall/"+key)
	}
	return absoluteURL(c, "/storage/v1/object/"+defaultBucket+"/"+key)
}

// finalize absolutizes URLs, cleans the description and fills defaults.
func (m *ogMeta) finalize(c *gin.Context) {
	m.Title = truncateRunes(cleanText(m.Title), 70)
	m.Description = truncateRunes(cleanText(m.Description), 200)
	m.BodyContent = truncateRunes(cleanText(m.BodyContent), 600)
	m.URL = absoluteURL(c, c.Request.URL.Path)
	if m.ImageBucket == "" {
		m.ImageBucket = "post-images"
	}
	m.ImageURL = imageURL(c, m.ImageURL, m.ImageBucket)
	m.BodyImage = m.ImageURL
	m.BodyImageAlt = m.ImageAlt
	m.AuthorAvatar = imageURL(c, m.AuthorAvatar, "post-images")

	if m.SiteName == "" {
		m.SiteName = "gomo6"
	}
	if m.Type == "" {
		m.Type = "website"
	}
	if m.CTA == "" {
		m.CTA = "Открыть в gomo6"
	}
	if m.Description == "" {
		m.Description = "gomo6 — социальная сеть с мессенджером, досками и обсуждениями."
	}
	if m.ImageAlt == "" {
		m.ImageAlt = m.Title
	}
}

// markdownishPattern strips the common markup symbols rich-text editors leave
// in the plain-text fallback: links keep their label, code ticks and emphasis
// markers are removed.
var markdownishPattern = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)|` + "`" + `|` + "```" + `|(\*\*|__|\*|_|~~|#+ |> )`)

func cleanText(s string) string {
	s = markdownishPattern.ReplaceAllString(s, "$1")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimSpace(s)
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	if max <= 0 {
		return ""
	}
	return string(runes[:max-1]) + "…"
}

func splitPath(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// ── HTML template ────────────────────────────────────────────────────────────

var ogPageTemplate = template.Must(template.New("og-page").Parse(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
<meta name="description" content="{{.Description}}">
<link rel="canonical" href="{{.URL}}">

<meta property="og:type" content="{{.Type}}">
<meta property="og:site_name" content="{{.SiteName}}">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.URL}}">
{{if .ImageURL}}<meta property="og:image" content="{{.ImageURL}}">
<meta property="og:image:alt" content="{{.ImageAlt}}">{{end}}

<meta name="twitter:card" content="{{if .ImageURL}}summary_large_image{{else}}summary{{end}}">
<meta name="twitter:title" content="{{.Title}}">
<meta name="twitter:description" content="{{.Description}}">
{{if .ImageURL}}<meta name="twitter:image" content="{{.ImageURL}}">{{end}}

<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #0e1512; color: #e7efe9;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 16px;
  }
  .card {
    max-width: 560px; width: 100%;
    background: #16211b; border: 1px solid #26382e;
    border-radius: 16px; overflow: hidden;
  }
  {{if .BodyImage}}.card-img { width: 100%; max-height: 320px; object-fit: cover; display: block; border-bottom: 1px solid #26382e; }{{end}}
  .card-body { padding: 20px 22px 22px; }
  .card-author { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  {{if .AuthorAvatar}}.card-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: #26382e; }{{end}}
  .card-author-name { font-weight: 600; font-size: 14px; color: #a9c7b4; }
  .card-title { font-size: 19px; font-weight: 700; line-height: 1.35; margin-bottom: 8px; }
  {{if .BodyContent}}.card-text { font-size: 14px; line-height: 1.6; color: #c6d4cb; white-space: pre-wrap; word-break: break-word; }{{end}}
  .card-cta {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 14px; padding: 9px 16px;
    background: #1f9d55; color: #ffffff; border-radius: 999px;
    font-size: 14px; font-weight: 600; text-decoration: none;
  }
  .card-cta:hover { background: #26b562; }
</style>
</head>
<body>
  <div class="card">
    {{if .BodyImage}}<img class="card-img" src="{{.BodyImage}}" alt="{{.BodyImageAlt}}">{{end}}
    <div class="card-body">
      <div class="card-author">
        {{if .AuthorAvatar}}<img class="card-avatar" src="{{.AuthorAvatar}}" alt="">{{end}}
        <span class="card-author-name">{{.AuthorName}}</span>
      </div>
      {{if .Title}}<div class="card-title">{{.Title}}</div>{{end}}
      {{if .BodyContent}}<div class="card-text">{{.BodyContent}}</div>{{end}}
      <a class="card-cta" href="{{.URL}}">{{.CTA}} →</a>
    </div>
  </div>
</body>
</html>`))
