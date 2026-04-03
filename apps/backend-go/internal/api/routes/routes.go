package routes

import (
	"database/sql"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/handlers"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/redis/go-redis/v9"
)

func SetupRoutes(router *gin.Engine, db *sql.DB, redis *redis.Client, wsHub interface{}) {
	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(db)
	authService := auth.NewAuthService()
	boardsHandler := handlers.NewBoardsHandler(db)
	threadsHandler := handlers.NewThreadsHandler(db)
	postsHandler := handlers.NewPostsHandler(db)
	profilesHandler := handlers.NewProfilesHandler(db)
	likesHandler := handlers.NewLikesHandler(db)
	notificationsHandler := handlers.NewNotificationsHandler(db)
	rpcHandler := handlers.NewRPCHandler(db)
	universalHandler := handlers.NewUniversalHandler(db)
	// WebSocket handler disabled for now
	// wsHandler := handlers.NewWebSocketHandler(wsHub)

	// API routes
	api := router.Group("/api/v1")
	{
		// Auth routes
		auth := api.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			auth.GET("/me", middleware.AuthMiddleware(authService), authHandler.GetMe)
			auth.POST("/password", middleware.AuthMiddleware(authService), authHandler.UpdatePassword)
		}
	}

	// Supabase compatibility routes
	rest := router.Group("/rest/v1")
	{
		// Public endpoints (no auth required)
		rest.GET("/profiles", profilesHandler.GetProfiles)
		rest.GET("/profiles/:id", profilesHandler.GetProfile)
		rest.GET("/boards", boardsHandler.GetBoards)
		rest.GET("/boards/:slug", boardsHandler.GetBoard)
		rest.GET("/threads", threadsHandler.GetThreads)
		rest.GET("/threads/:id", threadsHandler.GetThread)
		rest.GET("/posts", postsHandler.GetPosts)
		rest.GET("/posts/:id", postsHandler.GetPost)

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

		// Protected endpoints
		protected := rest.Group("")
		protected.Use(middleware.SupabaseAuthMiddleware(authService))
		{
			protected.POST("/profiles", func(c *gin.Context) {
				c.JSON(501, gin.H{"error": "Profile creation not implemented"})
			})
			protected.PUT("/profiles/:id", profilesHandler.UpdateProfile)
			protected.POST("/boards", boardsHandler.CreateBoard)
			protected.POST("/threads", threadsHandler.CreateThread)
			protected.POST("/posts", postsHandler.CreatePost)
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

	// WebSocket endpoint disabled for now
	// router.GET("/ws", wsHandler.HandleWebSocket)
}
