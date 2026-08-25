package routes

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/api/handlers"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/oauth"
	"github.com/gomo6/backend/internal/push"
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
	// Audio metadata extraction is a disk-touching parse (multipart spool + temp
	// file), so it gets its own per-user budget on top of auth — the frontend
	// calls it once per audio attachment only when client-side parsing fails.
	// Tunable via AUDIO_RATE_LIMIT_PER_MIN (default 30) without a rebuild.
	audioRateLimiter := middleware.NewAuthRateLimiterWithPrefix("audio", redis, ogEnvLimit("AUDIO_RATE_LIMIT_PER_MIN", 30), time.Minute)
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
	// Initialize the achievements engine (must be before handlers that use it).
	// The catalog lives in Go code; the DB table is only a synced mirror.
	achCatalog, err := achievements.Default()
	if err != nil {
		log.Fatalf("achievements: invalid catalog: %v", err)
	}
	achEngine := achievements.New(db, achCatalog)
	achEngine.RecomputeStats = func(userID string) { handlers.RecomputeUserProfileStats(db, userID) }

	profilesHandler := handlers.NewProfilesHandler(db)
	profilesHandler.SetRedis(redis)
	profilesHandler.SetAchievementEngine(achEngine)
	likesHandler := handlers.NewLikesHandler(db, redis)
	likesHandler.SetWebSocketHub(wsHub)
	likesHandler.SetAchievementEngine(achEngine)
	notificationsHandler := handlers.NewNotificationsHandler(db)
	notificationsHandler.SetRedis(redis)
	notificationsHandler.SetWebSocketHub(wsHub)

	// Web Push (PWA): VAPID-keyed push sender + subscription/preferences handler.
	// push.New returns nil when VAPID keys are not configured, disabling push
	// cleanly (no-op delivery + ServiceUnavailable on the management endpoints).
	pushService := push.New(db)
	handlers.SetPushService(pushService)
	pushHandler := handlers.NewPushHandler(pushService)
	rpcHandler := handlers.NewRPCHandler(db)
	rpcHandler.SetRedis(redis)
	rpcHandler.SetWebSocketHub(wsHub)
	rpcHandler.SetAchievementEngine(achEngine)
	universalHandler := handlers.NewUniversalHandler(db, wsHub)
	universalHandler.SetRedis(redis)
	universalHandler.SetAchievementEngine(achEngine)
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
	translationsHandler := handlers.NewTranslationsHandler(db)

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
		// Audio metadata endpoint. Authenticated + per-user rate limited: guests
		// have no reason to parse server-side metadata, and the multipart parse
		// touches disk, so anonymous unlimited access was a disk-exhaustion DoS
		// (the endpoint used to write any-size uploads to /tmp).
		api.POST("/audio/metadata",
			middleware.AuthMiddleware(authService),
			middleware.AuthRateLimitMiddleware(audioRateLimiter),
			audioHandler.ExtractAudioMetadata)

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
		// Authenticated activity refreshes the user's presence marker so
		// last_seen tracks real usage, not just the WebSocket connection
		// (throttled to one touch per 5 minutes per user). Runs BEFORE the data
		// cache so cache hits still count as activity.
		if wsHub != nil {
			rest.Use(middleware.PresenceActivity(wsHub.TouchPresence, websocket.PresenceTouchEvery))
		}
		// Apply data caching middleware for GET requests (2 minute TTL). Cache hits
		// abort before the rate limiter below, so repeated reads within the TTL are
		// free: no rate-limit budget burned and no DB hit. Only cache misses and
		// write requests consume the rate-limit budget.
		rest.Use(middleware.DataCacheMiddleware(redis, middleware.DefaultDataCacheTTL))
		// Global rate limiting: per-user budget for authenticated requests, per-IP
		// for anonymous (env-tunable). See global_rate_limit.go.
		rest.Use(middleware.GlobalRateLimitMiddleware(globalRateLimiter))

		// Search endpoint (full-text, public). A stricter IP-keyed limiter sits
		// on top of the global per-IP budget because anonymous search is a
		// username enumeration surface (L1). Authenticated callers are keyed by
		// user ID instead. The "search" Redis prefix keeps this budget separate
		// from the auth limiters' (login/register/auth-me), so searching can
		// never deplete a user's login budget or vice versa. Repeated identical
		// queries are served from the data cache (applied above), so this
		// budget only burns on distinct searches.
		searchRateLimiter := middleware.NewAuthRateLimiterWithPrefix("search", redis, 120, time.Minute)
		rest.GET("/search", middleware.IPRateLimitMiddleware(searchRateLimiter), searchHandler.Search)

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

		// Profile visibility flags (public — the profile page needs to know whether
		// a foreign profile is private and which sections are hidden to render the
		// right tabs and the "private profile" wall notice). The generic
		// privacy_settings CRUD surface is viewer-scoped, so it cannot serve this.
		// The flags are the same rules the server enforces on content, so exposing
		// them leaks nothing that was hidden.
		privacyHandler := handlers.NewPrivacyHandler(db)
		rest.GET("/users/:id/privacy", privacyHandler.GetUserPrivacy)

		// Push VAPID public key (public) — needed by the frontend before it can
		// call PushManager.subscribe / show the permission prompt.
		rest.GET("/push/vapid-public-key", pushHandler.GetVAPIDPublicKey)

		// Gift catalog (public)
		rest.GET("/gift_catalog", giftsHandler.GetGiftCatalog)
		// User gifts (public)
		rest.GET("/user_gifts", giftsHandler.GetUserGifts)
		// Client-side JavaScript error reporting (public, rate-limited)
		rest.POST("/client-errors", clientErrorsHandler.ReportClientError)

		// Community translations — public read (serves the effective overlay),
		// ranked by net votes with the caller's own vote when authenticated.
		rest.GET("/translations", translationsHandler.ListTranslations)

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
		//
		// Universal CRUD routes are generated from the declarative table
		// registry (handlers.GenericTables) by registerGenericTableRoutes
		// below — each table declares its read group (guest/authenticated),
		// write methods and middleware group in ONE place. Previously every
		// table needed ~8 manual registrations across three groups and a
		// missing one silently 404'd the endpoint (the recurring "GET-only
		// routes made Gin return 404" bug).
		//
		// Security notes:
		//  - Personal tables are viewer-scoped by genericReadScopeUser, so
		//    anonymous callers receive an empty result set — never another
		//    user's rows.
		//  - The gomosub structure tables carry an extra board-visibility
		//    predicate (genericGomosubVisibility): rows of PRIVATE gomosubs
		//    are invisible to guests and non-members.
		//  - Profile walls apply the same per-wall privacy predicate as the
		//    authenticated path (private walls stay hidden).
		genericRead := rest.Group("")
		{
			// Emoji routes that are NOT part of the generic CRUD surface: the
			// by-slug public gate and the guest emoji resolver.
			genericRead.GET("/emoji_packs/by-slug/:slug", emojiPacksHandler.GetPackBySlug)
			genericRead.POST("/custom_emojis/resolve", emojiPacksHandler.ResolveEmojis)
		}

		genericProtected := rest.Group("")
		genericProtected.Use(middleware.AuthCacheMiddleware(authService, redis))
		genericProtected.Use(middleware.ValidateCSRFMiddleware())

		// The authenticated group for tables whose writes must run through the
		// RLS middleware chain (emoji tables). Declared here so the generic
		// route loop can target it; the rest of the protected endpoints below
		// reuse this same group.
		protected := rest.Group("")
		protected.Use(middleware.AuthCacheMiddleware(authService, redis))
		protected.Use(middleware.RLSSetConfigMiddleware(db))

		// Generate every generic CRUD route from the registry: guest GETs on
		// genericRead, authenticated GETs and writes on genericProtected, and
		// emoji writes on protected.
		registerGenericTableRoutes(genericRead, genericProtected, protected, universalHandler.HandleTableRequest)

		// Protected endpoints (the `protected` group itself is declared above,
		// next to the generic CRUD routes — see registerGenericTableRoutes).
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
			protected.GET("/notifications/:id", notificationsHandler.GetNotification)
			protected.PUT("/notifications/:id/read", notificationsHandler.MarkAsRead)
			protected.PUT("/notifications/read-all", notificationsHandler.MarkAllAsRead)
			protected.GET("/notifications/unread-count", notificationsHandler.GetUnreadCount)

			// Push (PWA) — subscription management + per-type preferences. The
			// VAPID public key endpoint is registered separately on the public
			// rest group (GetVAPIDPublicKey), since the frontend needs it before
			// the browser will show the permission prompt.
			protected.POST("/push/subscribe", pushHandler.Subscribe)
			protected.DELETE("/push/subscribe", pushHandler.Unsubscribe)
			protected.GET("/push/preferences", pushHandler.GetPreferences)
			protected.PUT("/push/preferences", pushHandler.UpdatePreferences)

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

				// Community translations — writes/votes require auth (same group as
				// friends/messenger writes).
				protected.POST("/translations", translationsHandler.SubmitTranslation)
				protected.POST("/translations/:id/vote", translationsHandler.VoteTranslation)
				protected.DELETE("/translations/:id", translationsHandler.DeleteTranslation)
			}
		}
	}

	// RPC functions
	rpc := router.Group("/api/rpc")
	{
		// Public RPC functions — anonymous callers can hammer the likes-batch,
		// recent-likers, emoji-resolve and avatar-history endpoints, so the whole
		// group carries its own rate limiter with a stricter per-IP budget than
		// the generic REST surface (guests cannot be attributed to a person, so
		// everyone on one IP shares the bucket). Authenticated requests are keyed
		// by user ID with a generous budget. OptionalAuth runs first so the
		// limiter can distinguish the two; the protected subgroup below adds the
		// strict AuthMiddleware on top.
		rpcRateLimiter := middleware.NewGlobalRateLimiterFromEnvWithPrefix(
			"rpc", redis, time.Minute,
			middleware.DefaultRateLimitPerUser, // authenticated: 900 req/min (RPC_RATE_LIMIT_PER_USER)
			120,                                // anonymous: 120 req/min per IP (RPC_RATE_LIMIT_PER_IP)
		)
		rpc.Use(middleware.OptionalAuthMiddlewareWithDB(authService, db))
		rpc.Use(middleware.GlobalRateLimitMiddleware(rpcRateLimiter))

		// Public RPC functions
		rpc.GET("/get_post_likes_count", rpcHandler.GetPostLikesCount)
		rpc.GET("/get_thread_likes_count", rpcHandler.GetThreadLikesCount)
		rpc.GET("/get_recent_post_likers", rpcHandler.GetRecentPostLikers)
		rpc.GET("/get_recent_thread_likers", rpcHandler.GetRecentThreadLikers)
		rpc.GET("/get_post_likes_batch", rpcHandler.GetPostLikesBatch)
		rpc.GET("/get_thread_likes_batch", rpcHandler.GetThreadLikesBatch)

		// Emoji resolve (public — guests need to render custom emojis in posts)
		rpc.POST("/resolve_emojis", emojiPacksHandler.ResolveEmojis)

		// Avatar history (public — guests see profile avatars; the handler
		// enforces private-profile privacy itself)
		rpc.POST("/get_avatar_history", rpcHandler.GetAvatarHistory)

		// Wall-post views (public — guests scroll walls too; the handler
		// dedupes per viewer and gates private walls itself)
		rpc.POST("/record_wall_views", rpcHandler.RecordWallViews)

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
			protected.POST("/delete_avatar_from_history", rpcHandler.DeleteAvatarFromHistory)
			protected.POST("/toggle_achievement_pin", rpcHandler.ToggleAchievementPin)

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
						// Wall media keys are <uploaderID>/<random>.<ext> — the prefix is
						// the UPLOADER's id, not necessarily the wall owner's (a user can
						// post with an image on another user's wall). Serve the object
						// only when the caller may view the wall the attachment was
						// actually published on: owner, non-private profile, or mutual
						// friend — the same predicate as the wall read path. The wall
						// owner is resolved from the posts that reference the attachment
						// (image_url / attachments JSONB); the uploader gate is only the
						// fallback for orphaned or guessed keys.
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
						if ownerID == "" || viewerID == "" {
							c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
							return
						}
						// found is load-bearing: once an uploader-authored post references
						// the key, only that post's wall visibility matters — the uploader
						// gate must NOT be consulted (it would re-leak files a public
						// uploader placed on a private wall). The uploader gate applies
						// only to keys no legitimate post references (orphans/guessing).
						found, allowed := wallAttachmentAccess(db, viewerID, ownerID, key)
						if (found && !allowed) || (!found && !canViewUserWall(db, viewerID, ownerID)) {
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
						c.Header("Content-Security-Policy", "sandbox")
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
	integrationsHandler.SetAchievementEngine(achEngine)

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

	// ── Social previews (Open Graph) ────────────────────────────────────────
	// The SPA cannot provide OG tags for deep links (Telegram, WhatsApp, X,
	// Reddit, Discord, Slack, VK, … fetch them without executing JS). Caddy
	// routes social-crawler requests to this backend; the NoRoute fallback
	// renders a full HTML page with per-content OG/Twitter meta tags.
	ogHandler := handlers.NewSocialPreviewHandler(db)
	// Crawler requests are anonymous by nature, so both surfaces are guarded
	// by per-IP budgets (fail open without Redis): the page renderer and the
	// wall image proxy each run 1–2 indexed DB queries per request and would
	// otherwise be a cheap way to load the database (guessed keys, repeated
	// fetches). Every crawler request that reaches content resolution — even
	// ones that 404 after the DB lookup — consumes the renderer's budget (the
	// limiter runs inside Render, before resolve). Budgets are env-tunable:
	//   OG_RATE_LIMIT_PER_MIN       (default 120) — OG page renders / min / IP
	//   OG_IMAGE_RATE_LIMIT_PER_MIN (default 240) — wall preview images / min / IP
	ogPageLimiter := middleware.NewAuthRateLimiterWithPrefix("og", redis, ogEnvLimit("OG_RATE_LIMIT_PER_MIN", 120), time.Minute)
	ogImageLimiter := middleware.NewAuthRateLimiterWithPrefix("ogimg", redis, ogEnvLimit("OG_IMAGE_RATE_LIMIT_PER_MIN", 240), time.Minute)
	ogHandler.SetRateLimiter(ogPageLimiter)
	router.NoRoute(ogHandler.Render)

	// Public proxy for the private `wall` bucket, used as the og:image source
	// for shared wall posts. Crawlers have no session, so the image cannot go
	// through the authenticated /storage/v1/object/wall path. Access is gated
	// by the same predicate as the wall read path, evaluated anonymously: only
	// images referenced by wall posts on publicly visible walls are served —
	// private walls stay unreadable even when the key is known.
	router.GET("/og/wall/*key", middleware.IPRateLimitMiddleware(ogImageLimiter), func(c *gin.Context) {
		key := strings.TrimPrefix(c.Param("key"), "/")
		if key == "" || storageHandler == nil {
			c.Status(http.StatusNotFound)
			return
		}
		uploaderID := key
		if idx := strings.Index(uploaderID, "/"); idx > 0 {
			uploaderID = uploaderID[:idx]
		}
		found, allowed := wallAttachmentAccess(db, "", uploaderID, key)
		if !found || !allowed {
			c.Status(http.StatusNotFound)
			return
		}
		// Rewrite the params so the existing ServeObject streams the object
		// (Range support, safe Content-Type headers, caching) unchanged.
		c.Params = gin.Params{
			{Key: "bucket", Value: "wall"},
			{Key: "key", Value: key},
		}
		storageHandler.ServeObject(c)
	})

	// Achievements: mirror the catalog into the DB and recompute groups whose
	// definitions changed since the last boot (change detection by hash).
	// Sync is fast (a few upserts) and runs before serving; the recompute of
	// dirty groups is heavier, so it happens in the background.
	if _, err := achEngine.Sync(context.Background()); err != nil {
		log.Printf("[Achievements] catalog sync failed: %v", err)
	} else {
		go achEngine.RecomputeDirty(context.Background())
	}

	// One-time full backfill: after a catalog rework (or a fresh DB) everyone's
	// progress is recomputed from live data — old rows that don't match the new
	// catalog are dropped and counters are seeded from the real source tables,
	// so unlocks appear immediately instead of after the next action. Guarded by
	// a Redis marker so it only runs once per Redis lifetime; on a fresh DB the
	// backfill also populates the user_achievement_counters table.
	if redis != nil {
		backfillKey := "achievements:backfill:v1"
		claimed, err := redis.SetNX(context.Background(), backfillKey, "1", 0).Result()
		if err == nil && claimed {
			go achEngine.RecomputeAll(context.Background())
		} else if err != nil {
			log.Printf("[Achievements] backfill marker check failed: %v", err)
		}
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

// ogEnvLimit reads an integer env var for the OG preview rate budgets,
// falling back to def when unset or invalid.
func ogEnvLimit(name string, def int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// escapeLikePattern escapes LIKE wildcards so a storage key (which legitimately
// contains '_' in the timestamp segment) is matched literally.
func escapeLikePattern(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// wallAttachmentAccess reports whether viewerID may fetch a wall media object
// identified by key and uploaded by uploaderID. Returns (found, allowed):
// found=true when at least one post AUTHORED BY THE UPLOADER references the key
// (image_url or attachments JSONB); allowed=true when any referencing post sits
// on a wall the viewer may see (owner, public profile with a visible wall, or
// mutual friend).
//
// Wall object keys are namespaced by the UPLOADER's user id, but the uploader
// is not necessarily the wall owner — a private user posting with an image on a
// public user's wall publishes that image to the public. Gating on the uploader
// alone wrongly 403s such files. The visibility predicate is the same one
// profileWallFinishSelectQuery applies to every wall row, so private photos
// cannot be fetched by URL guessing and published photos are served.
//
// The lookup is scoped to posts authored by the uploader (author_id = key
// prefix — guaranteed at creation by the upload key-prefix check and
// enforcePostOwnership). This is a security boundary: the write path accepts
// client-supplied image_url/attachments without validating ownership, so an
// unrestricted scan would let any authenticated user reference a private
// user's key from a post on their own public wall and thereby unlock the file.
// Scoping to the uploader's posts closes that bypass and uses the
// idx_profile_wall_posts_author_id index.
//
// When found=false (deleted post, orphaned upload, or guessed key) the caller
// falls back to the uploader-scoped check so orphaned files of private users
// stay unreadable. DB errors fail closed (found=false, allowed=false).
func wallAttachmentAccess(db *sql.DB, viewerID, uploaderID, key string) (found, allowed bool) {
	// Derivative objects (.preview.jpg / .poster.jpg) are implementation
	// details of their base object: authorize them against the base key so
	// previews and video posters stay reachable wherever the original is. The
	// visibility predicate still gates the base object, so a private file's
	// derivative stays private — this only widens matching, never access.
	base := key
	switch {
	case strings.HasSuffix(base, ".preview.jpg"):
		base = strings.TrimSuffix(base, ".preview.jpg")
	case strings.HasSuffix(base, ".poster.jpg"):
		base = strings.TrimSuffix(base, ".poster.jpg")
	}
	pattern := "%" + escapeLikePattern(base) + "%"

	// Single query mirroring the wall read predicate against each referencing
	// post's wall owner (p.user_id). EXISTS short-circuits on the first
	// visible wall, so a file published across several walls is served as soon
	// as any of them is visible to the viewer.
	// viewerID is the empty string for anonymous crawlers (the /og/wall
	// proxy). The uuid columns must be compared via ::text: passing ""
	// straight into a uuid parameter makes Postgres raise
	// "invalid input syntax for type uuid", the query errors and every
	// anonymous wall-image request 404s even for public walls.
	var visible bool
	if err := db.QueryRow(`
SELECT EXISTS(
  SELECT 1
  FROM profile_wall_posts p
  LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
  WHERE p.author_id = $3
    AND (p.image_url LIKE $1 ESCAPE '\' OR p.attachments::text LIKE $1 ESCAPE '\')
    AND (p.user_id::text = $2
         OR (COALESCE(ps.private_profile, false) = false AND COALESCE(ps.private_hide_wall, false) = false)
         OR EXISTS (SELECT 1 FROM friendships f
                    WHERE (f.user1_id::text = p.user_id::text AND f.user2_id::text = $2)
                       OR (f.user1_id::text = $2 AND f.user2_id::text = p.user_id::text)))
  LIMIT 1
)`, pattern, viewerID, uploaderID).Scan(&visible); err != nil {
		return false, false
	}
	if visible {
		return true, true
	}

	// Not visible to this viewer — distinguish "published on a wall I cannot
	// see" (deny) from "published nowhere" (caller falls back to the
	// uploader gate).
	var referenced bool
	if err := db.QueryRow(`
SELECT EXISTS(
  SELECT 1 FROM profile_wall_posts p
  WHERE p.author_id = $2
    AND (p.image_url LIKE $1 ESCAPE '\' OR p.attachments::text LIKE $1 ESCAPE '\')
)`, pattern, uploaderID).Scan(&referenced); err != nil {
		return false, false
	}
	return referenced, false
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
	// Same ::text cast as in wallAttachmentAccess: viewerID may be empty for
	// anonymous callers, and uuid-typed columns reject "" outright.
	var friend bool
	if err := db.QueryRow(`SELECT EXISTS(
		SELECT 1 FROM friendships
		WHERE (user1_id::text = $1 AND user2_id::text = $2) OR (user1_id::text = $2 AND user2_id::text = $1)
	)`, viewerID, ownerID).Scan(&friend); err != nil {
		return false
	}
	return friend
}

// ─── Universal CRUD route generation ────────────────────────────────────────

// registerGenericTableRoutes generates every generic CRUD route from the
// declarative table registry (handlers.GenericTables). The registry is the
// single source of truth for which tables exist and how they are routed — the
// handler allow-list (UniversalHandler.HandleTableRequest), the read/write
// deny lists and the ownership/visibility scopes all read the same entries, so
// a table can never be routable without being allow-listed, and adding a table
// is a one-line registry change instead of ~8 coordinated edits.
//
// Group semantics:
//   - guest:     OptionalAuth — claims when present, anonymous allowed. Carries
//     the viewer-keyed data cache and the global rate limiter.
//   - protected: AuthCacheMiddleware + CSRF.
//   - rls:       the authenticated group with the RLS middleware chain (the
//     no-op RLSSetConfigMiddleware) — used by the emoji tables.
func registerGenericTableRoutes(guest, protected, rls *gin.RouterGroup, handler func(*gin.Context)) {
	for _, meta := range handlers.GenericTables() {
		base := "/" + meta.Name

		// Reads (GET + optional wildcard) on the group the table declares.
		switch meta.ReadAccess {
		case handlers.GuestRead:
			guest.GET(base, handler)
			if meta.ReadWildcard {
				guest.GET(base+"/*path", handler)
			}
		case handlers.ProtectedRead:
			protected.GET(base, handler)
			if meta.ReadWildcard {
				protected.GET(base+"/*path", handler)
			}
		}

		// Writes on the group the table declares (default: the CSRF-protected
		// generic group; emoji tables go through the RLS group).
		for _, route := range meta.Writes {
			target := protected
			if meta.WriteGroup == handlers.RLSWrite {
				target = rls
			}
			target.Handle(route.Method, base, handler)
			if route.Wildcard {
				target.Handle(route.Method, base+"/*path", handler)
			}
		}
	}
}
