package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// newTestRouter builds the full route table the way main does, but with a
// sqlmock-backed DB, nil Redis (all rate limiters fail open) and optionally
// the WebSocket hub. SetupRoutes must never panic in this configuration.
func newTestRouter(t *testing.T, withHub bool) *gin.Engine {
	return newTestRouterWithRedis(t, withHub, nil)
}

// newTestRouterWithRedis is newTestRouter but with a real (miniredis-backed)
// Redis client so rate-limit paths can be exercised end to end.
func newTestRouterWithRedis(t *testing.T, withHub bool, rdb *redis.Client) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("JWT_SECRET", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	// Neutralize S3 config so SetupRoutes deterministically ends up with a nil
	// storageHandler (smoke tests rely on the 501 "Storage not available" path).
	t.Setenv("GARAGE_S3_ENDPOINT", "")
	t.Setenv("GARAGE_S3_ACCESS_KEY", "")
	t.Setenv("GARAGE_S3_SECRET_KEY", "")

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to start sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	var hub *websocket.Hub
	if withHub {
		hub = websocket.NewHub(nil, nil)
	}

	router := gin.New()
	SetupRoutes(router, db, rdb, hub)
	return router
}

// expectedRoutes mirrors every registration in SetupRoutes (nil hub variant).
// Keep in sync when endpoints are added or removed — the test below fails on
// both missing and unexpected routes.
var expectedRoutes = []string{
	// Top-level
	"GET /ready",
	"GET /api/v1/metrics",
	"GET /api/v1/docs/json",
	"POST /api/v1/audio/metadata",
	"GET /api/v1/test-auth",

	// Auth
	"POST /api/v1/auth/register",
	"POST /api/v1/auth/login",
	"POST /api/v1/auth/refresh",
	"POST /api/v1/auth/logout",
	"GET /api/v1/auth/me",
	"POST /api/v1/auth/password",
	"POST /api/v1/auth/2fa/setup",
	"POST /api/v1/auth/2fa/verify-and-enable",
	"POST /api/v1/auth/2fa/disable",
	"GET /api/v1/auth/2fa/status",
	"POST /api/v1/auth/verify-2fa",
	"GET /api/v1/auth/webauthn/login/begin",
	"POST /api/v1/auth/webauthn/login/finish",
	"POST /api/v1/auth/webauthn/register/begin",
	"POST /api/v1/auth/webauthn/register/finish",
	"GET /api/v1/auth/webauthn/credentials",
	"DELETE /api/v1/auth/webauthn/credentials/:credentialId",
	"GET /api/v1/auth/sessions",
	"DELETE /api/v1/auth/sessions",
	"DELETE /api/v1/auth/sessions/:id",

	// Public REST
	"GET /api/v1/search",
	"GET /api/v1/feed",
	"GET /api/v1/profiles",
	"GET /api/v1/profiles/:id",
	"GET /api/v1/boards",
	"GET /api/v1/boards/:id",
	"GET /api/v1/threads",
	"GET /api/v1/threads/:id",
	"GET /api/v1/posts",
	"GET /api/v1/posts/:id",
	"GET /api/v1/invites/:code",
	"GET /api/v1/users/online",
	"GET /api/v1/users/:id/status",
	"POST /api/v1/users/status/bulk",
	"GET /api/v1/users/:id/privacy",
	"GET /api/v1/gift_catalog",
	"GET /api/v1/user_gifts",
	"POST /api/v1/client-errors",
	"GET /api/v1/translations",
	"GET /api/v1/drops/packages",
	"POST /api/v1/drops/config",
	"POST /api/v1/drops/callback",

	// Universal CRUD tables (static + wildcard, all methods)
	"GET /api/v1/user_roles",
	"GET /api/v1/user_roles/*path",
	"GET /api/v1/gomosub_memberships",
	"GET /api/v1/gomosub_memberships/*path",
	"GET /api/v1/channels",
	"GET /api/v1/channels/*path",
	"GET /api/v1/gomosub_roles",
	"GET /api/v1/gomosub_roles/*path",
	"GET /api/v1/channel_permissions",
	"GET /api/v1/channel_permissions/*path",
	"GET /api/v1/user_session_time",
	"GET /api/v1/user_session_time/*path",
	"POST /api/v1/user_session_time",
	"POST /api/v1/user_session_time/*path",
	"PUT /api/v1/user_session_time",
	"PUT /api/v1/user_session_time/*path",
	"GET /api/v1/user_achievements",
	"GET /api/v1/user_achievements/*path",
	"GET /api/v1/achievements",
	"GET /api/v1/achievements/*path",
	"GET /api/v1/user_terms_acceptance",
	"GET /api/v1/user_terms_acceptance/*path",
	"POST /api/v1/user_terms_acceptance",
	"POST /api/v1/user_terms_acceptance/*path",
	"GET /api/v1/profile_customization",
	"GET /api/v1/profile_customization/*path",
	"POST /api/v1/profile_customization",
	"POST /api/v1/profile_customization/*path",
	"GET /api/v1/user_placeholders",
	"GET /api/v1/user_placeholders/*path",
	"GET /api/v1/polls",
	"GET /api/v1/polls/*path",
	"GET /api/v1/poll_votes",
	"GET /api/v1/poll_votes/*path",
	"GET /api/v1/thread_subscriptions",
	"GET /api/v1/thread_subscriptions/*path",
	"GET /api/v1/privacy_settings",
	"GET /api/v1/privacy_settings/*path",
	"PUT /api/v1/privacy_settings",
	"PUT /api/v1/privacy_settings/*path",
	"POST /api/v1/privacy_settings",
	"POST /api/v1/privacy_settings/*path",
	"GET /api/v1/user_daily_visits",
	"GET /api/v1/user_daily_visits/*path",
	"POST /api/v1/user_daily_visits",
	"POST /api/v1/user_daily_visits/*path",
	"PUT /api/v1/user_daily_visits",
	"PUT /api/v1/user_daily_visits/*path",
	"GET /api/v1/thread_custom_message_visits",
	"GET /api/v1/thread_custom_message_visits/*path",
	"POST /api/v1/thread_custom_message_visits",
	"POST /api/v1/thread_custom_message_visits/*path",
	"PUT /api/v1/thread_custom_message_visits",
	"PUT /api/v1/thread_custom_message_visits/*path",
	"GET /api/v1/profile_wall_posts",
	"GET /api/v1/profile_wall_posts/*path",
	"POST /api/v1/profile_wall_posts",
	"POST /api/v1/profile_wall_posts/*path",
	"PUT /api/v1/profile_wall_posts",
	"PUT /api/v1/profile_wall_posts/*path",
	"DELETE /api/v1/profile_wall_posts",
	"DELETE /api/v1/profile_wall_posts/*path",
	"GET /api/v1/profile_wall_post_comments",
	"GET /api/v1/profile_wall_post_comments/*path",
	"POST /api/v1/profile_wall_post_comments",
	"POST /api/v1/profile_wall_post_comments/*path",
	"PUT /api/v1/profile_wall_post_comments",
	"PUT /api/v1/profile_wall_post_comments/*path",
	"DELETE /api/v1/profile_wall_post_comments",
	"DELETE /api/v1/profile_wall_post_comments/*path",
	"GET /api/v1/profile_wall_post_likes",
	"GET /api/v1/profile_wall_post_likes/*path",
	"POST /api/v1/profile_wall_post_likes",
	"POST /api/v1/profile_wall_post_likes/*path",
	"PUT /api/v1/profile_wall_post_likes",
	"PUT /api/v1/profile_wall_post_likes/*path",
	"DELETE /api/v1/profile_wall_post_likes",
	"DELETE /api/v1/profile_wall_post_likes/*path",
	"GET /api/v1/profile_wall_post_reposts",
	"GET /api/v1/profile_wall_post_reposts/*path",
	"POST /api/v1/profile_wall_post_reposts",
	"POST /api/v1/profile_wall_post_reposts/*path",
	"PUT /api/v1/profile_wall_post_reposts",
	"PUT /api/v1/profile_wall_post_reposts/*path",
	"DELETE /api/v1/profile_wall_post_reposts",
	"DELETE /api/v1/profile_wall_post_reposts/*path",
	"GET /api/v1/profile_wall_comment_likes",
	"GET /api/v1/profile_wall_comment_likes/*path",
	"POST /api/v1/profile_wall_comment_likes",
	"POST /api/v1/profile_wall_comment_likes/*path",
	"PUT /api/v1/profile_wall_comment_likes",
	"PUT /api/v1/profile_wall_comment_likes/*path",
	"DELETE /api/v1/profile_wall_comment_likes",
	"DELETE /api/v1/profile_wall_comment_likes/*path",
	"GET /api/v1/gomosub_invites",
	"GET /api/v1/gomosub_invites/*path",
	"GET /api/v1/gomosub_rules_acceptance",
	"GET /api/v1/gomosub_rules_acceptance/*path",
	"POST /api/v1/gomosub_rules_acceptance",
	"POST /api/v1/gomosub_rules_acceptance/*path",
	"PUT /api/v1/gomosub_rules_acceptance",
	"PUT /api/v1/gomosub_rules_acceptance/*path",
	"GET /api/v1/user_settings_changes",
	"GET /api/v1/user_settings_changes/*path",
	"GET /api/v1/emoji_packs/by-slug/:slug",
	"POST /api/v1/custom_emojis/resolve",
	"GET /api/v1/emoji_packs",
	"GET /api/v1/custom_emojis",
	"GET /api/v1/user_emoji_subscriptions",
	"POST /api/v1/emoji_packs",
	"PUT /api/v1/emoji_packs",
	"PUT /api/v1/emoji_packs/*path",
	"DELETE /api/v1/emoji_packs",
	"DELETE /api/v1/emoji_packs/*path",
	"POST /api/v1/custom_emojis",
	"PUT /api/v1/custom_emojis",
	"PUT /api/v1/custom_emojis/*path",
	"DELETE /api/v1/custom_emojis",
	"DELETE /api/v1/custom_emojis/*path",
	"POST /api/v1/user_emoji_subscriptions",
	"DELETE /api/v1/user_emoji_subscriptions",

	// Protected REST
	"POST /api/v1/profiles",
	"PUT /api/v1/profiles/:id",
	"POST /api/v1/boards",
	"PUT /api/v1/boards/:id",
	"POST /api/v1/boards/:id/invites",
	"GET /api/v1/boards/:id/invites",
	"DELETE /api/v1/boards/:id/invites/:inviteId",
	"POST /api/v1/invites/:code/accept",
	"PUT /api/v1/threads/:id",
	"PUT /api/v1/threads",
	"PUT /api/v1/posts/:id",
	"PUT /api/v1/posts",
	"DELETE /api/v1/threads",
	"DELETE /api/v1/posts",
	"GET /api/v1/boards/:id/backup/export",
	"POST /api/v1/boards/backup/import",
	"POST /api/v1/boards/import/info",
	"POST /api/v1/threads/:id/like",
	"DELETE /api/v1/threads/:id/like",
	"POST /api/v1/posts/:id/like",
	"DELETE /api/v1/posts/:id/like",
	"DELETE /api/v1/posts/:id",
	"GET /api/v1/threads/:id/likes",
	"GET /api/v1/notifications",
	"GET /api/v1/notifications/:id",
	"PUT /api/v1/notifications/:id/read",
	"PUT /api/v1/notifications/read-all",
	"GET /api/v1/notifications/unread-count",
	"POST /api/v1/gifts/send",
	"POST /api/v1/translations",
	"POST /api/v1/translations/:id/vote",
	"DELETE /api/v1/translations/:id",
	"GET /api/v1/user/drops",
	"GET /api/v1/drops/history",
	"POST /api/v1/drops/manual-verify",
	"GET /api/v1/drops/wallet",
	"POST /api/v1/drops/transfer",
	"GET /api/v1/drops/users/search",
	"GET /api/v1/admin/gifts",
	"POST /api/v1/admin/gifts",
	"PUT /api/v1/admin/gifts/:id",
	"DELETE /api/v1/admin/gifts/:id",
	"GET /api/v1/admin/gifts/:id/layers",
	"POST /api/v1/admin/gifts/:id/layers",
	"DELETE /api/v1/admin/gifts/:id/layers/:layerId",
	"POST /api/v1/gifts/:giftRecordID/upgrade",
	"GET /api/v1/messenger/unread-count",
	"GET /api/v1/messenger/conversations",
	"GET /api/v1/messenger/conversations/:id/messages",
	"GET /api/v1/messenger/conversations/:id/receipts",
	"POST /api/v1/messenger/conversations",
	"POST /api/v1/messenger/notes",
	"POST /api/v1/messenger/conversations/:id/messages",
	"PUT /api/v1/messenger/conversations/:id/messages/:msgId",
	"PUT /api/v1/messenger/conversations/:id/messages/:msgId/notes-meta",
	"DELETE /api/v1/messenger/conversations/:id/messages/:msgId",
	"POST /api/v1/messenger/conversations/:id/read",
	"POST /api/v1/messenger/conversations/:id/delivered",
	"POST /api/v1/messenger/conversations/:id/pin",
	"DELETE /api/v1/messenger/conversations/:id/leave",
	"POST /api/v1/messenger/groups",
	"PUT /api/v1/messenger/groups/:id",
	"POST /api/v1/messenger/groups/:id/members",
	"DELETE /api/v1/messenger/groups/:id/members/:userId",
	"GET /api/v1/messenger/groups/:id/members",
	"POST /api/v1/friends/request",
	"PUT /api/v1/friends/request/:id/accept",
	"PUT /api/v1/friends/request/:id/reject",
	"DELETE /api/v1/friends/request/:id",
	"DELETE /api/v1/friends/:userId",
	"GET /api/v1/friends",
	"GET /api/v1/friends/requests",
	"GET /api/v1/friends/status/:userId",
	"GET /api/v1/my-emoji-packs",
	"GET /api/v1/my-emoji-subscriptions",

	// RPC
	"GET /api/rpc/get_post_likes_count",
	"GET /api/rpc/get_thread_likes_count",
	"GET /api/rpc/get_recent_post_likers",
	"GET /api/rpc/get_recent_thread_likers",
	"GET /api/rpc/get_post_likes_batch",
	"GET /api/rpc/get_thread_likes_batch",
	"POST /api/rpc/resolve_emojis",
	"GET /api/rpc/has_user_liked_post",
	"GET /api/rpc/has_user_liked_thread",
	"GET /api/rpc/get_user_likes_given_count",
	"GET /api/rpc/get_user_likes_received_count",
	"GET /api/rpc/get_user_thread_likes_given_count",
	"GET /api/rpc/get_user_thread_likes_received_count",
	"GET /api/rpc/get_user_post_likes_received_timestamps",
	"GET /api/rpc/get_user_thread_likes_received_timestamps",
	"GET /api/rpc/get_user_thread_reply_timestamps",
	"GET /api/rpc/toggle_wall_post_pin",
	"POST /api/rpc/get_avatar_history",
	"POST /api/rpc/record_wall_views",
	"POST /api/rpc/delete_avatar_from_history",
	"POST /api/rpc/toggle_achievement_pin",
	"POST /api/rpc/award_achievement",
	"POST /api/rpc/create_gomosub",
	"GET /api/rpc/get_board_user_permissions",
	"POST /api/rpc/create_thread",
	"POST /api/rpc/create_post",

	// Federation
	"GET /federation/users/:identifier",
	"GET /federation/gomosubs/:slug",
	"GET /federation/servers",

	// Storage
	"GET /storage/v1/object/:bucket/*key",
	"POST /storage/v1/upload",
	"DELETE /storage/v1/object/:bucket/*key",

	// Social previews (Open Graph)
	"GET /og/wall/*key",

	// OAuth 2.0 / OIDC
	"GET /oauth/authorize",
	"POST /oauth/token",
	"POST /oauth/revoke",
	"POST /oauth/introspect",
	"GET /oauth/userinfo",
	"GET /oauth/app-info",
	"GET /.well-known/openid-configuration",
	"GET /.well-known/jwks.json",

	// Dev dashboard + developer panel
	"GET /api/v1/dev-dashboard/config",
	"GET /api/v1/developer/apps",
	"POST /api/v1/developer/apps",
	"GET /api/v1/developer/apps/:id",
	"PUT /api/v1/developer/apps/:id",
	"DELETE /api/v1/developer/apps/:id",
	"POST /api/v1/developer/apps/:id/regenerate-secret",
	"GET /api/v1/developer/apps/:id/tokens",
	"POST /api/v1/developer/apps/:id/revoke-user-tokens",

	// Bots
	"GET /api/v1/bots",
	"POST /api/v1/bots",
	"GET /api/v1/bots/:id",
	"PUT /api/v1/bots/:id",
	"DELETE /api/v1/bots/:id",
	"POST /api/v1/bots/:id/toggle",
	"POST /api/v1/bots/:id/regenerate-token",

	// Integrations
	"GET /api/v1/integrations/spotify/now-playing/:user_id",
	"GET /api/v1/integrations/spotify/callback",
	"GET /api/v1/integrations/spotify/auth-url",
	"GET /api/v1/integrations/spotify/status",
	"GET /api/v1/integrations/spotify/me/state",
	"DELETE /api/v1/integrations/spotify/disconnect",
}

