package main

import (
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/routes"
	"github.com/gomo6/backend/internal/config"
	"github.com/gomo6/backend/internal/database"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/joho/godotenv"
)

// primaryHandler is swapped atomically: nil → Gin after init completes.
// Until swapped, only /health returns 200; all other paths return 404.
var primaryHandler atomic.Value // stores http.Handler (nil before init)

// @title           gomo6 API
// @version         1.0
// @description     gomo6 — open social platform API. Create bots, integrations, and apps.
// @termsOfService  https://gomo6.wtf/terms
// @contact.name    gomo6 Team
// @contact.url     https://gomo6.wtf
// @license.name    MIT
// @BasePath        /api/v1
// @schemes         https http
//
// @securityDefinitions.apikey BearerAuth
// @in                         header
// @name                       Authorization
// @description                Bearer token for API authentication

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	// Load configuration
	cfg := config.LoadConfig()

	// ── Start HTTP server IMMEDIATELY with /health ──────────────────────
	// The catch-all handler serves /health always, and delegates everything
	// else to the Gin router once it's ready (swapped via atomic.Value).
	// This is race-free: no concurrent writes to any router/mux after start.
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	rootHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// /health is always available, even before Gin is ready
		if r.URL.Path == "/health" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
			return
		}

		// Delegate to Gin if ready; otherwise 404
		if h, ok := primaryHandler.Load().(http.Handler); ok && h != nil {
			h.ServeHTTP(w, r)
			return
		}

		http.NotFound(w, r)
	})

	srv := &http.Server{Addr: ":" + port, Handler: rootHandler}

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

	// ── Heavy initialization ────────────────────────────────────────────

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

	// ── Setup Gin router ────────────────────────────────────────────────
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(middleware.CORS(cfg.AllowedOrigins))
	router.Use(middleware.Logger())
	router.Use(middleware.ErrorHandler())

	routes.SetupRoutes(router, db, redisClient, wsHub)

	// pprof for memory profiling
	router.GET("/debug/pprof/*pprof", gin.WrapH(http.DefaultServeMux))

	// Atomically swap in Gin — all non-/health requests now go to Gin
	primaryHandler.Store(router)

	log.Println("All routes registered — server fully operational")

	// Block main goroutine forever (server runs in background goroutine)
	select {}
}
