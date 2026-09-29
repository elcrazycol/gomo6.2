package middleware

import (
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
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

// escapeLabelValue escapes a Prometheus label value per the exposition format.
func escapeLabelValue(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(s)
}

// WritePrometheus renders the per-route request counters (counts, latency sum,
// 4xx/5xx/429) in Prometheus text format. Registered with the metrics package at
// startup so /metrics exposes them alongside the messenger/runtime series —
// previously they were only reachable through an admin-only JSON endpoint.
func WritePrometheus(w io.Writer) {
	globalMetrics.mu.Lock()
	rows := make([]MetricsRow, 0, len(globalMetrics.buckets))
	for key, b := range globalMetrics.buckets {
		var avg uint64
		if b.requests > 0 {
			avg = b.latencyMs / b.requests
		}
		rows = append(rows, MetricsRow{
			Route:        key,
			Requests:     b.requests,
			AvgLatencyMs: avg,
			ClientErrors: b.clientErrors,
			ServerErrors: b.serverErrors,
			RateLimited:  b.rateLimited,
		})
	}
	globalMetrics.mu.Unlock()

	sort.Slice(rows, func(i, j int) bool { return rows[i].Requests > rows[j].Requests })

	_, _ = fmt.Fprint(w,
		"# TYPE http_requests_total counter\n"+
			"# TYPE http_request_duration_ms_sum counter\n"+
			"# TYPE http_client_errors_total counter\n"+
			"# TYPE http_server_errors_total counter\n"+
			"# TYPE http_rate_limited_total counter\n")
	for _, r := range rows {
		// AvgLatencyMs is derived from the summed latency, so multiply back to
		// expose a monotonic counter instead of a gauge that jumps around.
		route := escapeLabelValue(r.Route)
		_, _ = fmt.Fprintf(w,
			"http_requests_total{route=\"%s\"} %d\n"+
				"http_request_duration_ms_sum{route=\"%s\"} %d\n"+
				"http_client_errors_total{route=\"%s\"} %d\n"+
				"http_server_errors_total{route=\"%s\"} %d\n"+
				"http_rate_limited_total{route=\"%s\"} %d\n",
			route, r.Requests,
			route, r.AvgLatencyMs*r.Requests,
			route, r.ClientErrors,
			route, r.ServerErrors,
			route, r.RateLimited)
	}
}