func TestSetupRoutes_RegistersAllEndpoints(t *testing.T) {
	router := newTestRouter(t, false)

	expected := make(map[string]bool, len(expectedRoutes))
	for _, want := range expectedRoutes {
		expected[want] = true
	}
	registered := make(map[string]bool, len(router.Routes()))
	var missing, extra []string
	for _, r := range router.Routes() {
		key := r.Method + " " + r.Path
		registered[key] = true
		if !expected[key] {
			extra = append(extra, key)
		}
	}
	for _, want := range expectedRoutes {
		if !registered[want] {
			missing = append(missing, want)
		}
	}

	if len(missing) > 0 {
		t.Errorf("missing routes (%d):\n  %s", len(missing), joinKeys(missing))
	}
	if len(extra) > 0 {
		t.Errorf("unexpected routes (%d):\n  %s", len(extra), joinKeys(extra))
	}
	if len(registered) != len(expectedRoutes) {
		t.Errorf("route count mismatch: got %d registered, expected %d", len(registered), len(expectedRoutes))
	}
}

func joinKeys(keys []string) string {
	out := ""
	for i, k := range keys {
		if i > 0 {
			out += "\n  "
		}
		out += k
	}
	return out
}

// The /og/wall/*key image proxy must carry the per-IP limiter: the first
// request passes, the second from the same IP gets 429 once the (env-tuned)
// budget is exhausted. Locking this in guards against someone accidentally
// dropping the middleware from the route.
func TestSetupRoutes_OGWallImageRateLimited(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	t.Setenv("OG_IMAGE_RATE_LIMIT_PER_MIN", "1")

	router := newTestRouterWithRedis(t, false, rdb)

	// First request passes the limiter (storageHandler is nil in tests, so the
	// handler itself 404s — but crucially not with 429).
	req1 := httptest.NewRequest(http.MethodGet, "/og/wall/u1/img.webp", nil)
	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, req1)
	if rec1.Code == http.StatusTooManyRequests {
		t.Fatal("first request must pass the limiter")
	}

	// Second request from the same IP exhausts the budget → 429.
	req2 := httptest.NewRequest(http.MethodGet, "/og/wall/u1/img.webp", nil)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after the budget is exhausted, got %d", rec2.Code)
	}
}

