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

func SetupRoutes(router *gin.Engine, db *sql.DB, redis *redis.Client, wsHub *websocket.Hub, botManager interface{}) {
	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "websocket": wsHub != nil})
	})

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(db)
	// Initialize auth service
	authService := auth.NewAuthService()

	// Initialize OAuth service and handlers
	oauthService := oauth.NewOAuthService(db, authService)
	oauthHandler := handlers.NewOAuthHandler(db, oauthService, authService)
	devHandler := handlers.NewDeveloperHandler(db, oauthService)

	// Initialize rate limiters
	messengerRateLimiter := middleware.NewMessengerRateLimiter()
	authRateLimiter := middleware.NewAuthRateLimiter(100, time.Minute) // 100 requests per minute for auth/me
	oauthRateLimiter := middleware.NewOAuthRateLimiter(20, 10, time.Minute) // 20/min for token, 10/min for revoke

	// Initialize BotEventPublisher
	botEventPublisher := handlers.NewBotEventPublisher(redis)

	// Initialize WebSocket handler if hub is provided
	var wsHandler *websocket.Handler
	if wsHub != nil {
		wsHandler = websocket.NewHandler(wsHub, authService)
	}
	boardsHandler := handlers.NewBoardsHandler(db)
	threadsHandler := handlers.NewThreadsHandler(db)
	threadsHandler.SetBotEventPublisher(botEventPublisher)
	threadsHandler.SetRedis(redis)
	postsHandler := handlers.NewPostsHandler(db, wsHub)
	postsHandler.SetBotEventPublisher(botEventPublisher)
	postsHandler.SetRedis(redis)
	profilesHandler := handlers.NewProfilesHandler(db)
	profilesHandler.SetRedis(redis)
	likesHandler := handlers.NewLikesHandler(db, redis)
	notificationsHandler := handlers.NewNotificationsHandler(db)
	notificationsHandler.SetRedis(redis)
	rpcHandler := handlers.NewRPCHandler(db)
	universalHandler := handlers.NewUniversalHandler(db, wsHub)
	universalHandler.SetBotEventPublisher(botEventPublisher)
	universalHandler.SetRedis(redis)
	audioHandler := handlers.NewAudioHandler()
	botHandler := handlers.NewBotHandler(db)
	botHandler.SetBotManager(botManager)
	userStatusHandler := handlers.NewUserStatusHandler(db, wsHub)
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

		// Bot routes (protected)
		bots := api.Group("/bots")
		bots.Use(middleware.AuthMiddleware(authService))
		{
			bots.POST("", botHandler.CreateBot)
			bots.GET("", botHandler.GetBots)
			bots.GET("/:id", botHandler.GetBot)
			bots.PUT("/:id", botHandler.UpdateBot)
			bots.DELETE("/:id", botHandler.DeleteBot)
			bots.POST("/:id/toggle", botHandler.ToggleBot)
			bots.GET("/:id/logs", botHandler.GetBotLogs)
			bots.GET("/:id/stats", botHandler.GetBotStats)
			bots.DELETE("/:id/logs", botHandler.ClearBotLogs)
		}

		// Auth routes
		authGroup := api.Group("/auth")
		{
			authGroup.POST("/register", authHandler.Register)
			authGroup.POST("/login", authHandler.Login)
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
		}
	}

	// Supabase compatibility routes
	rest := router.Group("/rest/v1")
	{
		// Apply data caching middleware for GET requests (30 second TTL)
		rest.Use(middleware.DataCacheMiddleware(redis, 30*time.Second))

		// Public endpoints (no auth required)
		rest.GET("/profiles", profilesHandler.GetProfiles)
		rest.GET("/profiles/:id", profilesHandler.GetProfile)
		rest.GET("/boards", boardsHandler.GetBoards)
		rest.GET("/boards/:slug", boardsHandler.GetBoard)
		rest.GET("/threads", threadsHandler.GetThreads)
		rest.GET("/threads/:id", threadsHandler.GetThread)
		rest.GET("/posts", postsHandler.GetPosts)
		rest.GET("/posts/:id", postsHandler.GetPost)

		// User status endpoints
		rest.GET("/users/online", userStatusHandler.GetOnlineUsers)
		rest.GET("/users/:id/status", userStatusHandler.GetUserStatus)
		rest.POST("/users/status/bulk", userStatusHandler.GetBulkUserStatus)

		// Additional tables (frontend compatibility)
		rest.Any("/user_roles", universalHandler.HandleTableRequest)
		rest.Any("/user_roles/*path", universalHandler.HandleTableRequest)

		rest.Any("/gomosub_memberships", universalHandler.HandleTableRequest)
		rest.Any("/gomosub_memberships/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_session_time", universalHandler.HandleTableRequest)
		rest.Any("/user_session_time/*path", universalHandler.HandleTableRequest)

		rest.Any("/user_achievements", universalHandler.HandleTableRequest)
		rest.Any("/user_achievements/*path", universalHandler.HandleTableRequest)

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

		rest.Any("/gomosub_rules_acceptance", universalHandler.HandleTableRequest)
		rest.Any("/gomosub_rules_acceptance/*path", universalHandler.HandleTableRequest)

		// Protected endpoints
		protected := rest.Group("")
		protected.Use(middleware.SupabaseAuthCacheMiddleware(authService, redis))
		{
			// Messenger tables (protected with rate limiting)
			messenger := protected.Group("")
			messenger.Use(middleware.MessengerRateLimitMiddleware(messengerRateLimiter))
			{
				messenger.GET("/chat_user_keys", universalHandler.HandleTableRequest)
				messenger.POST("/chat_user_keys", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_user_keys", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_user_keys", universalHandler.HandleTableRequest)
				messenger.GET("/chat_user_keys/*path", universalHandler.HandleTableRequest)
				messenger.POST("/chat_user_keys/*path", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_user_keys/*path", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_user_keys/*path", universalHandler.HandleTableRequest)

				messenger.GET("/chat_conversations", universalHandler.HandleTableRequest)
				messenger.POST("/chat_conversations", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_conversations", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_conversations", universalHandler.HandleTableRequest)
				messenger.GET("/chat_conversations/*path", universalHandler.HandleTableRequest)
				messenger.POST("/chat_conversations/*path", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_conversations/*path", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_conversations/*path", universalHandler.HandleTableRequest)

				messenger.GET("/chat_conversation_members", universalHandler.HandleTableRequest)
				messenger.POST("/chat_conversation_members", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_conversation_members", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_conversation_members", universalHandler.HandleTableRequest)
				messenger.GET("/chat_conversation_members/*path", universalHandler.HandleTableRequest)
				messenger.POST("/chat_conversation_members/*path", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_conversation_members/*path", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_conversation_members/*path", universalHandler.HandleTableRequest)

				messenger.GET("/chat_messages", universalHandler.HandleTableRequest)
				messenger.POST("/chat_messages", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_messages", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_messages", universalHandler.HandleTableRequest)
				messenger.GET("/chat_messages/*path", universalHandler.HandleTableRequest)
				messenger.POST("/chat_messages/*path", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_messages/*path", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_messages/*path", universalHandler.HandleTableRequest)

				messenger.GET("/chat_receipts", universalHandler.HandleTableRequest)
				messenger.POST("/chat_receipts", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_receipts", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_receipts", universalHandler.HandleTableRequest)
				messenger.GET("/chat_receipts/*path", universalHandler.HandleTableRequest)
				messenger.POST("/chat_receipts/*path", universalHandler.HandleTableRequest)
				messenger.PUT("/chat_receipts/*path", universalHandler.HandleTableRequest)
				messenger.DELETE("/chat_receipts/*path", universalHandler.HandleTableRequest)
			}

			protected.POST("/profiles", func(c *gin.Context) {
				c.JSON(501, gin.H{"error": "Profile creation not implemented"})
			})
			protected.PUT("/profiles/:id", profilesHandler.UpdateProfile)
			protected.POST("/boards", boardsHandler.CreateBoard)
			protected.PUT("/boards/:id", boardsHandler.UpdateBoard)
			protected.POST("/threads", threadsHandler.CreateThread)
			protected.PUT("/threads/:id", threadsHandler.UpdateThread)
			protected.POST("/posts", postsHandler.CreatePost)
			protected.PUT("/posts/:id", postsHandler.UpdatePost)
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
		}
	}

	// RPC functions (Supabase compatibility)
	rpc := router.Group("/rpc/v1")
	{
		// Public RPC functions
		rpc.GET("/get_post_likes_count", rpcHandler.GetPostLikesCount)
		rpc.GET("/get_thread_likes_count", rpcHandler.GetThreadLikesCount)
		rpc.GET("/get_recent_post_likers", rpcHandler.GetRecentPostLikers)
		rpc.GET("/get_recent_thread_likers", rpcHandler.GetRecentThreadLikers)

		// Protected RPC functions
		protected := rpc.Group("")
		protected.Use(middleware.SupabaseAuthMiddleware(authService))
		protected.Use(middleware.MessengerRateLimitMiddleware(messengerRateLimiter))
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

			// Messenger RPC functions
			protected.POST("/get_or_create_direct_chat", rpcHandler.GetOrCreateDirectChat)
			protected.POST("/chat_mark_delivered", rpcHandler.ChatMarkDelivered)
			protected.POST("/chat_mark_read", rpcHandler.ChatMarkRead)
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
		storageProtected.Use(middleware.SupabaseAuthMiddleware(authService))
		{
			storageProtected.POST("/presign-upload", func(c *gin.Context) {
				if storageHandler == nil {
					c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": "Storage not available"})
					return
				}
				storageHandler.PresignUpload(c)
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
					frontendURL = "http://localhost:8081"
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
		// GET /oauth/userinfo - requires OAuth Bearer token
		oauthGroup.GET("/userinfo", handlers.OAuthBearerMiddleware(oauthService), oauthHandler.UserInfo)
		// GET /oauth/app-info - public app info for consent page
		oauthGroup.GET("/app-info", oauthHandler.AppInfo)
	}

	// OpenID Connect discovery
	router.GET("/.well-known/openid-configuration", oauthHandler.OpenIDConfiguration)
	router.GET("/.well-known/jwks.json", oauthHandler.JWKS)

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

	// WebSocket endpoint
	if wsHandler != nil {
		ws := router.Group("/ws")
		ws.Use(middleware.SupabaseAuthCacheMiddleware(authService, redis))
		{
			ws.GET("", wsHandler.HandleWebSocket)
		}

		// Debug endpoint for online users count (protected, admin only in production)
		router.GET("/ws/stats", middleware.SupabaseAuthCacheMiddleware(authService, redis), wsHandler.GetOnlineUsers)
	}
}
