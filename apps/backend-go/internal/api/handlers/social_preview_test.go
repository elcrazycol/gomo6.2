package handlers

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/redis/go-redis/v9"
)

// newOGContext creates a gin test context for a social-preview request with a
// crawler User-Agent, host and forwarded proto set.
func newOGContext(method, path, ua string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(method, path, nil)
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Host = "gomo6.wtf"
	// Deterministic per-IP rate-limit key: requests share one client IP so
	// budget exhaustion tests behave predictably.
	req.RemoteAddr = "203.0.113.10:1234"
	c.Request = req
	return c, w
}

func setupSocialPreview(t *testing.T) (*SocialPreviewHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})
	return NewSocialPreviewHandler(db), mock
}

func TestRenderRejectsNonCrawler(t *testing.T) {
	h, _ := setupSocialPreview(t)

	c, w := newOGContext(http.MethodGet, "/profile/u1/wall/p1", "Mozilla/5.0 (Macintosh) Chrome/120.0")
	h.Render(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for browser UA, got %d", w.Code)
	}
}

func TestRenderWallPostPublic(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.title, p.content, p.image_url, p.attachments,
       u.username, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
       COALESCE(ps.private_profile, false), COALESCE(ps.private_hide_wall, false),
       COALESCE(author_ps.private_hide_avatar, false)
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
LEFT JOIN privacy_settings author_ps ON author_ps.user_id = u.id
WHERE p.id = $1`)).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{
			"title", "content", "image_url", "attachments",
			"username", "display_name", "avatar_url", "private_profile", "private_hide_wall", "private_hide_avatar",
		}).AddRow(
			"Мой первый пост", "Смотрите, что я нашёл!", "/storage/v1/object/wall/u1/img.webp", nil,
			"alice", "Alice", "u1/avatar.webp", false, false, false,
		))

	c, w := newOGContext(http.MethodGet, "/profile/u1/wall/p1", "TelegramBot (like TwitterBot)")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		`<title>Мой первый пост</title>`,
		`property="og:title" content="Мой первый пост"`,
		`property="og:image" content="https://gomo6.wtf/og/wall/u1/img.webp"`,
		`property="og:url" content="https://gomo6.wtf/profile/u1/wall/p1"`,
		`name="twitter:card" content="summary_large_image"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q", want)
		}
	}
}

// A wall post whose only attachment is a video must emit og:video (playable
// preview for Telegram/WhatsApp) pointing at the public /og/wall proxy, plus
// the generated poster as og:image.
func TestRenderWallPostVideo(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.title, p.content, p.image_url, p.attachments,
       u.username, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
       COALESCE(ps.private_profile, false), COALESCE(ps.private_hide_wall, false),
       COALESCE(author_ps.private_hide_avatar, false)
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
LEFT JOIN privacy_settings author_ps ON author_ps.user_id = u.id
WHERE p.id = $1`)).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{
			"title", "content", "image_url", "attachments",
			"username", "display_name", "avatar_url", "private_profile", "private_hide_wall", "private_hide_avatar",
		}).AddRow(
			"Мой клип", "Смотрите видео!", nil,
			[]byte(`[{"url":"/storage/v1/object/wall/u1/clip.mp4","type":"video","mime":"video/mp4","poster":"/storage/v1/object/wall/u1/clip.mp4.poster.jpg"}]`),
			"alice", "Alice", "u1/avatar.webp", false, false, false,
		))

	c, w := newOGContext(http.MethodGet, "/profile/u1/wall/p1", "TelegramBot")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		`property="og:video" content="https://gomo6.wtf/og/wall/u1/clip.mp4"`,
		`property="og:video:secure_url" content="https://gomo6.wtf/og/wall/u1/clip.mp4"`,
		`property="og:video:type" content="video/mp4"`,
		`property="og:image" content="https://gomo6.wtf/og/wall/u1/clip.mp4.poster.jpg"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q", want)
		}
	}
}