// The public /api/rpc surface (likes batch, recent likers, emoji resolve,
// avatar history) is reachable by anonymous callers, so it must carry its own
// per-IP rate limiter with a stricter budget than the generic REST surface.
// Locking this in guards against someone accidentally dropping the middleware
// from the group: the first request passes, the second from the same IP gets
// 429 once the (env-tuned) budget is exhausted.
func TestSetupRoutes_PublicRPCRateLimitedForGuests(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	t.Setenv("RPC_RATE_LIMIT_PER_IP", "1")

	router := newTestRouterWithRedis(t, false, rdb)

	// First request passes the limiter (the handler needs a DB the sqlmock
	// does not answer, so it may error — but crucially not with 429).
	req1 := httptest.NewRequest(http.MethodGet, "/api/rpc/get_post_likes_count?post_uuid=00000000-0000-0000-0000-000000000000", nil)
	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, req1)
	if rec1.Code == http.StatusTooManyRequests {
		t.Fatal("first request must pass the limiter")
	}

	// Second request from the same IP exhausts the guest budget → 429.
	req2 := httptest.NewRequest(http.MethodGet, "/api/rpc/get_post_likes_count?post_uuid=00000000-0000-0000-0000-000000000000", nil)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after the guest RPC budget is exhausted, got %d", rec2.Code)
	}
}

