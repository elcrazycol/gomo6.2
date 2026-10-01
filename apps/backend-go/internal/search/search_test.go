package search

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// fakeMeili is a minimal Meilisearch stand-in: it accepts task-creating writes,
// records them, and answers /tasks/{uid} with success. Enough to exercise the
// client without a real engine.
type fakeMeili struct {
	mu      sync.Mutex
	nextUID int64
	calls   []recordedCall
}

type recordedCall struct {
	method string
	path   string
	body   string
}

func newFakeMeili(t *testing.T) (*fakeMeili, *httptest.Server) {
	t.Helper()
	f := &fakeMeili{}
	srv := httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(srv.Close)
	return f, srv
}

func (f *fakeMeili) handle(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)

	f.mu.Lock()
	f.calls = append(f.calls, recordedCall{method: r.Method, path: r.URL.Path, body: string(body)})
	f.mu.Unlock()

	switch {
	case r.URL.Path == "/health":
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"status":"available"}`)
	case r.URL.Path == "/indexes" && r.Method == http.MethodPost:
		// Pretend the index already exists so EnsureIndexes must tolerate it.
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"taskUid":1,"status":"enqueued"}`)
	case strings.HasPrefix(r.URL.Path, "/tasks/"):
		w.Header().Set("Content-Type", "application/json")
		uid := strings.TrimPrefix(r.URL.Path, "/tasks/")
		switch uid {
		case "1":
			// The create-index task failed because the index already exists.
			_, _ = io.WriteString(w, `{"uid":1,"status":"failed","error":{"message":"Index `+"`x`"+` already exists","code":"index_already_exists"}}`)
		default:
			_, _ = io.WriteString(w, `{"uid":`+uid+`,"status":"succeeded"}`)
		}
	default:
		f.mu.Lock()
		f.nextUID++
		uid := f.nextUID + 1
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"taskUid":`+strconv.FormatInt(uid, 10)+`,"status":"enqueued"}`)
	}
}

func (f *fakeMeili) snapshot() []recordedCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]recordedCall, len(f.calls))
	copy(out, f.calls)
	return out
}

func TestNewDisabledWhenNoURL(t *testing.T) {
	svc := New(Config{})
	if svc.Enabled() {
		t.Fatal("service should be disabled without a URL")
	}
	if err := svc.Health(context.Background()); err != ErrDisabled {
		t.Fatalf("Health error = %v, want ErrDisabled", err)
	}
	if err := svc.UpsertDocuments(context.Background(), IndexUsers, []UserDoc{}); err != ErrDisabled {
		t.Fatalf("Upsert error = %v, want ErrDisabled", err)
	}
}

func TestIndexUIDPrefix(t *testing.T) {
	svc := New(Config{IndexPrefix: "gomo6_"})
	if got := svc.IndexUID(IndexThreads); got != "gomo6_threads" {
		t.Fatalf("IndexUID = %q, want gomo6_threads", got)
	}
	if got := New(Config{}).IndexUID(IndexPosts); got != "posts" {
		t.Fatalf("unprefixed IndexUID = %q, want posts", got)
	}
}

func TestUnknownIndexKeyRejected(t *testing.T) {
	svc := New(Config{URL: "http://example.invalid"})
	if err := svc.UpsertDocuments(context.Background(), "nope", nil); err == nil || !strings.Contains(err.Error(), "unknown index") {
		t.Fatalf("error = %v, want unknown index error", err)
	}
}

func TestEnsureIndexesToleratesExistingIndex(t *testing.T) {
	f, srv := newFakeMeili(t)
	svc := New(Config{URL: srv.URL, MasterKey: "secret", IndexPrefix: "gomo6_"})

	if err := svc.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}

	var sawSettings bool
	for _, c := range f.snapshot() {
		if c.method == http.MethodPatch && strings.HasSuffix(c.path, "/settings") {
			sawSettings = true
			if !strings.Contains(c.body, "filterableAttributes") {
				t.Errorf("settings body missing filterableAttributes: %s", c.body)
			}
		}
	}
	if !sawSettings {
		t.Fatal("expected a settings update per index")
	}
}

func TestUpsertAndDeleteDocument(t *testing.T) {
	f, srv := newFakeMeili(t)
	svc := New(Config{URL: srv.URL, IndexPrefix: "gomo6_"})

	if err := svc.UpsertDocuments(context.Background(), IndexUsers, []UserDoc{{ID: "u1", Username: "neo"}}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := svc.DeleteDocument(context.Background(), IndexUsers, "u1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	var upserts, deletes int
	for _, c := range f.snapshot() {
		switch {
		case c.method == http.MethodPost && c.path == "/indexes/gomo6_users/documents":
			upserts++
			if !strings.Contains(c.body, `"username":"neo"`) {
				t.Errorf("upsert body = %s", c.body)
			}
		case c.method == http.MethodDelete && c.path == "/indexes/gomo6_users/documents/u1":
			deletes++
		}
	}
	if upserts != 1 || deletes != 1 {
		t.Fatalf("upserts=%d deletes=%d, want 1/1", upserts, deletes)
	}
}

func TestHealthRequiresReachableEngine(t *testing.T) {
	_, srv := newFakeMeili(t)
	svc := New(Config{URL: srv.URL})
	if err := svc.Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
}