func TestRenderWallPostPrivateDoesNotLeak(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.title, p.content, p.image_url, p.attachments,
       u.username, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
       COALESCE(ps.private_profile, false), COALESCE(ps.private_hide_wall, false),
       COALESCE(author_ps.private_hide_avatar, false)
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
LEFT JOIN privacy_settings author_ps ON author_ps.user_id = u.id
WHERE p.id = $1`)).
		WithArgs("p2").
		WillReturnRows(sqlmock.NewRows([]string{
			"title", "content", "image_url", "attachments",
			"username", "display_name", "avatar_url", "private_profile", "private_hide_wall", "private_hide_avatar",
		}).AddRow(
			"Секрет", "нельзя показывать", nil, nil,
			"alice", "Alice", "u1/avatar.webp", true, false, false,
		))

	c, w := newOGContext(http.MethodGet, "/profile/u1/wall/p2", "TelegramBot")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	if strings.Contains(body, "Секрет") || strings.Contains(body, "нельзя показывать") {
		t.Error("private wall post content leaked into the preview")
	}
	if !strings.Contains(body, "Эта запись доступна не всем") {
		t.Error("expected a neutral card for a private wall post")
	}
}

func TestRenderThread(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT t.title, t.content, t.image_url, t.image_urls, t.attachments,
       COALESCE(u.display_name, ''), COALESCE(u.username, ''), COALESCE(u.avatar_url, ''),
       COALESCE(b.visibility, 'public')
FROM threads t
LEFT JOIN users u ON u.id = t.user_id
LEFT JOIN boards b ON t.board_id = b.id
WHERE t.id = $1 AND b.slug = $2`)).
		WithArgs("t1", "my-sub").
		WillReturnRows(sqlmock.NewRows([]string{
			"title", "content", "image_url", "image_urls", "attachments",
			"display_name", "username", "avatar_url", "visibility",
		}).AddRow(
			"Как дела на планете?", "Тред про всё подряд", "/storage/v1/object/content/u1/thread.webp", nil, nil,
			"Alice", "alice", "u1/avatar.webp", "public",
		))

	c, w := newOGContext(http.MethodGet, "/g/my-sub/thread/t1", "Twitterbot/1.0")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		`property="og:title" content="Как дела на планете?"`,
		`property="og:image" content="https://gomo6.wtf/storage/v1/object/content/u1/thread.webp"`,
		`property="og:url" content="https://gomo6.wtf/g/my-sub/thread/t1"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q", want)
		}
	}
}

// A thread whose only attachment is a video gets og:video (public content
// bucket) with the poster as og:image.
func TestRenderThreadVideo(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT t.title, t.content, t.image_url, t.image_urls, t.attachments,
       COALESCE(u.display_name, ''), COALESCE(u.username, ''), COALESCE(u.avatar_url, ''),
       COALESCE(b.visibility, 'public')
FROM threads t
LEFT JOIN users u ON u.id = t.user_id
LEFT JOIN boards b ON t.board_id = b.id
WHERE t.id = $1 AND b.slug = $2`)).
		WithArgs("t1", "my-sub").
		WillReturnRows(sqlmock.NewRows([]string{
			"title", "content", "image_url", "image_urls", "attachments",
			"display_name", "username", "avatar_url", "visibility",
		}).AddRow(
			"Видео-тред", "Смотрим", nil, nil,
			[]byte(`[{"url":"u1/clip.mp4","type":"video","mime":"video/mp4","poster":"u1/clip.mp4.poster.jpg"}]`),
			"Alice", "alice", "u1/avatar.webp", "public",
		))

	c, w := newOGContext(http.MethodGet, "/g/my-sub/thread/t1", "Twitterbot/1.0")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		`property="og:video" content="https://gomo6.wtf/storage/v1/object/content/u1/clip.mp4"`,
		`property="og:video:type" content="video/mp4"`,
		`property="og:image" content="https://gomo6.wtf/storage/v1/object/content/u1/clip.mp4.poster.jpg"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q", want)
		}
	}
}

// Bare-key image references must resolve against the thread's own bucket
// (content), not the avatar bucket — regression for previews with 404 images.
func TestRenderThreadBareKeyImage(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT t.title, t.content, t.image_url, t.image_urls, t.attachments,
       COALESCE(u.display_name, ''), COALESCE(u.username, ''), COALESCE(u.avatar_url, ''),
       COALESCE(b.visibility, 'public')
FROM threads t
LEFT JOIN users u ON u.id = t.user_id
LEFT JOIN boards b ON t.board_id = b.id
WHERE t.id = $1 AND b.slug = $2`)).
		WithArgs("t1", "my-sub").
		WillReturnRows(sqlmock.NewRows([]string{
			"title", "content", "image_url", "image_urls", "attachments",
			"display_name", "username", "avatar_url", "visibility",
		}).AddRow(
			"Тред с картинкой", "Текст", "u1/photo.webp", nil, nil,
			"Alice", "alice", "u1/avatar.webp", "public",
		))

	c, w := newOGContext(http.MethodGet, "/g/my-sub/thread/t1", "Twitterbot/1.0")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	want := `property="og:image" content="https://gomo6.wtf/storage/v1/object/content/u1/photo.webp"`
	if !strings.Contains(w.Body.String(), want) {
		t.Errorf("bare-key thread image must resolve to the content bucket; missing %q", want)
	}
}