func TestSetupRoutes_NoWebSocketWithoutHub(t *testing.T) {
	router := newTestRouter(t, false)
	for _, path := range []string{"/ws", "/ws/stats"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s without hub: expected 404, got %d", path, rec.Code)
		}
	}
}

func TestSetupRoutes_WebSocketRoutesWithHub(t *testing.T) {
	router := newTestRouter(t, true)

	// /ws is registered — a plain GET without upgrade headers must not 404.
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Fatal("GET /ws with hub: expected a registered handler, got 404")
	}

	// /ws/stats is admin-gated → 401 without credentials.
	req = httptest.NewRequest(http.MethodGet, "/ws/stats", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("GET /ws/stats without auth: expected 401, got %d", rec.Code)
	}
}

func TestSetupRoutes_SmokeRequests(t *testing.T) {
	router := newTestRouter(t, false)

	cases := []struct {
		name       string
		method     string
		path       string
		wantCode   int
		notAllowed bool // when set, asserts the code is NOT 404 (route dispatches)
	}{
		{name: "ready", method: http.MethodGet, path: "/ready", wantCode: http.StatusOK},
		{name: "oidc config", method: http.MethodGet, path: "/.well-known/openid-configuration", wantCode: http.StatusOK},
		{name: "jwks", method: http.MethodGet, path: "/.well-known/jwks.json", wantCode: http.StatusOK},
		{name: "dev dashboard config", method: http.MethodGet, path: "/api/v1/dev-dashboard/config", wantCode: http.StatusOK},
		{name: "test-auth requires auth", method: http.MethodGet, path: "/api/v1/test-auth", wantCode: http.StatusUnauthorized},
		{name: "me requires auth", method: http.MethodGet, path: "/api/v1/auth/me", wantCode: http.StatusUnauthorized},
		{name: "sessions requires auth", method: http.MethodGet, path: "/api/v1/auth/sessions", wantCode: http.StatusUnauthorized},
		{name: "bots requires auth", method: http.MethodGet, path: "/api/v1/bots", wantCode: http.StatusUnauthorized},
		{name: "developer apps requires auth", method: http.MethodGet, path: "/api/v1/developer/apps", wantCode: http.StatusUnauthorized},
		{name: "rpc requires auth", method: http.MethodGet, path: "/api/rpc/has_user_liked_post", wantCode: http.StatusUnauthorized},
		{name: "federation user stub", method: http.MethodGet, path: "/federation/users/alice@example.com", wantCode: http.StatusNotImplemented},
		{name: "federation gomosub stub", method: http.MethodGet, path: "/federation/gomosubs/my-sub", wantCode: http.StatusNotImplemented},
		{name: "federation servers stub", method: http.MethodGet, path: "/federation/servers", wantCode: http.StatusNotImplemented},
		{name: "storage without S3", method: http.MethodGet, path: "/storage/v1/object/public/photo.png", wantCode: http.StatusNotImplemented},
		{name: "unknown route", method: http.MethodGet, path: "/api/v1/definitely-not-a-route", wantCode: http.StatusNotFound},
		{name: "register dispatches", method: http.MethodPost, path: "/api/v1/auth/register", wantCode: http.StatusBadRequest},
		{name: "oauth authorize redirects", method: http.MethodGet, path: "/oauth/authorize?response_type=code&client_id=x&redirect_uri=http://localhost/cb", wantCode: http.StatusTemporaryRedirect},
		{name: "public profiles dispatches", method: http.MethodGet, path: "/api/v1/profiles", notAllowed: true},
		{name: "public boards dispatches", method: http.MethodGet, path: "/api/v1/boards", notAllowed: true},
		{name: "public posts dispatches", method: http.MethodGet, path: "/api/v1/posts", notAllowed: true},
		{name: "user privacy flags dispatches", method: http.MethodGet, path: "/api/v1/users/11111111-1111-1111-1111-111111111111/privacy", notAllowed: true},
		{name: "messenger routes dispatches", method: http.MethodGet, path: "/api/v1/messenger/conversations", notAllowed: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if tc.notAllowed {
				if rec.Code == http.StatusNotFound {
					t.Errorf("%s %s: expected the route to dispatch, got 404", tc.method, tc.path)
				}
				return
			}
			if rec.Code != tc.wantCode {
				t.Errorf("%s %s: expected %d, got %d (body: %s)", tc.method, tc.path, tc.wantCode, rec.Code, rec.Body.String())
			}
		})
	}
}

