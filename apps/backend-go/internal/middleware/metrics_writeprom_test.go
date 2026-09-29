package middleware

import (
	"bytes"
	"testing"
)

// Regression: WritePrometheus used to build its rows without copying the
// histogram state, so every bucket rendered as 0 while _count grew — which made
// p50/p95/p99 permanently empty and broke the RED dashboard.
func TestWritePrometheus_HistogramIsPopulated(t *testing.T) {
	const key = "GET /test-writeprom"

	globalMetrics.mu.Lock()
	b := &metricsBucket{requests: 3, latencyMs: 308}
	b.observe(0.004)
	b.observe(0.004)
	b.observe(0.300)
	globalMetrics.buckets[key] = b
	globalMetrics.mu.Unlock()
	t.Cleanup(func() {
		globalMetrics.mu.Lock()
		delete(globalMetrics.buckets, key)
		globalMetrics.mu.Unlock()
	})

	var buf bytes.Buffer
	WritePrometheus(&buf)
	out := buf.String()

	// +Inf must equal the request count, and the fast bucket must hold 2.
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /test-writeprom",le="+Inf"} 3`)
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /test-writeprom",le="0.005"} 2`)
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /test-writeprom",le="0.5"} 3`)
	mustContain(t, out, `http_request_duration_seconds_count{route="GET /test-writeprom"} 3`)
	mustContain(t, out, `http_request_duration_seconds_sum{route="GET /test-writeprom"} 0.308000`)
}

// The bucket totals must never exceed the observation count (an over-counting
// observe() would silently corrupt every percentile).
func TestWritePrometheus_BucketsAreMonotonic(t *testing.T) {
	const key = "GET /test-writeprom-monotonic"

	globalMetrics.mu.Lock()
	globalMetrics.buckets[key] = &metricsBucket{requests: 5}
	b := globalMetrics.buckets[key]
	for _, s := range []float64{0.001, 0.02, 0.02, 0.7, 12} {
		b.observe(s)
	}
	globalMetrics.mu.Unlock()
	t.Cleanup(func() {
		globalMetrics.mu.Lock()
		delete(globalMetrics.buckets, key)
		globalMetrics.mu.Unlock()
	})

	var buf bytes.Buffer
	WritePrometheus(&buf)
	out := buf.String()

	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /test-writeprom-monotonic",le="+Inf"} 5`)
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /test-writeprom-monotonic",le="0.025"} 3`)
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /test-writeprom-monotonic",le="1"} 4`)
}
