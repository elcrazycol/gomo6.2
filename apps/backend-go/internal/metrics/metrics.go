package metrics

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
	"sync/atomic"
	"time"
)

// startedAt marks process start so /metrics can expose uptime.
var startedAt = time.Now()

// MessengerMetrics contains the small set of production signals needed for
// realtime and transaction troubleshooting. Counters are process-local; scrape
// each backend instance separately or aggregate them in the monitoring system.
type MessengerMetrics struct {
	activeWS       atomic.Int64
	broadcastCount atomic.Uint64
	broadcastNanos atomic.Uint64
	dbTxErrors     atomic.Uint64
}

var Messenger = &MessengerMetrics{}

func (m *MessengerMetrics) WSConnected() { m.activeWS.Add(1) }
func (m *MessengerMetrics) WSDisconnected() {
	for {
		current := m.activeWS.Load()
		if current == 0 || m.activeWS.CompareAndSwap(current, current-1) {
			return
		}
	}
}
func (m *MessengerMetrics) RecordBroadcast(duration time.Duration) {
	m.broadcastCount.Add(1)
	m.broadcastNanos.Add(uint64(duration.Nanoseconds()))
}
func (m *MessengerMetrics) RecordDBTxError() { m.dbTxErrors.Add(1) }

// Handler exposes metrics only when METRICS_TOKEN is configured and supplied
// as X-Metrics-Token or Authorization: Bearer. It intentionally returns 404
// when disabled, avoiding an unauthenticated information endpoint by default.
func Handler(m *MessengerMetrics) http.Handler {
	token := os.Getenv("METRICS_TOKEN")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token == "" {
			http.NotFound(w, r)
			return
		}
		provided := r.Header.Get("X-Metrics-Token")
		if provided == "" {
			provided = r.Header.Get("Authorization")
			if len(provided) > len("Bearer ") && provided[:len("Bearer ")] == "Bearer " {
				provided = provided[len("Bearer "):]
			}
		}
		if provided != token {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		active := m.activeWS.Load()
		count := m.broadcastCount.Load()
		totalNanos := m.broadcastNanos.Load()
		avgSeconds := 0.0
		if count > 0 {
			avgSeconds = float64(totalNanos) / float64(count) / float64(time.Second)
		}
		_, _ = fmt.Fprintf(w,
			"# TYPE messenger_ws_active_connections gauge\n"+
				"messenger_ws_active_connections %d\n"+
				"# TYPE messenger_ws_broadcast_duration_seconds gauge\n"+
				"messenger_ws_broadcast_duration_seconds %.9f\n"+
				"# TYPE messenger_ws_broadcasts_total counter\n"+
				"messenger_ws_broadcasts_total %d\n"+
				"# TYPE messenger_db_tx_errors_total counter\n"+
				"messenger_db_tx_errors_total %d\n",
			active, avgSeconds, count, m.dbTxErrors.Load())

		// Runtime/process health — hand-rolled gauges (no client_golang dep in
		// this vendored build): goroutines, heap, uptime. Together with the
		// messenger counters above this is what the Grafana dashboard plots.
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)
		_, _ = fmt.Fprintf(w,
			"# TYPE backend_goroutines gauge\n"+
				"backend_goroutines %d\n"+
				"# TYPE backend_heap_inuse_bytes gauge\n"+
				"backend_heap_inuse_bytes %d\n"+
				"# TYPE backend_uptime_seconds gauge\n"+
				"backend_uptime_seconds %.0f\n",
			runtime.NumGoroutine(), mem.HeapInuse, time.Since(startedAt).Seconds())
	})
}