func TestRenderProfile(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COALESCE(u.display_name, ''), u.username, COALESCE(u.avatar_url, ''),
       COALESCE(u.bio, ''), COALESCE(u.is_anonymous, false),
       COALESCE(ps.private_profile, false), COALESCE(ps.private_hide_avatar, false)
FROM users u
LEFT JOIN privacy_settings ps ON ps.user_id = u.id
WHERE u.id = $1`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"display_name", "username", "avatar_url", "bio", "is_anonymous", "private_profile", "private_hide_avatar",
		}).AddRow(
			"", "alice", "u1/avatar.webp", "Люблю посты и треды", false, false, false,
		))

	c, w := newOGContext(http.MethodGet, "/profile/u1", "Discordbot/2.0")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		`property="og:title" content="@alice · gomo6"`,
		`property="og:description" content="Люблю посты и треды"`,
		`property="og:image" content="https://gomo6.wtf/storage/v1/object/post-images/u1/avatar.webp"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q", want)
		}
	}
}

func TestRenderBoard(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT name, COALESCE(description, ''), COALESCE(gomosub_avatar_url, ''),
       COALESCE(cover_image_url, ''), COALESCE(visibility, 'public')
FROM boards
WHERE slug = $1`)).
		WithArgs("my-sub").
		WillReturnRows(sqlmock.NewRows([]string{
			"name", "description", "gomosub_avatar_url", "cover_image_url", "visibility",
		}).AddRow(
			"My Sub", "Описание сообщества", "", "u1/cover.webp", "public",
		))

	c, w := newOGContext(http.MethodGet, "/g/my-sub", "WhatsApp/2.23")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		`property="og:title" content="My Sub · gomo6"`,
		`property="og:image" content="https://gomo6.wtf/storage/v1/object/post-images/u1/cover.webp"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q", want)
		}
	}
}

