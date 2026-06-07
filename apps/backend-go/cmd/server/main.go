package main

import (
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/handlers"
	"github.com/gomo6/backend/internal/api/routes"
	"github.com/gomo6/backend/internal/bots"
	"github.com/gomo6/backend/internal/config"
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

	// Validate messenger encryption key at startup
	if err := handlers.ValidateMessengerEncryptionKey(); err != nil {
		log.Fatalf("MESSENGER_ENCRYPTION_KEY is invalid: %v", err)
	}

	// Load configuration
	cfg := config.LoadConfig()

	// Initialize database
	db, err := database.InitDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Initialize Redis
	redisClient := database.InitRedis()

	// Initialize WebSocket Hub with Redis Pub/Sub and allowed origins
	wsHub := websocket.NewHub(redisClient, cfg.AllowedOrigins)
	wsHub.SetDB(db) // Set database connection for online status updates
	go wsHub.Run()
	log.Printf("WebSocket Hub initialized with allowed origins: %v", cfg.AllowedOrigins)

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

	// pprof for memory profiling
	router.GET("/debug/pprof/*pprof", gin.WrapH(http.DefaultServeMux))

	// Get port from environment
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	// TLS configuration
	if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		// HTTPS mode
		log.Printf("TLS enabled — starting HTTPS server on port %s", port)

		if cfg.TLSRedirectHTTP && port == "443" {
			// Start a separate goroutine that redirects HTTP :80 → HTTPS :443
			go func() {
				redirectSrv := &http.Server{
					Addr: ":80",
					Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						target := "https://" + r.Host + r.URL.RequestURI()
						http.Redirect(w, r, target, http.StatusMovedPermanently)
					}),
				}
				log.Printf("HTTP→HTTPS redirect listening on :80")
				if err := redirectSrv.ListenAndServe(); err != nil {
					log.Printf("HTTP redirect server stopped: %v", err)
				}
			}()
		} else if cfg.TLSRedirectHTTP {
			log.Printf("Warning: TLS_REDIRECT_HTTP is set but SERVER_PORT is not 443 — redirect only works with standard HTTPS port 443")
		}

		// Start HTTPS server
		srv := &http.Server{
			Addr:    ":" + port,
			Handler: router,
		}
		if err := srv.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile); err != nil {
			log.Fatal("Failed to start TLS server:", err)
		}
	} else {
		// Plain HTTP mode (development)
		log.Printf("TLS not configured — starting HTTP server on port %s", port)
		log.Printf("  Set TLS_CERT_FILE and TLS_KEY_FILE env vars to enable HTTPS")
		if err := router.Run(":" + port); err != nil {
			log.Fatal("Failed to start server:", err)
		}
	}
}