// ─── adminOnlyMiddleware ─────────────────────────────────────────────────────

func TestAdminOnlyMiddleware_NoClaims(t *testing.T) {
	router := gin.New()
	router.GET("/test", adminOnlyMiddleware(nil), func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without claims, got %d", rec.Code)
	}
}

func TestAdminOnlyMiddleware_InvalidClaimsType(t *testing.T) {
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("claims", "not-a-claims"); c.Next() })
	router.GET("/test", adminOnlyMiddleware(nil), func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid claims, got %d", rec.Code)
	}
}

func TestAdminOnlyMiddleware_NonAdmin(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_roles`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("claims", &auth.Claims{UserID: "u1"}); c.Next() })
	router.GET("/test", adminOnlyMiddleware(db), func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a non-admin, got %d", rec.Code)
	}
}

func TestAdminOnlyMiddleware_Admin(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_roles`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("claims", &auth.Claims{UserID: "u1"}); c.Next() })
	router.GET("/test", adminOnlyMiddleware(db), func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for an admin, got %d", rec.Code)
	}
}

func TestAdminOnlyMiddleware_DBErrorFailsClosed(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	// No expectation → the query fails → must fail closed (403).

	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("claims", &auth.Claims{UserID: "u1"}); c.Next() })
	router.GET("/test", adminOnlyMiddleware(db), func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on DB error, got %d", rec.Code)
	}
}

