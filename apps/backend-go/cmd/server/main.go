package main

import (
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"

	"github.com/gin-gonic/gin"
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

	// Load configuration
	cfg := config.LoadConfig()

	// ── Start HTTP server IMMEDIATELY with /health endpoint ───────────────
	// Docker healthcheck uses /health. We use a plain http.ServeMux for the
	// health endpoint so there's no Gin router involved — zero risk of
	// concurrent map read/write panics when Gin routes are added later.
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	srv := &http.Server{Addr: ":" + port, Handler: mux}

	if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		go func() {
			log.Printf("TLS enabled — HTTPS server + /health on port %s", port)
			if err := srv.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile); err != nil && err != http.ErrServerClosed {
				log.Fatal("TLS server failed:", err)
			}
		}()
		if cfg.TLSRedirectHTTP && port == "443" {
			go func() {
				redirectSrv := &http.Server{
					Addr: ":80",
					Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						target := "https://" + r.Host + r.URL.RequestURI()
						http.Redirect(w, r, target, http.StatusMovedPermanently)
					}),
				}
				log.Printf("HTTP→HTTPS redirect on :80")
				if err := redirectSrv.ListenAndServe(); err != nil {
					log.Printf("HTTP redirect stopped: %v", err)
				}
			}()
		}
	} else {
		go func() {
			log.Printf("HTTP server + /health on port %s", port)
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Fatal("HTTP server failed:", err)
			}
		}()
	}

	// ── Heavy initialization (after /health is already available) ─────────

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
	wsHub.SetDB(db)
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

	// ── Setup Gin router (only AFTER all init — safe to write to router) ─
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(middleware.CORS(cfg.AllowedOrigins))
	router.Use(middleware.Logger())
	router.Use(middleware.ErrorHandler())

	// Setup routes with WebSocket Hub and BotManager
	routes.SetupRoutes(router, db, redisClient, wsHub, botManager)

	// pprof for memory profiling
	router.GET("/debug/pprof/*pprof", gin.WrapH(http.DefaultServeMux))

	// Register Gin as catch-all — /health in mux takes priority (exact match)
	mux.Handle("/", router)

	log.Println("All routes registered — server fully operational")

	// Block main goroutine forever (server runs in background goroutine)
	select {}
}
