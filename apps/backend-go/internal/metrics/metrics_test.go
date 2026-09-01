package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─── Counter lifecycle ───────────────────────────────────────────────────────

func TestWSConnected_Disconnected(t *testing.T) {
	m := &MessengerMetrics{}
	m.WSConnected()
	m.WSConnected()
	if got := m.activeWS.Load(); got != 2 {
		t.Fatalf("expected 2 active WS, got %d", got)
	}
	m.WSDisconnected()
	if got := m.activeWS.Load(); got != 1 {
		t.Fatalf("expected 1 active WS after one disconnect, got %d", got)
	}
	m.WSDisconnected()
	if got := m.activeWS.Load(); got != 0 {
		t.Fatalf("expected 0 active WS, got %d", got)
	}
}

func TestWSDisconnected_NeverGoesNegative(t *testing.T) {
	m := &MessengerMetrics{}
	// Multiple disconnects with no connects must stay at 0 (CAS loop guard).
	m.WSDisconnected()
	m.WSDisconnected()
	if got := m.activeWS.Load(); got != 0 {
		t.Fatalf("active WS count must never go below 0, got %d", got)
	}
}

func TestRecordBroadcast_Averages(t *testing.T) {
	m := &MessengerMetrics{}
	m.RecordBroadcast(100 * time.Millisecond)
	m.RecordBroadcast(300 * time.Millisecond)

	if got := m.broadcastCount.Load(); got != 2 {
		t.Fatalf("expected 2 broadcasts, got %d", got)
	}
	if got := m.broadcastNanos.Load(); got != uint64(400*time.Millisecond) {
		t.Fatalf("expected 400ms total, got %d ns", got)
	}
}

func TestRecordDBTxError(t *testing.T) {
	m := &MessengerMetrics{}
	m.RecordDBTxError()
	m.RecordDBTxError()
	if got := m.dbTxErrors.Load(); got != 2 {
		t.Fatalf("expected 2 db tx errors, got %d", got)
	}
}

// ─── Handler ─────────────────────────────────────────────────────────────────

func TestHandler_DisabledWithoutToken(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "")
	m := &MessengerMetrics{}
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()

	Handler(m).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when METRICS_TOKEN is unset, got %d", rec.Code)
	}
}

func TestHandler_ForbiddenWithWrongToken(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "secret-token")
	m := &MessengerMetrics{}
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("X-Metrics-Token", "wrong")
	rec := httptest.NewRecorder()

	Handler(m).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a wrong token, got %d", rec.Code)
	}
}

func TestHandler_ServesWithXMetricsToken(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "secret-token")
	m := &MessengerMetrics{}
	m.WSConnected()
	m.WSConnected()
	m.RecordBroadcast(time.Second)
	m.RecordDBTxError()

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("X-Metrics-Token", "secret-token")
	rec := httptest.NewRecorder()

	Handler(m).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{
		"messenger_ws_active_connections 2",
		"messenger_ws_broadcasts_total 1",
		"messenger_ws_broadcast_duration_seconds 1.000000000",
		"messenger_db_tx_errors_total 1",
		"# TYPE messenger_ws_active_connections gauge",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output missing %q:\n%s", want, body)
		}
	}
}

func TestHandler_ServesRuntimeMetrics(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "secret-token")
	m := &MessengerMetrics{}
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("X-Metrics-Token", "secret-token")
	rec := httptest.NewRecorder()

	Handler(m).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{
		"# TYPE backend_goroutines gauge",
		"backend_goroutines ",
		"# TYPE backend_heap_inuse_bytes gauge",
		"backend_heap_inuse_bytes ",
		"# TYPE backend_uptime_seconds gauge",
		"backend_uptime_seconds ",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("runtime metrics output missing %q:\n%s", want, body)
		}
	}
}

func TestHandler_AcceptsBearerToken(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "secret-token")
	m := &MessengerMetrics{}
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()

	Handler(m).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with Bearer auth, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_AveragesWhenNoBroadcasts(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "secret-token")
	m := &MessengerMetrics{}
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("X-Metrics-Token", "secret-token")
	rec := httptest.NewRecorder()

	Handler(m).ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, "messenger_ws_broadcast_duration_seconds 0.000000000") {
		t.Errorf("expected 0 average with no broadcasts:\n%s", body)
	}
}

func TestGlobalMessengerPointer(t *testing.T) {
	// The package-level singleton must never be nil and must be usable.
	Messenger.WSConnected()
	Messenger.WSDisconnected()
	if got := Messenger.activeWS.Load(); got != 0 {
		t.Fatalf("expected global messenger metrics to reset to 0, got %d", got)
	}
}
