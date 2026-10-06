package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/api/routes"
	"github.com/gomo6/backend/internal/bg"
	"github.com/gomo6/backend/internal/config"
	"github.com/gomo6/backend/internal/database"
	"github.com/gomo6/backend/internal/integrations"
	"github.com/gomo6/backend/internal/metrics"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/joho/godotenv"
)

// Version and commit are injected at build time via
// -ldflags "-X main.version=... -X main.commit=..." (see apps/backend-go/Dockerfile).
// They default to dev values for local `go run` / `go build`.
var (
	version = "dev"
	commit  = "unknown"
)

// healthResponse returns the JSON body served on /health (available before
// the database is up — used by Docker healthchecks and deploy verification).
func healthResponse() string {
	return fmt.Sprintf(`{"status":"ok","version":%q,"commit":%q}`, version, commit)
}

// serverTimeouts returns the HTTP server timeouts. ReadHeaderTimeout is the real
// Slowloris guard; the body read/write windows are generous (and env-tunable)
// because the backend proxies large media uploads. WebSocket connections are
// unaffected: gorilla/websocket clears the deadlines right after hijacking.
func serverTimeouts() (readHeader, read, write, idle time.Duration) {
	return envDuration("SERVER_READ_HEADER_TIMEOUT", 10*time.Second),
		envDuration("SERVER_READ_TIMEOUT", 30*time.Minute),
		envDuration("SERVER_WRITE_TIMEOUT", 30*time.Minute),
		envDuration("SERVER_IDLE_TIMEOUT", 2*time.Minute)
}

// envDuration parses a positive Go duration from the environment (e.g. "30m").
func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return def
}

