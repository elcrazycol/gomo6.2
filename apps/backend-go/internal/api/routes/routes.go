package routes

import (
	"context"
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
	stor "github.com/gomo6/backend/internal/storage"
	storageHandlers "github.com/gomo6/backend/internal/storage/handlers"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

func SetupRoutes(router *gin.Engine, db *sql.DB, redis *redis.Client, wsHub *websocket.Hub, botManager interface{}) {
	// Enhanced health check with database and Redis connectivity
	router.GET("/health", func(c *gin.Context) {
		response := gin.H{
			"status":      "ok",
			"websocket":   wsHub != nil,
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
			"version":     "1.0.1",
			"environment": os.Getenv("ENVIRONMENT"),
		}

		// Check database connectivity
		dbStatus := "connected"
		if err := db.Ping(); err != nil {
			dbStatus = "disconnected: " + err.Error()
			response["status"] = "degraded"
		}
		response["database"] = dbStatus

		// Check Redis connectivity
		redisStatus := "connected"
		if redis != nil {
			if err := redis.Ping(context.Background()).Err(); err != nil {
				redisStatus = "disconnected: " + err.Error()
				response["status"] = "degraded"
			}
		} else {
			redisStatus = "not configured"
			response["status"] = "degraded"
		}
		response["redis"] = redisStatus

		// Determine HTTP status based on health
		statusCode := http.StatusOK
		if response["status"] == "degraded" {
			statusCode = http.StatusServiceUnavailable
		}

		c.JSON(statusCode, response)
	})

	// Live endpoint for Kubernetes/load balancer checks (no dependencies)
	router.GET("/health/live", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "alive"})
	})

	// Ready endpoint (checks all dependencies)
	router.GET("/health/ready", func(c *gin.Context) {
		response := gin.H{"status": "ready"}
		statusCode := http.StatusOK

		// Check database
		if err := db.Ping(); err != nil {
			response["status"] = "not ready"
			response["database"] = err.Error()
			statusCode = http.StatusServiceUnavailable
		} else {
			response["database"] = "ok"
		}

		// Check Redis
		if redis == nil {
			response["status"] = "not ready"
			response["redis"] = "not configured"
			statusCode = http.StatusServiceUnavailable
		} else if err := redis.Ping(context.Background()).Err(); err != nil {
			response["status"] = "not ready"
			response["redis"] = err.Error()
			statusCode = http.StatusServiceUnavailable
		} else {
			response["redis"] = "ok"
		}

		c.JSON(statusCode, response)
	})

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(db)
	// Initialize auth service
	authService := auth.NewAuthService()

	// Initialize rate limiters
	messengerRateLimiter := middleware.NewMessengerRateLimiter()
	authRateLimiter := middleware.NewAuthRateLimiter(100, time.Minute) // 100 requests per minute for auth/me

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
	rpcHandler := handlers.NewRPCHandler(db)
	universalHandler := handlers.NewUniversalHandler(db, wsHub)
	universalHandler.SetRedis(redis)
	universalHandler.SetBotEventPublisher(botEventPublisher)
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

	// API routes with rate limiting
	api := router.Group("/api/v1")
	api.Use(middleware.RateLimitMiddleware("api", redis))
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
		}
	}

	// Supabase compatibility routes with rate limiting
	rest := router.Group("/rest/v1")
	rest.Use(middleware.RateLimitMiddleware("api", redis))
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

	// RPC functions (Supabase compatibility) with rate limiting
	rpc := router.Group("/rpc/v1")
	rpc.Use(middleware.RateLimitMiddleware("rpc", redis))
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