// Regression: the handler is mounted via router.NoRoute, and gin's serveError
// pre-sets writermem.status = 404 before invoking NoRoute handlers. A
// successful render must still return HTTP 200 — otherwise crawlers treat the
// preview as a missing page (404 + full body) and drop the card.
func TestRenderViaNoRouteReturns200(t *testing.T) {
	h, mock := setupSocialPreview(t)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.title, p.content, p.image_url, p.attachments,
       u.username, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
       COALESCE(ps.private_profile, false), COALESCE(ps.private_hide_wall, false),
       COALESCE(author_ps.private_hide_avatar, false)
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
LEFT JOIN privacy_settings author_ps ON author_ps.user_id = u.id
WHERE p.id = $1`)).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{
			"title", "content", "image_url", "attachments",
			"username", "display_name", "avatar_url", "private_profile", "private_hide_wall", "private_hide_avatar",
		}).AddRow(
			"Мой первый пост", "Смотрите, что я нашёл!", "/storage/v1/object/wall/u1/img.webp", nil,
			"alice", "Alice", "u1/avatar.webp", false, false, false,
		))

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.NoRoute(h.Render)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/profile/u1/wall/p1", nil)
	req.Header.Set("User-Agent", "TelegramBot (like TwitterBot)")
	req.Host = "gomo6.wtf"
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 via NoRoute, got %d (gin pre-sets 404 for NoRoute)", w.Code)
	}
	if !strings.Contains(w.Body.String(), `property="og:title" content="Мой первый пост"`) {
		t.Error("expected the wall post preview body")
	}
}

func TestRenderUnknownPath404(t *testing.T) {
	h, _ := setupSocialPreview(t)

	// A path that matches no SPA deep-link pattern — resolver returns nil
	// without touching the DB.
	c, w := newOGContext(http.MethodGet, "/something/else/here", "TelegramBot")
	h.Render(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestRenderIgnoresBackendPaths(t *testing.T) {
	h, _ := setupSocialPreview(t)

	c, w := newOGContext(http.MethodGet, "/api/v1/whatever", "TelegramBot")
	h.Render(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for API path, got %d", w.Code)
	}
}

func TestImageURL(t *testing.T) {
	c, _ := newOGContext(http.MethodGet, "/x", "TelegramBot")

	cases := []struct {
		name          string
		raw           string
		defaultBucket string
		want          string
	}{
		{"empty", "", "content", ""},
		{"absolute passthrough", "https://cdn.example/img.png", "content", "https://cdn.example/img.png"},
		{"public storage path", "/storage/v1/object/content/u1/a.webp", "content", "https://gomo6.wtf/storage/v1/object/content/u1/a.webp"},
		{"private wall rewritten", "/storage/v1/object/wall/u1/b.webp", "content", "https://gomo6.wtf/og/wall/u1/b.webp"},
		{"preview key stripped", "/storage/v1/object/wall/u1/c.webp.preview.jpg", "content", "https://gomo6.wtf/og/wall/u1/c.webp"},
		{"bare key with bucket", "u1/avatar.webp", "post-images", "https://gomo6.wtf/storage/v1/object/post-images/u1/avatar.webp"},
		{"bare wall key", "u1/img.webp", "wall", "https://gomo6.wtf/og/wall/u1/img.webp"},
		{"legacy absolute wall url", "https://cdn.example/storage/v1/object/wall/img1.jpg", "wall", "https://cdn.example/storage/v1/object/wall/img1.jpg"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := imageURL(c, tc.raw, tc.defaultBucket); got != tc.want {
				t.Errorf("imageURL(%q, %q) = %q, want %q", tc.raw, tc.defaultBucket, got, tc.want)
			}
		})
	}
}

func TestCleanTextAndTruncate(t *testing.T) {
	if got := cleanText("**жирный** и [ссылка](https://x.test) осталась"); got != "жирный и ссылка осталась" {
		t.Errorf("cleanText = %q", got)
	}
	if got := truncateRunes("абвгде", 4); got != "абв…" {
		t.Errorf("truncateRunes = %q", got)
	}
	if got := truncateRunes("коротко", 20); got != "коротко" {
		t.Errorf("truncateRunes should keep short strings, got %q", got)
	}
}

// The renderer's per-IP budget applies only to real crawler renders: the
// second crawler request from the same IP gets 429, while a browser (non-
// crawler) request 404s on the guard before the limiter is ever consulted.
func TestRenderRateLimited(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	h, _ := setupSocialPreview(t)
	h.SetRateLimiter(middleware.NewAuthRateLimiterWithPrefix("og", rdb, 1, time.Minute))

	// First crawler request: within budget → renders the default card.
	c1, w1 := newOGContext(http.MethodGet, "/", "TelegramBot")
	h.Render(c1)
	if w1.Code != http.StatusOK {
		t.Fatalf("expected 200 within budget, got %d", w1.Code)
	}

	// Second crawler request from the same IP → 429.
	c2, w2 := newOGContext(http.MethodGet, "/", "TelegramBot")
	h.Render(c2)
	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after budget exhausted, got %d", w2.Code)
	}

	// A browser UA must not be rate limited — the crawler guard fires first.
	c3, w3 := newOGContext(http.MethodGet, "/", "Mozilla/5.0 Chrome/120.0")
	h.Render(c3)
	if w3.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for non-crawler (limiter not consulted), got %d", w3.Code)
	}
}

// Without a limiter (e.g. before SetRateLimiter is wired) the renderer must
// keep working — fail open.
func TestRenderWithoutRateLimiter(t *testing.T) {
	h, _ := setupSocialPreview(t)

	c, w := newOGContext(http.MethodGet, "/", "TelegramBot")
	h.Render(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 without a limiter, got %d", w.Code)
	}
}

func TestIsSocialCrawler(t *testing.T) {
	for _, ua := range []string{"TelegramBot (like TwitterBot)", "Mozilla/5.0 WhatsApp/2.23", "Discordbot/2.0", "Slackbot-LinkExpanding"} {
		if !isSocialCrawler(ua) {
			t.Errorf("expected %q to be a social crawler", ua)
		}
	}
	for _, ua := range []string{"Mozilla/5.0 Chrome/120.0", "Googlebot/2.1", "YandexBot/3.0"} {
		if isSocialCrawler(ua) {
			t.Errorf("expected %q NOT to be a social crawler", ua)
		}
	}
}
