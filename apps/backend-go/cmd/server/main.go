package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/routes"
	"github.com/gomo6/backend/internal/bots"
	"github.com/gomo6/backend/internal/database"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	// Initialize database
	db, err := database.InitDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Initialize Redis
	redisClient := database.InitRedis()

	// Initialize WebSocket Hub with Redis Pub/Sub
	wsHub := websocket.NewHub(redisClient)
	go wsHub.Run()

	// Initialize Bot Manager
	botManager := bots.NewBotManager(db, redisClient, wsHub)
	if err := botManager.Start(); err != nil {
		log.Printf("Warning: Failed to start bot manager: %v", err)
	} else {
		log.Println("Bot manager started successfully")
	}
	defer botManager.Stop()

	// Initialize Gin router
	router := gin.Default()

	// Add middleware
	router.Use(middleware.CORS())
	router.Use(middleware.Logger())
	router.Use(middleware.ErrorHandler())

	// Setup routes with WebSocket Hub and BotManager
	routes.SetupRoutes(router, db, redisClient, wsHub, botManager)

	// Get port from environment
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	// Start server
	log.Printf("Server starting on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