func newHTTPServer(addr string, handler http.Handler) *http.Server {
	readHeader, read, write, idle := serverTimeouts()
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: readHeader,
		ReadTimeout:       read,
		WriteTimeout:      write,
		IdleTimeout:       idle,
	}
}

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
			w.Write([]byte(healthResponse()))
			return
		}

		// Delegate to Gin if ready; otherwise 404
		if h, ok := primaryHandler.Load().(http.Handler); ok && h != nil {
			h.ServeHTTP(w, r)
			return
		}

		http.NotFound(w, r)
	})

	srv := newHTTPServer(":"+port, rootHandler)

	if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		go func() {
			log.Printf("TLS enabled — HTTPS server + /health on port %s", port)
			if err := srv.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile); err != nil && err != http.ErrServerClosed {
				log.Fatal("TLS server failed:", err)
			}
		}()
		if cfg.TLSRedirectHTTP && port == "443" {
			go func() {
				redirectSrv := newHTTPServer(":80", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					target := "https://" + r.Host + r.URL.RequestURI()
					http.Redirect(w, r, target, http.StatusMovedPermanently)
				}))
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

	// Start Spotify now-playing poller (publishes via WebSocket every 15s)
	spt := integrations.NewSpotifyService(db)
	go websocket.NewSpotifyPoller(wsHub, spt).Start()

	// ── Setup Gin router ────────────────────────────────────────────────
	router := gin.New()
	// Only trust headers from local/Docker reverse proxies. This keeps
	// ClientIP-based rate limits (including the pre-auth WebSocket limiter)
	// from being bypassed with a spoofed X-Forwarded-For, while still
	// resolving the real client IP for compose networks (172.16/12, 10/8,
	// 192.168/16) and host-local dev proxies. The backend is not exposed
	// directly, so these private ranges cannot be reached by external peers.
	if err := router.SetTrustedProxies([]string{
		"127.0.0.1", "::1",
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
	}); err != nil {
		log.Fatal("Failed to configure trusted proxies:", err)
	}
	router.Use(gin.Recovery())
	router.Use(middleware.RejectQueryTokenMiddleware())
	router.Use(middleware.CORS(cfg.AllowedOrigins))
	router.Use(middleware.Logger())
	router.Use(middleware.ErrorHandler())

	routes.SetupRoutes(router, db, redisClient, wsHub)

	// Expose the per-route request counters, DB pool saturation and background
	// pool pressure on /metrics, next to the messenger/runtime series.
	metrics.RegisterProvider(middleware.WritePrometheus)
	metrics.RegisterProvider(bg.WritePrometheus)
	metrics.RegisterProvider(func(w io.Writer) {
		s := db.Stats()
		_, _ = fmt.Fprintf(w,
			"# TYPE db_open_connections gauge\n"+
				"db_open_connections %d\n"+
				"# TYPE db_in_use_connections gauge\n"+
				"db_in_use_connections %d\n"+
				"# TYPE db_idle_connections gauge\n"+
				"db_idle_connections %d\n"+
				"# TYPE db_max_open_connections gauge\n"+
				"db_max_open_connections %d\n"+
				"# TYPE db_wait_count_total counter\n"+
				"db_wait_count_total %d\n"+
				"# TYPE db_wait_duration_seconds_total counter\n"+
				"db_wait_duration_seconds_total %.6f\n",
			s.OpenConnections, s.InUse, s.Idle, s.MaxOpenConnections,
			s.WaitCount, s.WaitDuration.Seconds())
	})

	// Product gauges: online right now (in-memory presence) and "active today"
	// from user_daily_visits. The latter is cached for 5 minutes and bounded by
	// a context timeout so a scrape can never hammer or hang on the database.
	var (
		dauMu      sync.Mutex
		dauValue   int64
		dauFetched time.Time
	)
	metrics.RegisterProvider(func(w io.Writer) {
		_, _ = fmt.Fprintf(w, "# TYPE app_users_online gauge\napp_users_online %d\n", wsHub.OnlineCount())
	})
	metrics.RegisterProvider(func(w io.Writer) {
		dauMu.Lock()
		if time.Since(dauFetched) > 5*time.Minute {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			var n int64
			if err := db.QueryRowContext(ctx,
				`SELECT count(*) FROM user_daily_visits WHERE visit_date = CURRENT_DATE`).Scan(&n); err == nil {
				dauValue = n
			}
			cancel()
			dauFetched = time.Now()
		}
		v := dauValue
		dauMu.Unlock()
		_, _ = fmt.Fprintf(w, "# TYPE app_users_active_today gauge\napp_users_active_today %d\n", v)
	})

	// Product totals come from the database with a 5-minute cache instead of the
	// process-local counters (which reset on every restart and would read 0).
	// Aggregate counts of accounts and public content only — no message content,
	// no per-user labels, and private messages are deliberately NOT counted.
	totalQueries := map[string]string{
		// Bots live in users with domain 'bot.gomo6'; they are not registrations.
		"app_users_total":      `SELECT count(*) FROM users WHERE COALESCE(domain, '') <> 'bot.gomo6'`,
		"app_threads_total":    `SELECT count(*) FROM threads`,
		"app_posts_total":      `SELECT count(*) FROM posts`,
		"app_wall_posts_total": `SELECT count(*) FROM profile_wall_posts`,
	}
	totalOrder := []string{"app_users_total", "app_threads_total", "app_posts_total", "app_wall_posts_total"}
	type cachedTotal struct {
		mu      sync.Mutex
		value   int64
		fetched time.Time
	}
	totals := make(map[string]*cachedTotal, len(totalQueries))
	for name := range totalQueries {
		totals[name] = &cachedTotal{}
	}
	metrics.RegisterProvider(func(w io.Writer) {
		for _, name := range totalOrder {
			t := totals[name]
			t.mu.Lock()
			if time.Since(t.fetched) > 5*time.Minute {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				var n int64
				if err := db.QueryRowContext(ctx, totalQueries[name]).Scan(&n); err == nil {
					t.value = n
				}
				cancel()
				t.fetched = time.Now()
			}
			v := t.value
			t.mu.Unlock()
			_, _ = fmt.Fprintf(w, "# TYPE %s gauge\n%s %d\n", name, name, v)
		}
	})

	// Metrics are disabled unless METRICS_TOKEN is configured. pprof is not
	// mounted on the public API; use an explicitly isolated admin process when
	// profiling is required.
	router.GET("/metrics", gin.WrapH(metrics.Handler(metrics.Messenger)))

	// Atomically swap in Gin — all non-/health requests now go to Gin
	primaryHandler.Store(router)

	log.Println("All routes registered — server fully operational")

	// Block main goroutine forever (server runs in background goroutine)
	select {}
}