// ─── canViewUserWall ─────────────────────────────────────────────────────────

func TestCanViewUserWall_SameUser(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	if !canViewUserWall(db, "u1", "u1") {
		t.Fatal("a user must always be able to view their own wall")
	}
}

func TestCanViewUserWall_NoPrivacyRow_PublicByDefault(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COALESCE\(private_profile`).
		WithArgs("owner").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}))

	if !canViewUserWall(db, "viewer", "owner") {
		t.Fatal("missing privacy row must default to public")
	}
}

func TestCanViewUserWall_PublicProfile(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COALESCE\(private_profile`).
		WithArgs("owner").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}).AddRow(false, false))

	if !canViewUserWall(db, "viewer", "owner") {
		t.Fatal("a public profile must be viewable")
	}
}

func TestCanViewUserWall_PrivateAndNotFriend(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COALESCE\(private_profile`).
		WithArgs("owner").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}).AddRow(true, true))
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("viewer", "owner").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	if canViewUserWall(db, "viewer", "owner") {
		t.Fatal("a stranger must not view a private wall")
	}
}

func TestCanViewUserWall_PrivateMutualFriend(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT COALESCE\(private_profile`).
		WithArgs("owner").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}).AddRow(true, true))
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("viewer", "owner").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	if !canViewUserWall(db, "viewer", "owner") {
		t.Fatal("a friend must be able to view the wall")
	}
}

