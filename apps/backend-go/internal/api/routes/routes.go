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
	authRateLimiter := middleware.NewAuthRateLimiter(redis, 100, time.Minute) // 100 req/min for auth/me
	oauthRateLimiter := middleware.NewOAuthRateLimiter(20, 10, time.Minute)   // 20/min token, 10/min revoke

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
	var storageHandler *storageHandlers.StorageHandler
	storageClient, err := stor.NewStorageClient()
	if err != nil {
		log.Printf("Warning: failed to initialize storage client: %v", err)
		storageHandler = nil
	} else {
		storageHandler = storageHandlers.NewStorageHandler(storageClient)
	}

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
			authGroup.POST("/register", authHandler.Register)
			authGroup.POST("/login", authHandler.Login)
			authGroup.POST("/refresh", middleware.AuthMiddleware(authService), authHandler.Refresh)
			authGroup.POST("/logout", middleware.AuthMiddleware(authService), authHandler.Logout)
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
			authGroup.POST("/verify-2fa", authHandler.Verify2FA)

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
		}
	}

	// REST compatibility routes
	rest := router.Group("/api/v1")
	{
		// Apply data caching middleware for GET requests (2 minute TTL)
		rest.Use(middleware.DataCacheMiddleware(redis, middleware.DefaultDataCacheTTL))
		// Populate claims if auth token is present (does not block anonymous requests)
		rest.Use(middleware.OptionalAuthMiddlewareWithDB(authService, db))

		// Search endpoint (full-text, public)
		rest.GET("/search", searchHandler.Search)

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

		// Drops packages (public)
		rest.GET("/drops/packages", dropsHandler.GetDropsPackages)

		// DePay integration (public — no auth, signature verified by handler)
		rest.POST("/drops/config", dropsHandler.DropsConfig)
		rest.POST("/drops/callback", dropsHandler.DropsCallback)

		// Additional tables (frontend compatibility)
		rest.Any("/user_roles", universalHandler.HandleTableRequest)
		rest.Any("/user_roles/*path", universalHandler.HandleTableRequest)

		rest.Any("/gomosub_memberships", universalHandler.HandleTableRequest)
		rest.Any("/gomosub_memberships/*path", universalHandler.HandleTableRequest)

		rest.Any("/channels", universalHandler.HandleTableRequest)
		rest.Any("/channels/*path", universalHandler.HandleTableRequest)

		rest.Any("/gomosub_roles", universalHandler.HandleTableRequest)
		rest.Any("/gomosub_roles/*path", universalHandler.HandleTableRequest)

		rest.Any("/channel_permissions", universalHandler.HandleTableRequest)
		rest.Any("/channel_permissions/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_session_time", universalHandler.HandleTableRequest)
		rest.Any("/user_session_time/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_achievements", universalHandler.HandleTableRequest)
		rest.Any("/user_achievements/*path", universalHandler.HandleTableRequest)

		rest.Any("/achievements", universalHandler.HandleTableRequest)
		rest.Any("/achievements/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_terms_acceptance", universalHandler.HandleTableRequest)
		rest.Any("/user_terms_acceptance/*path", universalHandler.HandleTableRequest)

		rest.Any("/profile_customization", universalHandler.HandleTableRequest)
		rest.Any("/profile_customization/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_placeholders", universalHandler.HandleTableRequest)
		rest.Any("/user_placeholders/*path", universalHandler.HandleTableRequest)

		rest.Any("/polls", universalHandler.HandleTableRequest)
		rest.Any("/polls/*path", universalHandler.HandleTableRequest)

		rest.Any("/poll_votes", universalHandler.HandleTableRequest)
		rest.Any("/poll_votes/*path", universalHandler.HandleTableRequest)

		rest.Any("/thread_subscriptions", universalHandler.HandleTableRequest)
		rest.Any("/thread_subscriptions/*path", universalHandler.HandleTableRequest)

		rest.Any("/privacy_settings", universalHandler.HandleTableRequest)
		rest.Any("/privacy_settings/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_daily_visits", universalHandler.HandleTableRequest)
		rest.Any("/user_daily_visits/*path", universalHandler.HandleTableRequest)

		rest.Any("/thread_custom_message_visits", universalHandler.HandleTableRequest)
		rest.Any("/thread_custom_message_visits/*path", universalHandler.HandleTableRequest)

		rest.Any("/profile_wall_posts", universalHandler.HandleTableRequest)
		rest.Any("/profile_wall_posts/*path", universalHandler.HandleTableRequest)

		rest.Any("/profile_wall_post_comments", universalHandler.HandleTableRequest)
		rest.Any("/profile_wall_post_comments/*path", universalHandler.HandleTableRequest)

		rest.Any("/profile_wall_post_likes", universalHandler.HandleTableRequest)
		rest.Any("/profile_wall_post_likes/*path", universalHandler.HandleTableRequest)

		rest.Any("/profile_wall_post_reposts", universalHandler.HandleTableRequest)
		rest.Any("/profile_wall_post_reposts/*path", universalHandler.HandleTableRequest)

		rest.Any("/gomosub_invites", universalHandler.HandleTableRequest)
		rest.Any("/gomosub_invites/*path", universalHandler.HandleTableRequest)

		rest.Any("/gomosub_rules_acceptance", universalHandler.HandleTableRequest)
		rest.Any("/gomosub_rules_acceptance/*path", universalHandler.HandleTableRequest)

		rest.Any("/reports", universalHandler.HandleTableRequest)
		rest.Any("/reports/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_bans", universalHandler.HandleTableRequest)
		rest.Any("/user_bans/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_settings_changes", universalHandler.HandleTableRequest)
		rest.Any("/user_settings_changes/*path", universalHandler.HandleTableRequest)

		// Protected endpoints
		protected := rest.Group("")
		protected.Use(middleware.AuthCacheMiddleware(authService, redis))
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

			// -- Messenger (clean API) --
			// Read-only endpoints — higher rate limit (300 req/min)
			messengerRead := protected.Group("")
			messengerRead.Use(middleware.MessengerRateLimitMiddleware(
				middleware.NewMessengerRateLimiter(300, 1*time.Minute)))
			{
				messengerRead.GET("/messenger/unread-count", messengerHandler.GetUnreadCount)
				messengerRead.GET("/messenger/conversations", messengerHandler.ListConversations)
				messengerRead.GET("/messenger/conversations/:id/messages", messengerHandler.GetMessages)
				messengerRead.GET("/messenger/conversations/:id/receipts", messengerHandler.GetReceipts)
			}

			// Write endpoints — lower rate limit (60 req/min for sends/edits/deletes)
			messengerWrite := protected.Group("")
			messengerWrite.Use(middleware.MessengerRateLimitMiddleware(
				middleware.NewMessengerRateLimiter(120, 1*time.Minute)))
			{
				messengerWrite.POST("/messenger/conversations", messengerHandler.GetOrCreateConversation)
				messengerWrite.POST("/messenger/conversations/:id/messages", messengerHandler.SendMessage)
				messengerWrite.PUT("/messenger/conversations/:id/messages/:msgId", messengerHandler.EditMessage)
				messengerWrite.DELETE("/messenger/conversations/:id/messages/:msgId", messengerHandler.DeleteMessage)
				messengerWrite.POST("/messenger/conversations/:id/read", messengerHandler.MarkRead)
				messengerWrite.POST("/messenger/conversations/:id/delivered", messengerHandler.MarkDelivered)
				messengerWrite.POST("/messenger/conversations/:id/pin", messengerHandler.TogglePin)
				messengerWrite.DELETE("/messenger/conversations/:id/leave", messengerHandler.LeaveConversation)

				// Friends
				protected.POST("/friends/request", friendsHandler.SendRequest)
				protected.PUT("/friends/request/:id/accept", friendsHandler.AcceptRequest)
				protected.PUT("/friends/request/:id/reject", friendsHandler.RejectRequest)
				protected.DELETE("/friends/request/:id", friendsHandler.CancelRequest)
				protected.DELETE("/friends/:userId", friendsHandler.RemoveFriend)
				protected.GET("/friends", friendsHandler.GetFriends)
				protected.GET("/friends/requests", friendsHandler.GetRequests)
				protected.GET("/friends/status/:userId", friendsHandler.GetFriendStatus)
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
		rpc.GET("/get_thread_likes_batch", rpcHandler.GetThreadLikesBatch)

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
			storagePublic.GET("/object/:bucket/*key", func(c *gin.Context) {
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
			storageProtected.POST("/upload", func(c *gin.Context) {
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
			integrationsProtected.DELETE("/spotify/disconnect", integrationsHandler.DisconnectSpotify)
		}
	}

	// WebSocket endpoint — auth via first message, not URL query string.
	if wsHandler != nil {
		router.GET("/ws", wsHandler.HandleWebSocket)

		// Debug endpoint for online users count (protected, admin only in production)
		router.GET("/ws/stats", middleware.AuthCacheMiddleware(authService, redis), wsHandler.GetOnlineUsers)
	}

}
