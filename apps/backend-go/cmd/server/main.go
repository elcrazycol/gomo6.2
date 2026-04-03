package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/routes"
	"github.com/gomo6/backend/internal/database"
	"github.com/gomo6/backend/internal/middleware"
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

	// Initialize Gin router
	router := gin.Default()

	// Add middleware
	router.Use(middleware.CORS())
	router.Use(middleware.Logger())
	router.Use(middleware.ErrorHandler())

	// Setup routes (without WebSocket for now)
	routes.SetupRoutes(router, db, redisClient, nil)

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