func TestCanViewUserWall_DBErrorFailsClosed(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	// No expectation → query error → must fail closed.

	if canViewUserWall(db, "viewer", "owner") {
		t.Fatal("DB errors must deny wall access")
	}
}

// ─── escapeLikePattern ──────────────────────────────────────────────────────

func TestEscapeLikePattern(t *testing.T) {
	cases := []struct{ in, want string }{
		// The '_' inside the timestamp segment of a storage key is a LIKE
		// single-char wildcard and must be escaped to match literally.
		{"u1/1786303495874_1exs5dwr0qc.jpeg", `u1/1786303495874\_1exs5dwr0qc.jpeg`},
		{"100%", `100\%`},
		{`a\b`, `a\\b`},
		{`a_b%c`, `a\_b\%c`},
	}
	for _, tc := range cases {
		if got := escapeLikePattern(tc.in); got != tc.want {
			t.Errorf("escapeLikePattern(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ─── wallAttachmentAccess ───────────────────────────────────────────────────

// TestWallAttachmentAccess_PublishedOnPublicWall is the exact regression case
// from the bug report: a private user posts with an image on a PUBLIC user's
// wall. The object key is namespaced by the private uploader, but the photo is
// published on the public wall, so a stranger must be allowed to fetch it.
// The lookup is scoped to posts authored by the uploader (author_id = key
// prefix), which this post satisfies.
func TestWallAttachmentAccess_PublishedOnPublicWall(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + escapeLikePattern(key) + "%"
	// Visible branch of the EXISTS query (public wall) short-circuits to allow.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := wallAttachmentAccess(db, "viewer", "uPrivate", key)
	if !found || !allowed {
		t.Fatalf("expected found+allowed for a photo published on a public wall, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWallAttachmentAccess_PublishedOnPrivateWallStrangerDenied(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + escapeLikePattern(key) + "%"
	// Not visible to the viewer, but referenced by an uploader-authored post →
	// deny (found, not allowed).
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s).*FROM profile_wall_posts p\s+WHERE p\.author_id.*`).
		WithArgs(pattern, "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := wallAttachmentAccess(db, "viewer", "uPrivate", key)
	if !found || allowed {
		t.Fatalf("expected found but not allowed for a stranger on a private wall, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Anonymous viewers (the /og/wall crawler proxy passes viewerID = "") must
// still be able to fetch images from PUBLIC walls. Regression: the uuid
// columns were compared to the empty string directly, Postgres raised
// "invalid input syntax for type uuid" and every anonymous wall-image
// request 404ed even for public walls.
func TestWallAttachmentAccess_AnonymousViewerPublicWallAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPublic/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + escapeLikePattern(key) + "%"
	// The public-wall branch of the EXISTS query short-circuits to allow — the
	// empty viewer must not make the query fail or the uuid cast break.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "", "uPublic").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := wallAttachmentAccess(db, "", "uPublic", key)
	if !found || !allowed {
		t.Fatalf("expected an anonymous viewer to fetch a public-wall image, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A derivative key (video poster / image preview) must authorize against its
// BASE object: the suffix is stripped before the LIKE pattern is built, so a
// poster referenced only by the base video URL still resolves. Regression for
// og:video previews, which point og:image at <key>.poster.jpg through /og/wall.
func TestWallAttachmentAccess_VideoPosterKeyAuthorizesAgainstBase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPublic/1786303495874_clip.mp4.poster.jpg"
	// The suffix is stripped, so the query pattern is the base video key.
	pattern := "%" + escapeLikePattern("uPublic/1786303495874_clip.mp4") + "%"
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "", "uPublic").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := wallAttachmentAccess(db, "", "uPublic", key)
	if !found || !allowed {
		t.Fatalf("expected a public-wall video poster to be served, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWallAttachmentAccess_MutualFriendOnPrivateWallAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + escapeLikePattern(key) + "%"
	// The friendships branch of the SQL predicate matches → visible.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "friend", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	found, allowed := wallAttachmentAccess(db, "friend", "uPrivate", key)
	if !found || !allowed {
		t.Fatalf("expected a mutual friend of the wall owner to be allowed, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestWallAttachmentAccess_NoPostReferencesKey guards the security boundary: a
// guessed key with no post referencing it must NOT be counted as found, so the
// caller falls back to the uploader gate (which denies for a private uploader).
func TestWallAttachmentAccess_NoPostReferencesKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + escapeLikePattern(key) + "%"
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s).*FROM profile_wall_posts p\s+WHERE p\.author_id.*`).
		WithArgs(pattern, "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	found, allowed := wallAttachmentAccess(db, "viewer", "uPrivate", key)
	if found || allowed {
		t.Fatalf("expected not-found for a key no uploader-authored post references, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestWallAttachmentAccess_AttackerReferenceDoesNotUnlock covers the bypass that
// author-scoping prevents: an ATTACKER references a private user's key from a
// post on their own public wall. The reference is not authored by the uploader,
// so the lookup must not find it (found=false) — the caller then falls back to
// the uploader gate, which denies for the private uploader.
func TestWallAttachmentAccess_AttackerReferenceDoesNotUnlock(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	key := "uPrivate/1786303495874_1exs5dwr0qc.jpeg"
	pattern := "%" + escapeLikePattern(key) + "%"
	// Both queries are scoped to p.author_id = uPrivate; the attacker's post
	// (author = attacker) matches neither → found=false.
	mock.ExpectQuery(`(?s).*profile_wall_posts.*privacy_settings.*`).
		WithArgs(pattern, "viewer", "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s).*FROM profile_wall_posts p\s+WHERE p\.author_id.*`).
		WithArgs(pattern, "uPrivate").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	found, allowed := wallAttachmentAccess(db, "viewer", "uPrivate", key)
	if found || allowed {
		t.Fatalf("an attacker's own post must not unlock another user's file, got found=%v allowed=%v", found, allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWallAttachmentAccess_DBErrorFailsClosed(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	// No expectation → query error → fail closed (caller falls back to the
	// uploader gate, which also denies on DB errors).

	found, allowed := wallAttachmentAccess(db, "viewer", "u1", "u1/photo.jpg")
	if found || allowed {
		t.Fatalf("expected DB errors to deny access, got found=%v allowed=%v", found, allowed)
	}
}
