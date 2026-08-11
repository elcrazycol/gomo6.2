package routes

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/handlers"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/oauth"
	stor "github.com/gomo6/backend/internal/storage"
	storageHandlers "github.com/gomo6/backend/internal/storage/handlers"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

func SetupRoutes(router *gin.Engine, db *sql.DB, redis *redis.Client, wsHub *websocket.Hub) {
	// Lightweight per-route request/latency/error metrics for every handler
	// registered below (admin-only at GET /api/v1/metrics).
	router.Use(middleware.MetricsMiddleware())

	// Readiness check (registered after all initialization is complete)
	// Docker healthcheck uses /health (registered in main.go BEFORE heavy init)
	// This /ready endpoint confirms the full stack is operational
	router.GET("/ready", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "websocket": wsHub != nil})
	})

	// Serve OpenAPI/Swagger JSON for API documentation
	router.GET("/api/v1/docs/json", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=3600")
		c.File("./docs/swagger.json")
	})

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(db)
	// Initialize auth service
	authService := auth.NewAuthService()
	authService.SetRedis(redis) // enables token blacklist + refresh tokens

	// Set Redis on auth handler for lockout + token blacklist
	authHandler.SetRedis(redis)

	// Initialize OAuth service and handlers
	oauthService := oauth.NewOAuthService(db, authService)

	// Seed dev-dashboard OAuth app (public client with PKCE)
	// This ensures the dev-dashboard can authenticate via OAuth
	handlers.SeedDevDashboardApp(db)

	oauthHandler := handlers.NewOAuthHandler(db, oauthService, authService)
	devHandler := handlers.NewDeveloperHandler(db, oauthService)
	devDashboardHandler := handlers.NewDevDashboardHandler(db, oauthService)

	// Initialize rate limiters (Redis-backed for distributed deployment)
	authRateLimiter := middleware.NewAuthRateLimiter(redis, 100, time.Minute)     // 100 req/min for auth/me
	loginRateLimiter := middleware.NewAuthRateLimiter(redis, 10, time.Minute)     // 10/min per IP for login (anti brute-force)
	registerRateLimiter := middleware.NewAuthRateLimiter(redis, 5, time.Minute)   // 5/min per IP for register (anti abuse)
	verify2FARateLimiter := middleware.NewAuthRateLimiter(redis, 20, time.Minute) // 20/min per IP for the 2FA step
	oauthRateLimiter := middleware.NewOAuthRateLimiter(20, 10, time.Minute)       // 20/min token, 10/min revoke
	// Generic REST rate limiting: authenticated requests get a per-user budget
	// (900/min by default), anonymous requests share a per-IP bucket (300/min).
	// Both are tunable via RATE_LIMIT_PER_USER / RATE_LIMIT_PER_IP env vars.
	globalRateLimiter := middleware.NewGlobalRateLimiterFromEnv(redis, time.Minute)
	// Upload limits: per-user request rate + hourly byte quota. Redis-backed so
	// the budget holds across instances and /storage/v1/upload cannot be used to
	// exhaust object storage.
	uploadRateLimiter := middleware.NewUploadRateLimiter(
		redis,
		middleware.DefaultUploadsPerMinute,
		middleware.DefaultUploadBytesPerHour,
	)

	// Initialize WebAuthn handler for passkey support (Redis-backed sessions)
	webauthnHandler := handlers.NewWebAuthnHandler(db, redis, authService)

	// Initialize WebSocket handler if hub is provided
	var wsHandler *websocket.Handler
	if wsHub != nil {
		wsHandler = websocket.NewHandler(wsHub, authService)
	}
	boardsHandler := handlers.NewBoardsHandler(db)
	boardsHandler.SetRedis(redis)
	boardsHandler.SetAuthService(authService)
	threadsHandler := handlers.NewThreadsHandler(db)
	threadsHandler.SetRedis(redis)
	threadsHandler.SetAuthService(authService)
	postsHandler := handlers.NewPostsHandler(db)
	postsHandler.SetRedis(redis)
	// Initialize achievement checker (must be before handlers that use it)
	achChecker := handlers.NewAchievementChecker(db)
	achChecker.SetRedis(redis)
	achChecker.SetWebSocketHub(wsHub)

	profilesHandler := handlers.NewProfilesHandler(db)
	profilesHandler.SetRedis(redis)
	profilesHandler.SetAchievementChecker(achChecker)
	likesHandler := handlers.NewLikesHandler(db, redis)
	likesHandler.SetWebSocketHub(wsHub)
	likesHandler.SetAchievementChecker(achChecker)
	notificationsHandler := handlers.NewNotificationsHandler(db)
	notificationsHandler.SetRedis(redis)
	notificationsHandler.SetWebSocketHub(wsHub)
	rpcHandler := handlers.NewRPCHandler(db)
	rpcHandler.SetRedis(redis)
	rpcHandler.SetWebSocketHub(wsHub)
	rpcHandler.SetAchievementChecker(achChecker)
	universalHandler := handlers.NewUniversalHandler(db, wsHub)
	universalHandler.SetRedis(redis)
	universalHandler.SetAchievementChecker(achChecker)
	searchHandler := handlers.NewSearchHandler(db)
	feedHandler := handlers.NewFeedHandler(db)
	messengerHandler := handlers.NewMessengerHandler(db, wsHub)
	messengerHandler.SetRedis(redis)
	audioHandler := handlers.NewAudioHandler()
	userStatusHandler := handlers.NewUserStatusHandler(db, wsHub)
	giftsHandler := handlers.NewGiftsHandler(db)
	giftsHandler.SetRedis(redis)
	giftsHandler.SetWebSocketHub(wsHub)
	giftAdminHandler := handlers.NewGiftAdminHandler(db)
	dropsHandler := handlers.NewDropsHandler(db)
	friendsHandler := handlers.NewFriendsHandler(db)
	friendsHandler.SetRedis(redis)
	friendsHandler.SetWebSocketHub(wsHub)
	emojiPacksHandler := handlers.NewEmojiPacksHandler(db)
	var storageHandler *storageHandlers.StorageHandler
	storageClient, err := stor.NewStorageClient()
	if err != nil {
		log.Printf("Warning: failed to initialize storage client: %v", err)
		storageHandler = nil
	} else {
		storageHandler = storageHandlers.NewStorageHandler(storageClient, db)
		storageHandler.StartOrphanCleanup()
	}
	messengerHandler.SetStorage(storageClient)

	backupHandler := handlers.NewBackupHandler(db)
	backupHandler.SetStorage(storageClient)

	// Client-side error reporting handler
	clientErrorsHandler := handlers.NewClientErrorsHandler(db)

	// Admin-only request metrics (per-route counts, latency, 4xx/5xx/429).
	// Zero-dependency in-memory counters from MetricsMiddleware. Use this to spot
	// N+1 request storms, chatty endpoints and rate-limit floods without log
	// spelunking: sorted by request volume, error rates included.
	router.GET("/api/v1/metrics",
		middleware.AuthMiddleware(authService),
		adminOnlyMiddleware(db),
		func(c *gin.Context) {
			c.JSON(200, middleware.MetricsSnapshot())
		})

	// WebSocket handler disabled for now
	// wsHandler := handlers.NewWebSocketHandler(wsHub)

	// API routes
	api := router.Group("/api/v1")
	{
		// Audio metadata endpoint
		api.POST("/audio/metadata", audioHandler.ExtractAudioMetadata)

		// Test endpoint to verify AuthMiddleware works
		api.GET("/test-auth", middleware.AuthMiddleware(authService), func(c *gin.Context) {
			claimsInterface, _ := c.Get("claims")
			claims := claimsInterface.(*auth.Claims)
			c.JSON(200, gin.H{"user_id": claims.UserID, "message": "Auth works!"})
		})

		// Auth routes
		authGroup := api.Group("/auth")
		{
			authGroup.POST("/register", middleware.AuthRateLimitMiddleware(registerRateLimiter), authHandler.Register)
			authGroup.POST("/login", middleware.AuthRateLimitMiddleware(loginRateLimiter), authHandler.Login)
			// Refresh authenticates using the HttpOnly refresh cookie (or the
			// legacy bearer+JSON contract for API clients). Access may already be expired.
			authGroup.POST("/refresh", authHandler.Refresh)
			// Logout is CSRF-protected and can revoke a browser session using its
			// HttpOnly refresh cookie even after the access cookie has expired.
			authGroup.POST("/logout", authHandler.Logout)
			// Apply both caching and rate limiting to /me endpoint
			authGroup.GET("/me",
				middleware.AuthCacheMiddleware(authService, redis),
				middleware.AuthRateLimitMiddleware(authRateLimiter),
				authHandler.GetMe)
			authGroup.POST("/password", middleware.AuthMiddleware(authService), authHandler.UpdatePassword)

			// 2FA endpoints
			auth2fa := authGroup.Group("/2fa")
			auth2fa.Use(middleware.AuthMiddleware(authService))
			{
				auth2fa.POST("/setup", authHandler.SetupTOTP)
				auth2fa.POST("/verify-and-enable", authHandler.VerifyAndEnableTOTP)
				auth2fa.POST("/disable", authHandler.DisableTOTP)
				auth2fa.GET("/status", authHandler.Get2FAStatus)
			}
			// Verify 2FA during login (uses partial token, no full auth middleware)
			authGroup.POST("/verify-2fa", middleware.AuthRateLimitMiddleware(verify2FARateLimiter), authHandler.Verify2FA)

			// WebAuthn/Passkeys endpoints
			if webauthnHandler != nil {
				webauthnGroup := authGroup.Group("/webauthn")
				{
					// Login with passkey (no auth required upfront)
					webauthnGroup.GET("/login/begin", webauthnHandler.BeginLogin)
					webauthnGroup.POST("/login/finish", webauthnHandler.FinishLogin)

					// Manage passkeys (requires auth)
					webauthnProtected := webauthnGroup.Group("")
					webauthnProtected.Use(middleware.AuthMiddleware(authService))
					{
						webauthnProtected.POST("/register/begin", webauthnHandler.BeginRegistration)
						webauthnProtected.POST("/register/finish", webauthnHandler.FinishRegistration)
						webauthnProtected.GET("/credentials", webauthnHandler.ListCredentials)
						webauthnProtected.DELETE("/credentials/:credentialId", webauthnHandler.DeleteCredential)
					}
				}
			}

			// Session management endpoints
			authGroup.GET("/sessions", middleware.AuthMiddleware(authService), authHandler.ListSessions)
			authGroup.DELETE("/sessions", middleware.AuthMiddleware(authService), authHandler.DeleteAllOtherSessions)
			authGroup.DELETE("/sessions/:id", middleware.AuthMiddleware(authService), authHandler.DeleteSession)
		}
	}

	// REST compatibility routes
	rest := router.Group("/api/v1")
	{
		// Populate claims if auth token is present (does not block anonymous requests).
		// MUST run BEFORE DataCacheMiddleware: the cache key is bound to the viewer
		// identity (see data_cache.go), otherwise per-user responses (profile walls,
		// friends, privacy settings, likes) would be cached across users and even
		// served to anonymous visitors on cache hits. It also runs BEFORE the rate
		// limiter so authenticated requests are keyed by user ID, not IP.
		rest.Use(middleware.OptionalAuthMiddlewareWithDB(authService, db))
		// Apply data caching middleware for GET requests (2 minute TTL). Cache hits
		// abort before the rate limiter below, so repeated reads within the TTL are
		// free: no rate-limit budget burned and no DB hit. Only cache misses and
		// write requests consume the rate-limit budget.
		rest.Use(middleware.DataCacheMiddleware(redis, middleware.DefaultDataCacheTTL))
		// Global rate limiting: per-user budget for authenticated requests, per-IP
		// for anonymous (env-tunable). See global_rate_limit.go.
		rest.Use(middleware.GlobalRateLimitMiddleware(globalRateLimiter))

		// Search endpoint (full-text, public)
		rest.GET("/search", searchHandler.Search)

		// Unified personalized feed (threads + wall posts, scored per viewer).
		// Rides the optional-auth + data-cache middleware above, so personalized
		// responses are cached per viewer identity (see data_cache.go).
		rest.GET("/feed", feedHandler.GetUserFeed)

		// Public endpoints (no auth required)
		rest.GET("/profiles", profilesHandler.GetProfiles)
		rest.GET("/profiles/:id", profilesHandler.GetProfile)
		rest.GET("/boards", boardsHandler.GetBoards)
		rest.GET("/boards/:id", boardsHandler.GetBoard)
		rest.GET("/threads", threadsHandler.GetThreads)
		rest.GET("/threads/:id", threadsHandler.GetThread)
		rest.GET("/posts", postsHandler.GetPosts)
		rest.GET("/posts/:id", postsHandler.GetPost)

		// Invite info (public — shows board name + status before joining)
		rest.GET("/invites/:code", boardsHandler.GetInviteInfo)

		// User status endpoints
		rest.GET("/users/online", userStatusHandler.GetOnlineUsers)
		rest.GET("/users/:id/status", userStatusHandler.GetUserStatus)
		rest.POST("/users/status/bulk", userStatusHandler.GetBulkUserStatus)

		// Gift catalog (public)
		rest.GET("/gift_catalog", giftsHandler.GetGiftCatalog)
		// User gifts (public)
		rest.GET("/user_gifts", giftsHandler.GetUserGifts)
		// Client-side JavaScript error reporting (public, rate-limited)
		rest.POST("/client-errors", clientErrorsHandler.ReportClientError)

		// Drops packages (public)
		rest.GET("/drops/packages", dropsHandler.GetDropsPackages)

		// DePay integration. Both handlers authenticate the request themselves:
		// /drops/callback requires a valid DePay signature (fail-closed, C1),
		// /drops/config accepts either a valid DePay signature or an
		// authenticated session with user_id bound to the caller (C2). The
		// OptionalAuthMiddleware above populates claims from cookie/Bearer so
		// the browser widget flow works without extra middleware here.
		rest.POST("/drops/config", dropsHandler.DropsConfig)
		rest.POST("/drops/callback", dropsHandler.DropsCallback)

		// Additional tables (frontend compatibility)
		genericProtected := rest.Group("")
		genericProtected.Use(middleware.AuthCacheMiddleware(authService, redis))
		genericProtected.Use(middleware.ValidateCSRFMiddleware())

		genericProtected.GET("/user_roles", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_roles/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/gomosub_memberships", universalHandler.HandleTableRequest)
		genericProtected.GET("/gomosub_memberships/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/channels", universalHandler.HandleTableRequest)
		genericProtected.GET("/channels/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/gomosub_roles", universalHandler.HandleTableRequest)
		genericProtected.GET("/gomosub_roles/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/channel_permissions", universalHandler.HandleTableRequest)
		genericProtected.GET("/channel_permissions/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/user_session_time", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_session_time/*path", universalHandler.HandleTableRequest)
		// Writes: the frontend inserts/updates its own session time row via the
		// universal CRUD handler (useSessionTime). POST and PUT were missing, so
		// Gin returned 404 before the (already implemented) handler was reached.
		genericProtected.POST("/user_session_time", universalHandler.HandleTableRequest)
		genericProtected.POST("/user_session_time/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/user_session_time", universalHandler.HandleTableRequest)
		genericProtected.PUT("/user_session_time/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/user_achievements", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_achievements/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/achievements", universalHandler.HandleTableRequest)
		genericProtected.GET("/achievements/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/user_terms_acceptance", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_terms_acceptance/*path", universalHandler.HandleTableRequest)
		// Writes: the frontend inserts the acceptance row right after signup;
		// without POST the terms dialog could never be accepted (404).
		genericProtected.POST("/user_terms_acceptance", universalHandler.HandleTableRequest)
		genericProtected.POST("/user_terms_acceptance/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/profile_customization", universalHandler.HandleTableRequest)
		genericProtected.GET("/profile_customization/*path", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_customization", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_customization/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/user_placeholders", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_placeholders/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/polls", universalHandler.HandleTableRequest)
		genericProtected.GET("/polls/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/poll_votes", universalHandler.HandleTableRequest)
		genericProtected.GET("/poll_votes/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/thread_subscriptions", universalHandler.HandleTableRequest)
		genericProtected.GET("/thread_subscriptions/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/privacy_settings", universalHandler.HandleTableRequest)
		genericProtected.GET("/privacy_settings/*path", universalHandler.HandleTableRequest)
		// Writes are ownership-scoped in enforcePostOwnership/enforceWallWriteScope:
		// the user_id column is always forced to the authenticated caller.
		genericProtected.PUT("/privacy_settings", universalHandler.HandleTableRequest)
		genericProtected.PUT("/privacy_settings/*path", universalHandler.HandleTableRequest)
		genericProtected.POST("/privacy_settings", universalHandler.HandleTableRequest)
		genericProtected.POST("/privacy_settings/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/user_daily_visits", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_daily_visits/*path", universalHandler.HandleTableRequest)
		// Writes: useSessionTime upserts the daily visit row on load. The POST
		// upsert path was implemented and tested but never routed → 404 spam.
		genericProtected.POST("/user_daily_visits", universalHandler.HandleTableRequest)
		genericProtected.POST("/user_daily_visits/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/user_daily_visits", universalHandler.HandleTableRequest)
		genericProtected.PUT("/user_daily_visits/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/thread_custom_message_visits", universalHandler.HandleTableRequest)
		genericProtected.GET("/thread_custom_message_visits/*path", universalHandler.HandleTableRequest)
		// Writes: the frontend records a thread visit (idempotent upsert) on every
		// thread view. GET-only routes made Gin return 404 before the already
		// implemented upsert handler was reached — every thread view fired a 404.
		genericProtected.POST("/thread_custom_message_visits", universalHandler.HandleTableRequest)
		genericProtected.POST("/thread_custom_message_visits/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/thread_custom_message_visits", universalHandler.HandleTableRequest)
		genericProtected.PUT("/thread_custom_message_visits/*path", universalHandler.HandleTableRequest)

		// Profile wall uses the universal CRUD handler for reads and mutations.
		// Register every method here; registering GET only makes Gin return 404
		// before the already-tested POST/PUT/DELETE handler is reached.
		genericProtected.GET("/profile_wall_posts", universalHandler.HandleTableRequest)
		genericProtected.GET("/profile_wall_posts/*path", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_posts", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_posts/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_posts", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_posts/*path", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_posts", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_posts/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/profile_wall_post_comments", universalHandler.HandleTableRequest)
		genericProtected.GET("/profile_wall_post_comments/*path", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_post_comments", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_post_comments/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_post_comments", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_post_comments/*path", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_post_comments", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_post_comments/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/profile_wall_post_likes", universalHandler.HandleTableRequest)
		genericProtected.GET("/profile_wall_post_likes/*path", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_post_likes", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_post_likes/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_post_likes", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_post_likes/*path", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_post_likes", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_post_likes/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/profile_wall_post_reposts", universalHandler.HandleTableRequest)
		genericProtected.GET("/profile_wall_post_reposts/*path", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_post_reposts", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_post_reposts/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_post_reposts", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_post_reposts/*path", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_post_reposts", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_post_reposts/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/profile_wall_comment_likes", universalHandler.HandleTableRequest)
		genericProtected.GET("/profile_wall_comment_likes/*path", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_comment_likes", universalHandler.HandleTableRequest)
		genericProtected.POST("/profile_wall_comment_likes/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_comment_likes", universalHandler.HandleTableRequest)
		genericProtected.PUT("/profile_wall_comment_likes/*path", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_comment_likes", universalHandler.HandleTableRequest)
		genericProtected.DELETE("/profile_wall_comment_likes/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/gomosub_invites", universalHandler.HandleTableRequest)
		genericProtected.GET("/gomosub_invites/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/gomosub_rules_acceptance", universalHandler.HandleTableRequest)
		genericProtected.GET("/gomosub_rules_acceptance/*path", universalHandler.HandleTableRequest)
		// Writes: the frontend inserts/upserts the acceptance row when the user
		// accepts a gomosub's rules (Board.tsx handleAcceptRules). GET-only routes
		// made Gin return 404 before the already-implemented upsert handler was
		// reached — every "Принять правила" click fired a 404 and the frontend
		// crashed on JSON.parse of the non-JSON 404 body.
		genericProtected.POST("/gomosub_rules_acceptance", universalHandler.HandleTableRequest)
		genericProtected.POST("/gomosub_rules_acceptance/*path", universalHandler.HandleTableRequest)
		genericProtected.PUT("/gomosub_rules_acceptance", universalHandler.HandleTableRequest)
		genericProtected.PUT("/gomosub_rules_acceptance/*path", universalHandler.HandleTableRequest)

		genericProtected.GET("/user_settings_changes", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_settings_changes/*path", universalHandler.HandleTableRequest)

		// Emoji packs — specific routes BEFORE any wildcard (Gin requirement)
		genericProtected.GET("/emoji_packs/by-slug/:slug", emojiPacksHandler.GetPackBySlug)
		genericProtected.POST("/custom_emojis/resolve", emojiPacksHandler.ResolveEmojis)
		genericProtected.GET("/emoji_packs", universalHandler.HandleTableRequest)
		genericProtected.GET("/custom_emojis", universalHandler.HandleTableRequest)
		genericProtected.GET("/user_emoji_subscriptions", universalHandler.HandleTableRequest)

		// Protected endpoints
		protected := rest.Group("")
		protected.Use(middleware.AuthCacheMiddleware(authService, redis))
		protected.Use(middleware.RLSSetConfigMiddleware(db))
		{

			protected.POST("/profiles", func(c *gin.Context) {
				c.JSON(501, gin.H{"error": "Profile creation not implemented"})
			})
			protected.PUT("/profiles/:id", profilesHandler.UpdateProfile)
			protected.POST("/boards", boardsHandler.CreateBoard)
			protected.PUT("/boards/:id", boardsHandler.UpdateBoard)
			protected.POST("/boards/:id/invites", boardsHandler.CreateInvite)
			protected.GET("/boards/:id/invites", boardsHandler.GetInvites)
			protected.DELETE("/boards/:id/invites/:inviteId", boardsHandler.DeleteInvite)
			protected.POST("/invites/:code/accept", boardsHandler.AcceptInvite)
			protected.PUT("/threads/:id", threadsHandler.UpdateThread)
			protected.PUT("/threads", threadsHandler.UpdateThread)
			protected.PUT("/posts/:id", postsHandler.UpdatePost)
			protected.PUT("/posts", postsHandler.UpdatePost)
			protected.DELETE("/threads", threadsHandler.DeleteThread)
			protected.DELETE("/posts", postsHandler.DeletePost)

			protected.GET("/boards/:id/backup/export", backupHandler.Export)
			protected.POST("/boards/backup/import", backupHandler.Import)
			protected.POST("/boards/import/info", backupHandler.ImportInfo)

			// Likes
			protected.POST("/threads/:id/like", likesHandler.LikeThread)
			protected.DELETE("/threads/:id/like", likesHandler.UnlikeThread)
			protected.POST("/posts/:id/like", likesHandler.LikePost)
			protected.DELETE("/posts/:id/like", likesHandler.UnlikePost)
			protected.DELETE("/posts/:id", postsHandler.DeletePost)
			protected.GET("/threads/:id/likes", likesHandler.GetThreadLikes)

			// Notifications
			protected.GET("/notifications", notificationsHandler.GetNotifications)
			protected.PUT("/notifications/:id/read", notificationsHandler.MarkAsRead)
			protected.PUT("/notifications/read-all", notificationsHandler.MarkAllAsRead)
			protected.GET("/notifications/unread-count", notificationsHandler.GetUnreadCount)

			// Gifts
			protected.POST("/gifts/send", giftsHandler.SendGift)

			// Drops
			protected.GET("/user/drops", dropsHandler.GetDropsBalance)
			protected.GET("/drops/history", dropsHandler.GetDropsHistory)
			protected.POST("/drops/manual-verify", dropsHandler.ManualVerify)
			protected.GET("/drops/wallet", dropsHandler.GetWalletInfo)
			protected.POST("/drops/transfer", dropsHandler.TransferDrops)
			protected.GET("/drops/users/search", dropsHandler.SearchUsers)

			// Admin gift management
			protected.GET("/admin/gifts", giftAdminHandler.ListGifts)
			protected.POST("/admin/gifts", giftAdminHandler.CreateGift)
			protected.PUT("/admin/gifts/:id", giftAdminHandler.UpdateGift)
			protected.DELETE("/admin/gifts/:id", giftAdminHandler.DeleteGift)
			// Layer management
			protected.GET("/admin/gifts/:id/layers", giftAdminHandler.ListLayers)
			protected.POST("/admin/gifts/:id/layers", giftAdminHandler.CreateLayer)
			protected.DELETE("/admin/gifts/:id/layers/:layerId", giftAdminHandler.DeleteLayer)
			// Gift upgrade
			protected.POST("/gifts/:giftRecordID/upgrade", giftsHandler.UpgradeGift)

			// -- Messenger (clean API) --
			// Read-only endpoints — higher rate limit (300 req/min)
			messengerRead := protected.Group("")
			messengerRead.Use(middleware.MessengerTransactionMiddleware(db))
			messengerRead.Use(middleware.MessengerRateLimitMiddleware(
				middleware.NewMessengerRateLimiter(redis, 300, 1*time.Minute)))
			{
				messengerRead.GET("/messenger/unread-count", messengerHandler.GetUnreadCount)
				messengerRead.GET("/messenger/conversations", messengerHandler.ListConversations)
				messengerRead.GET("/messenger/conversations/:id/messages", messengerHandler.GetMessages)
				messengerRead.GET("/messenger/conversations/:id/receipts", messengerHandler.GetReceipts)
			}

			// Write endpoints — lower rate limit (60 req/min for sends/edits/deletes)
			messengerWrite := protected.Group("")
			messengerWrite.Use(middleware.MessengerTransactionMiddleware(db))
			messengerWrite.Use(middleware.MessengerRateLimitMiddleware(
				middleware.NewMessengerRateLimiter(redis, 120, 1*time.Minute)))
			{
				messengerWrite.POST("/messenger/conversations", messengerHandler.GetOrCreateConversation)
				messengerWrite.POST("/messenger/notes", messengerHandler.GetOrCreateNotesConversation)
				messengerWrite.POST("/messenger/conversations/:id/messages", messengerHandler.SendMessage)
				messengerWrite.PUT("/messenger/conversations/:id/messages/:msgId", messengerHandler.EditMessage)
				messengerWrite.PUT("/messenger/conversations/:id/messages/:msgId/notes-meta", messengerHandler.UpdateNotesMeta)
				messengerWrite.DELETE("/messenger/conversations/:id/messages/:msgId", messengerHandler.DeleteMessage)
				messengerWrite.POST("/messenger/conversations/:id/read", messengerHandler.MarkRead)
				messengerWrite.POST("/messenger/conversations/:id/delivered", messengerHandler.MarkDelivered)
				messengerWrite.POST("/messenger/conversations/:id/pin", messengerHandler.TogglePin)
				messengerWrite.DELETE("/messenger/conversations/:id/leave", messengerHandler.LeaveConversation)

				// Group chats
				messengerWrite.POST("/messenger/groups", messengerHandler.CreateGroupConversation)
				messengerWrite.PUT("/messenger/groups/:id", messengerHandler.UpdateGroup)
				messengerWrite.POST("/messenger/groups/:id/members", messengerHandler.AddGroupMembers)
				messengerWrite.DELETE("/messenger/groups/:id/members/:userId", messengerHandler.RemoveGroupMember)
				messengerRead.GET("/messenger/groups/:id/members", messengerHandler.GetGroupMembers)

				// Friends
				protected.POST("/friends/request", friendsHandler.SendRequest)
				protected.PUT("/friends/request/:id/accept", friendsHandler.AcceptRequest)
				protected.PUT("/friends/request/:id/reject", friendsHandler.RejectRequest)
				protected.DELETE("/friends/request/:id", friendsHandler.CancelRequest)
				protected.DELETE("/friends/:userId", friendsHandler.RemoveFriend)
				protected.GET("/friends", friendsHandler.GetFriends)
				protected.GET("/friends/requests", friendsHandler.GetRequests)
				protected.GET("/friends/status/:userId", friendsHandler.GetFriendStatus)

				// Emoji packs (protected)
				protected.GET("/my-emoji-packs", emojiPacksHandler.GetMyPacks)
				protected.GET("/my-emoji-subscriptions", emojiPacksHandler.GetMySubscriptions)

				// Emoji pack writes use the generic CRUD handler but must be routed
				// through the authenticated/RLS group. Previously only GET routes
				// existed, so creating packs and adding/removing emojis returned 404.
				protected.POST("/emoji_packs", universalHandler.HandleTableRequest)
				protected.PUT("/emoji_packs", universalHandler.HandleTableRequest)
				protected.PUT("/emoji_packs/*path", universalHandler.HandleTableRequest)
				protected.DELETE("/emoji_packs", universalHandler.HandleTableRequest)
				protected.DELETE("/emoji_packs/*path", universalHandler.HandleTableRequest)
				protected.POST("/custom_emojis", universalHandler.HandleTableRequest)
				protected.PUT("/custom_emojis", universalHandler.HandleTableRequest)
				protected.PUT("/custom_emojis/*path", universalHandler.HandleTableRequest)
				protected.DELETE("/custom_emojis", universalHandler.HandleTableRequest)
				protected.DELETE("/custom_emojis/*path", universalHandler.HandleTableRequest)
				protected.POST("/user_emoji_subscriptions", universalHandler.HandleTableRequest)
				protected.DELETE("/user_emoji_subscriptions", universalHandler.HandleTableRequest)
			}
		}
	}

	// RPC functions
	rpc := router.Group("/api/rpc")
	{
		// Public RPC functions
		rpc.GET("/get_post_likes_count", rpcHandler.GetPostLikesCount)
		rpc.GET("/get_thread_likes_count", rpcHandler.GetThreadLikesCount)
		rpc.GET("/get_recent_post_likers", rpcHandler.GetRecentPostLikers)
		rpc.GET("/get_recent_thread_likers", rpcHandler.GetRecentThreadLikers)
		rpc.GET("/get_post_likes_batch", rpcHandler.GetPostLikesBatch)
		rpc.GET("/get_thread_likes_batch", rpcHandler.GetThreadLikesBatch)

		// Emoji resolve (public — guests need to render custom emojis in posts)
		rpc.POST("/resolve_emojis", emojiPacksHandler.ResolveEmojis)

		// Protected RPC functions
		protected := rpc.Group("")
		protected.Use(middleware.AuthMiddlewareWithDB(authService, db))
		{
			protected.GET("/has_user_liked_post", rpcHandler.HasUserLikedPost)
			protected.GET("/has_user_liked_thread", rpcHandler.HasUserLikedThread)
			protected.GET("/get_user_likes_given_count", rpcHandler.GetUserLikesGivenCount)
			protected.GET("/get_user_likes_received_count", rpcHandler.GetUserLikesReceivedCount)
			protected.GET("/get_user_thread_likes_given_count", rpcHandler.GetUserThreadLikesGivenCount)
			protected.GET("/get_user_thread_likes_received_count", rpcHandler.GetUserThreadLikesReceivedCount)
			protected.GET("/get_user_post_likes_received_timestamps", rpcHandler.GetUserPostLikesReceivedTimestamps)
			protected.GET("/get_user_thread_likes_received_timestamps", rpcHandler.GetUserThreadLikesReceivedTimestamps)
			protected.GET("/get_user_thread_reply_timestamps", rpcHandler.GetUserThreadReplyTimestamps)
			protected.GET("/toggle_wall_post_pin", rpcHandler.ToggleWallPostPin)
			protected.POST("/get_avatar_history", rpcHandler.GetAvatarHistory)
			protected.POST("/delete_avatar_from_history", rpcHandler.DeleteAvatarFromHistory)
			protected.POST("/toggle_achievement_pin", rpcHandler.ToggleAchievementPin)
			protected.POST("/award_achievement", rpcHandler.AwardAchievement)

			// GomoSub RPC functions
			protected.POST("/create_gomosub", rpcHandler.CreateGomoSub)
			protected.GET("/get_board_user_permissions", rpcHandler.GetBoardUserPermissions)

			// Thread/Post RPC functions
			protected.POST("/create_thread", rpcHandler.CreateThreadRPC)
			protected.POST("/create_post", rpcHandler.CreatePostRPC)

		}
	}

	// Federation routes
	federation := router.Group("/federation")
	{
		federation.GET("/users/:identifier", func(c *gin.Context) {
			// identifier format: username@domain
			c.JSON(501, gin.H{"error": "Not implemented yet"})
		})
		federation.GET("/gomosubs/:slug", func(c *gin.Context) {
			c.JSON(501, gin.H{"error": "Not implemented yet"})
		})
		federation.GET("/servers", func(c *gin.Context) {
			c.JSON(501, gin.H{"error": "Not implemented yet"})
		})
	}

	// Storage routes - simple stub for frontend
	storage := router.Group("/storage/v1")
	{
		storagePublic := storage.Group("")
		{
			// Keep public buckets anonymous, but put the private uploads auth
			// check in Gin's middleware chain rather than invoking middleware from
			// inside the object handler. This preserves the normal c.Next() order.
			storagePublic.GET("/object/:bucket/*key", func(c *gin.Context) {
				bucket := c.Param("bucket")
				if bucket == "uploads" || bucket == "wall" {
					if !middleware.AuthenticateRequest(c, authService, db) {
						return
					}
					if bucket == "wall" {
						// Wall media keys are <wallOwnerID>/<random>.<ext>. Serve the
						// object only when the caller may view that user's wall:
						// owner, non-private profile, or mutual friend. This is the
						// same predicate as the wall read path, so private photos
						// cannot be fetched by URL guessing.
						key := strings.TrimPrefix(c.Param("key"), "/")
						ownerID := key
						if idx := strings.Index(ownerID, "/"); idx > 0 {
							ownerID = ownerID[:idx]
						}
						viewerID := ""
						if claimsValue, ok := c.Get("claims"); ok {
							if claims, ok2 := claimsValue.(*auth.Claims); ok2 && claims != nil {
								viewerID = claims.UserID
							}
						}
						if ownerID == "" || viewerID == "" || !canViewUserWall(db, viewerID, ownerID) {
							c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
							return
						}
					}
				}
				c.Next()
			}, func(c *gin.Context) {
				if storageHandler == nil {
					bucket := c.Param("bucket")
					key := c.Param("key")
					if bucket == "post-images" && strings.Contains(key, "avatar") {
						c.Header("Content-Type", "image/svg+xml")
						c.Header("Cache-Control", "public, max-age=3600")
						c.String(http.StatusOK, stor.AvatarPlaceholderSVG)
						return
					}
					c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": "Storage not available"})
					return
				}
				storageHandler.ServeObject(c)
			})
		}

		storageProtected := storage.Group("")
		storageProtected.Use(middleware.AuthMiddlewareWithDB(authService, db))
		{
			// Server-side upload: browser sends file to backend, backend uploads to Garage.
			// Avoids CORS/S3-signature issues with direct browser-to-Garage upload.
			storageProtected.POST("/upload", middleware.UploadRateLimitMiddleware(uploadRateLimiter), func(c *gin.Context) {
				if storageHandler == nil {
					c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": "Storage not available"})
					return
				}
				storageHandler.UploadFileWithKey(c)
			})

			// Delete object: backend removes file from Garage (S3 DeleteObject).
			storageProtected.DELETE("/object/:bucket/*key", func(c *gin.Context) {
				if storageHandler == nil {
					c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": "Storage not available"})
					return
				}
				storageHandler.DeleteFile(c)
			})
		}
	}

	// OAuth 2.0 + OpenID Connect endpoints
	// OAuth 2.0 + OpenID Connect endpoints
	// GET /oauth/authorize - if Authorization header is present, process normally.
	// If not (external app redirects the browser), redirect to the frontend consent page.
	oauthGroup := router.Group("/oauth")
	{
		// GET /oauth/authorize
		oauthGroup.GET("/authorize", func(c *gin.Context) {
			authHeader := c.GetHeader("Authorization")
			if authHeader == "" {
				// No auth header — redirect to frontend consent page
				// The frontend will add the Authorization header and call this endpoint
				frontendURL := os.Getenv("FRONTEND_URL")
				if frontendURL == "" {
					if domain := os.Getenv("DOMAIN"); domain != "" {
						frontendURL = "http://" + domain
					} else {
						frontendURL = "http://localhost:8081"
					}
				}
				consentURL := frontendURL + "/oauth/consent?" + c.Request.URL.RawQuery
				log.Printf("Redirecting to consent page: %s", consentURL)
				c.Redirect(http.StatusTemporaryRedirect, consentURL)
				return
			}
			// Auth header present — apply middleware and process
			middleware.AuthMiddleware(authService)(c)
			if !c.IsAborted() {
				oauthHandler.Authorize(c)
			}
		})
		// POST /oauth/token - exchanges code for tokens (no auth, uses client_secret)
		oauthGroup.POST("/token", middleware.OAuthTokenRateLimitMiddleware(oauthRateLimiter), oauthHandler.Token)
		// POST /oauth/revoke - revokes a token
		oauthGroup.POST("/revoke", middleware.OAuthRevokeRateLimitMiddleware(oauthRateLimiter), oauthHandler.Revoke)
		// POST /oauth/introspect - token introspection (RFC 7662)
		oauthGroup.POST("/introspect", oauthHandler.Introspect)
		// GET /oauth/userinfo - requires OAuth Bearer token
		oauthGroup.GET("/userinfo", handlers.OAuthBearerMiddleware(oauthService), oauthHandler.UserInfo)
		// GET /oauth/app-info - public app info for consent page
		oauthGroup.GET("/app-info", oauthHandler.AppInfo)
	}

	// OpenID Connect discovery
	router.GET("/.well-known/openid-configuration", oauthHandler.OpenIDConfiguration)
	router.GET("/.well-known/jwks.json", oauthHandler.JWKS)

	// Dev dashboard config (no auth needed)
	api.GET("/dev-dashboard/config", devDashboardHandler.GetConfig)

	// Developer panel (protected by auth middleware)
	dev := api.Group("/developer")
	dev.Use(middleware.AuthMiddleware(authService))
	{
		dev.GET("/apps", devHandler.ListApps)
		dev.POST("/apps", devHandler.CreateApp)
		dev.GET("/apps/:id", devHandler.GetApp)
		dev.PUT("/apps/:id", devHandler.UpdateApp)
		dev.DELETE("/apps/:id", devHandler.DeleteApp)
		dev.POST("/apps/:id/regenerate-secret", devHandler.RegenerateSecret)
		dev.GET("/apps/:id/tokens", devHandler.ListTokens)
		dev.POST("/apps/:id/revoke-user-tokens", devHandler.RevokeUserTokens)
	}

	// Bot management
	botsHandler := handlers.NewBotsHandler(db)

	bots := api.Group("/bots")
	bots.Use(middleware.AuthMiddleware(authService))
	{
		bots.GET("", botsHandler.ListBots)
		bots.POST("", botsHandler.CreateBot)
		bots.GET("/:id", botsHandler.GetBot)
		bots.PUT("/:id", botsHandler.UpdateBot)
		bots.DELETE("/:id", botsHandler.DeleteBot)
		bots.POST("/:id/toggle", botsHandler.ToggleBot)
		bots.POST("/:id/regenerate-token", botsHandler.RegenerateToken)
	}

	// Integrations (Spotify, etc.)
	integrationsHandler := handlers.NewIntegrationsHandler(db)
	integrationsHandler.SetWebSocketHub(wsHub)
	integrationsHandler.SetRedis(redis)
	integrationsHandler.SetAchievementChecker(achChecker)

	integrationsGroup := api.Group("/integrations")
	{
		// Spotify — public now-playing endpoint
		integrationsGroup.GET("/spotify/now-playing/:user_id", integrationsHandler.GetSpotifyNowPlaying)

		// Spotify OAuth callback — no auth, receives redirect from Spotify
		integrationsGroup.GET("/spotify/callback", integrationsHandler.SpotifyCallback)

		// Protected endpoints (require auth)
		integrationsProtected := integrationsGroup.Group("")
		integrationsProtected.Use(middleware.AuthMiddleware(authService))
		{
			integrationsProtected.GET("/spotify/auth-url", integrationsHandler.GetSpotifyAuthURL)
			integrationsProtected.GET("/spotify/status", integrationsHandler.GetSpotifyStatus)
			integrationsProtected.GET("/spotify/me/state", integrationsHandler.GetSpotifyPlayerState)
			integrationsProtected.DELETE("/spotify/disconnect", integrationsHandler.DisconnectSpotify)
		}
	}

	// WebSocket endpoint — auth via first message, not URL query string.
	if wsHandler != nil {
		router.GET("/ws", wsHandler.HandleWebSocket)

		// Debug endpoint for online users count. M7 (security audit): the raw
		// list of online user IDs is global presence data, so it is gated to
		// platform admins instead of every authenticated user.
		router.GET("/ws/stats", middleware.AuthCacheMiddleware(authService, redis), adminOnlyMiddleware(db), wsHandler.GetOnlineUsers)
	}

}

// adminOnlyMiddleware rejects the request unless the authenticated user holds
// the platform 'admin' role. Used to gate ops/debug endpoints such as /ws/stats
// that would otherwise expose global presence data to every user.
func adminOnlyMiddleware(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsValue, exists := c.Get("claims")
		claims, ok := claimsValue.(*auth.Claims)
		if !exists || !ok || claims == nil || claims.UserID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			c.Abort()
			return
		}
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role = 'admin'`, claims.UserID).Scan(&count); err != nil || count == 0 {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// canViewUserWall reports whether viewerID may view the wall of ownerID
// (owner, public profile whose wall is not hidden (private_hide_wall), or
// mutual friend). Used by the private "wall" media bucket so photos are never
// served to strangers even when the key is known. Mirrors the wall read
// predicate in profileWallFinishSelectQuery.
func canViewUserWall(db *sql.DB, viewerID, ownerID string) bool {
	if viewerID == ownerID {
		return true
	}
	var private, hideWall bool
	if err := db.QueryRow("SELECT COALESCE(private_profile, false), COALESCE(private_hide_wall, false) FROM privacy_settings WHERE user_id = $1", ownerID).Scan(&private, &hideWall); err != nil {
		return err == sql.ErrNoRows
	}
	if !private && !hideWall {
		return true
	}
	var friend bool
	if err := db.QueryRow(`SELECT EXISTS(
		SELECT 1 FROM friendships
		WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
	)`, viewerID, ownerID).Scan(&friend); err != nil {
		return false
	}
	return friend
}
