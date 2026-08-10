package middleware

import (
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RequestMetrics tracks per-route request counts, latency and error rates with
// zero external dependencies. Buckets are keyed by the gin route pattern (e.g.
// "/api/v1/profiles/:id"), so N+1-style request storms and 429 floods show up
// immediately in the metrics endpoint instead of hiding in logs.
type RequestMetrics struct {
	mu        sync.Mutex
	startedAt time.Time
	buckets   map[string]*metricsBucket
}

type metricsBucket struct {
	requests     uint64
	latencyMs    uint64
	clientErrors uint64 // 4xx (excluding 429, tracked separately)
	serverErrors uint64 // 5xx
	rateLimited  uint64 // 429
}

// maxMetricBuckets caps memory for garbage / unmatched paths (404 storms).
// Anything beyond the cap is folded into a single "other" bucket.
const maxMetricBuckets = 500

var globalMetrics = &RequestMetrics{
	startedAt: time.Now(),
	buckets:   make(map[string]*metricsBucket),
}

// MetricsMiddleware records a snapshot for every request that passes through.
func MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		elapsed := time.Since(start)

		route := c.FullPath()
		if route == "" {
			route = c.Request.URL.Path
		}
		key := c.Request.Method + " " + route

		globalMetrics.mu.Lock()
		b := globalMetrics.buckets[key]
		if b == nil {
			if len(globalMetrics.buckets) >= maxMetricBuckets {
				key = "other"
				b = globalMetrics.buckets[key]
				if b == nil {
					b = &metricsBucket{}
					globalMetrics.buckets[key] = b
				}
			} else {
				b = &metricsBucket{}
				globalMetrics.buckets[key] = b
			}
		}
		b.requests++
		b.latencyMs += uint64(elapsed.Milliseconds())
		switch {
		case c.Writer.Status() == http.StatusTooManyRequests:
			b.rateLimited++
		case c.Writer.Status() >= 500:
			b.serverErrors++
		case c.Writer.Status() >= 400:
			b.clientErrors++
		}
		globalMetrics.mu.Unlock()
	}
}

// MetricsRow is one aggregated route in the metrics snapshot.
type MetricsRow struct {
	Route        string  `json:"route"`
	Requests     uint64  `json:"requests"`
	AvgLatencyMs uint64  `json:"avg_latency_ms"`
	ClientErrors uint64  `json:"client_errors"`
	ServerErrors uint64  `json:"server_errors"`
	RateLimited  uint64  `json:"rate_limited"`
	ErrorRatePct float64 `json:"error_rate_pct"`
}

// MetricsSnapshot returns a stable, sorted-by-volume snapshot of all counters.
func MetricsSnapshot() []MetricsRow {
	globalMetrics.mu.Lock()
	defer globalMetrics.mu.Unlock()

	rows := make([]MetricsRow, 0, len(globalMetrics.buckets))
	for key, b := range globalMetrics.buckets {
		var avg uint64
		if b.requests > 0 {
			avg = b.latencyMs / b.requests
		}
		errRate := 0.0
		if b.requests > 0 {
			errRate = float64(b.clientErrors+b.serverErrors+b.rateLimited) / float64(b.requests) * 100
		}
		rows = append(rows, MetricsRow{
			Route:        key,
			Requests:     b.requests,
			AvgLatencyMs: avg,
			ClientErrors: b.clientErrors,
			ServerErrors: b.serverErrors,
			RateLimited:  b.rateLimited,
			ErrorRatePct: errRate,
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Requests > rows[j].Requests })
	return rows
}
