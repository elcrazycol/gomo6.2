package middleware

import (
	"bytes"
	"strings"
	"testing"
)

func TestMetricsBucketObserve_SlotPlacement(t *testing.T) {
	cases := []struct {
		seconds float64
		want    int
	}{
		{0.001, 0}, // <= 0.005
		{0.005, 0}, // exactly on the first bound
		{0.006, 1}, // <= 0.01
		{0.05, 3},  // exactly on the 4th bound
		{0.051, 4}, // <= 0.1
		{0.9, 7},   // <= 1
		{11, 11},   // above the largest bound → overflow slot
		{-1, 0},    // negative clamps to the first bucket
	}
	for _, c := range cases {
		var b metricsBucket
		b.observe(c.seconds)
		if b.durationCounts[c.want] != 1 {
			t.Errorf("observe(%v): slot %d not incremented (counts=%v)", c.seconds, c.want, b.durationCounts)
		}
		var total uint64
		for _, n := range b.durationCounts {
			total += n
		}
		if total != 1 {
			t.Errorf("observe(%v): observed %d times, want 1", c.seconds, total)
		}
	}
}

func TestWriteDurationHistogram_Cumulative(t *testing.T) {
	var b metricsBucket
	for _, s := range []float64{0.002, 0.004, 0.03, 0.4, 12} {
		b.observe(s)
	}
	row := MetricsRow{
		Route:          "GET /api/v1/feed",
		Requests:       b.requests + 5,
		DurationCounts: b.durationCounts,
		DurationSumSec: 12.436,
	}

	var buf bytes.Buffer
	writeDurationHistogram(&buf, row.Route, row)
	out := buf.String()

	// Buckets are cumulative: le="0.005" must include both sub-5ms requests.
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /api/v1/feed",le="0.005"} 2`)
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /api/v1/feed",le="0.05"} 3`)
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /api/v1/feed",le="0.5"} 4`)
	// +Inf must equal the total observation count.
	mustContain(t, out, `http_request_duration_seconds_bucket{route="GET /api/v1/feed",le="+Inf"} 5`)
	mustContain(t, out, `http_request_duration_seconds_count{route="GET /api/v1/feed"} 5`)
	mustContain(t, out, `http_request_duration_seconds_sum{route="GET /api/v1/feed"} 12.436000`)
}

func mustContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("output missing %q\n--- got ---\n%s", needle, haystack)
	}
}
