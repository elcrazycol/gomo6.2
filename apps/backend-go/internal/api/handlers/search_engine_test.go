package handlers

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/search"
)

// fakeMultiSearch is a minimal Meilisearch /multi-search stand-in that records
// the queries it receives and replies with canned hits.
type fakeMultiSearch struct {
	mu      sync.Mutex
	queries []map[string]interface{}
	reply   func(indexUID string) []map[string]interface{}
	status  int
}

func newFakeMultiSearch(t *testing.T, reply func(indexUID string) []map[string]interface{}) (*fakeMultiSearch, *httptest.Server) {
	t.Helper()
	f := &fakeMultiSearch{reply: reply}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Queries []map[string]interface{} `json:"queries"`
		}
		_ = json.Unmarshal(body, &req)

		f.mu.Lock()
		f.queries = append(f.queries, req.Queries...)
		status := f.status
		f.mu.Unlock()

		if status >= 400 {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"message":"engine down"}`)
			return
		}

		results := make([]map[string]interface{}, 0, len(req.Queries))
		for _, q := range req.Queries {
			uid, _ := q["indexUid"].(string)
			results = append(results, map[string]interface{}{
				"indexUid":           uid,
				"hits":               f.reply(uid),
				"estimatedTotalHits": 1,
				"processingTimeMs":   1,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"results": results})
	}))
	t.Cleanup(srv.Close)
	return f, srv
}

func (f *fakeMultiSearch) seen() []map[string]interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]map[string]interface{}, len(f.queries))
	copy(out, f.queries)
	return out
}

func engineHandler(t *testing.T, srv *httptest.Server) (*SearchHandler, sqlmock.Sqlmock) {
	t.Helper()
	handler, mock := setupSearchHandler(t)
	handler.SetSearchService(search.New(search.Config{URL: srv.URL, IndexPrefix: "gomo6_"}))
	return handler, mock
}

func replyFor(uid string) []map[string]interface{} {
	switch uid {
	case "gomo6_users":
		return []map[string]interface{}{{
			"id": "u1", "public_id": float64(7), "username": "neo",
			"display_name": "Neo", "avatar_url": nil,
		}}
	case "gomo6_boards":
		return []map[string]interface{}{{
			"id": "b1", "slug": "general", "name": "General",
			"description": "", "cover_image_url": nil, "is_gomosub": false,
		}}
	case "gomo6_threads":
		return []map[string]interface{}{{
			"id": "t1", "public_id": float64(11), "title": "Привет", "content": "мир",
			"created_at": float64(1700000000), "updated_at": float64(1700000000),
			"board_id": "b1", "board_slug": "general", "board_name": "General", "board_is_gomosub": false,
		}}
	case "gomo6_posts":
		return []map[string]interface{}{{
			"id": "p1", "content": "ответ", "created_at": float64(1700000000),
			"thread_id": "t1", "thread_public_id": float64(11), "thread_title": "Привет",
			"board_id": "b1", "board_slug": "general", "board_name": "General", "board_is_gomosub": false,
			"author_username": "neo", "author_avatar_url": nil,
		}}
	}
	return []map[string]interface{}{}
}

func TestSearch_EngineNormalisesHits(t *testing.T) {
	_, srv := newFakeMultiSearch(t, replyFor)
	handler, _ := engineHandler(t, srv)

	c, w := newGETContext("/api/v1/search", map[string]string{"q": "admin"})
	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()

	// posts: author_username must be renamed to username, and the unix timestamp
	// must be an RFC3339 string (the shape the frontend contract expects).
	if !strings.Contains(body, `"username":"neo"`) {
		t.Errorf("posts must expose author as username: %s", body)
	}
	if strings.Contains(body, "author_username") {
		t.Errorf("raw index field author_username leaked: %s", body)
	}
	wantTS, _ := json.Marshal(time.Unix(1700000000, 0).UTC().Format(time.RFC3339))
	if !strings.Contains(body, string(wantTS)) {
		t.Errorf("timestamps must be RFC3339: %s", body)
	}
}

func TestSearch_EngineTypeFilterQueriesOnlyRequestedIndexes(t *testing.T) {
	f, srv := newFakeMultiSearch(t, replyFor)
	handler, _ := engineHandler(t, srv)

	c, w := newGETContext("/api/v1/search", map[string]string{"q": "admin", "type": "threads,posts"})
	handler.Search(c)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	seen := f.seen()
	if len(seen) != 2 {
		t.Fatalf("expected 2 index queries, got %d: %v", len(seen), seen)
	}
	for _, q := range seen {
		uid, _ := q["indexUid"].(string)
		if uid != "gomo6_threads" && uid != "gomo6_posts" {
			t.Errorf("unexpected index queried: %s", uid)
		}
		// Content queries must carry the public-board privacy clause.
		filter, _ := q["filter"].(string)
		if !strings.Contains(filter, `board_visibility = "public"`) {
			t.Errorf("content query missing privacy clause: %q", filter)
		}
	}
}

func TestSearch_EngineAuthorAndSinceFilters(t *testing.T) {
	const authorID = "11111111-1111-1111-1111-111111111111"
	f, srv := newFakeMultiSearch(t, replyFor)
	handler, _ := engineHandler(t, srv)

	c, w := newGETContext("/api/v1/search", map[string]string{
		"q": "admin", "type": "threads", "author": authorID, "since": "30d", "sort": "recent",
	})
	handler.Search(c)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	seen := f.seen()
	if len(seen) != 1 {
		t.Fatalf("expected 1 query, got %d", len(seen))
	}
	filter, _ := seen[0]["filter"].(string)
	if !strings.Contains(filter, `author_id = "`+authorID+`"`) {
		t.Errorf("author filter missing: %q", filter)
	}
	if !strings.Contains(filter, "created_at >= ") {
		t.Errorf("since filter missing: %q", filter)
	}
	sortVals, _ := seen[0]["sort"].([]interface{})
	if len(sortVals) != 1 || sortVals[0] != "created_at:desc" {
		t.Errorf("expected recent sort, got %v", seen[0]["sort"])
	}
}

func TestSearch_UnknownAuthorYieldsEmptyWithoutEngineCall(t *testing.T) {
	f, srv := newFakeMultiSearch(t, replyFor)
	handler, mock := engineHandler(t, srv)

	mock.ExpectQuery(`SELECT id FROM users WHERE LOWER\(username\)`).
		WithArgs("ghost").
		WillReturnError(sql.ErrNoRows)

	c, w := newGETContext("/api/v1/search", map[string]string{"q": "admin", "author": "ghost"})
	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if len(f.seen()) != 0 {
		t.Errorf("engine must not be queried for an unresolved author")
	}
}

func TestSearch_EngineErrorFallsBackToSQL(t *testing.T) {
	f, srv := newFakeMultiSearch(t, replyFor)
	f.status = http.StatusInternalServerError
	handler, mock := engineHandler(t, srv)

	mock.ExpectQuery(`SELECT u\.id, u\.public_id, u\.username, u\.display_name`).
		WithArgs("admin", nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "avatar_url"}))
	mock.ExpectQuery(`SELECT id, slug, name, description, cover_image_url, is_gomosub`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "slug", "name", "description", "cover_image_url", "is_gomosub"}))
	mock.ExpectQuery(`SELECT t\.id, t\.public_id, t\.title, t\.content`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "content", "created_at", "updated_at", "board_id", "board_slug", "board_name", "board_is_gomosub"}))
	mock.ExpectQuery(`SELECT p\.id, p\.content`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "content", "created_at", "thread_id", "thread_title", "board_id", "board_slug", "board_name", "board_is_gomosub", "username", "avatar_url"}))

	c, w := newGETContext("/api/v1/search", map[string]string{"q": "admin"})
	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200 after fallback, got %d", w.Code)
	}
	if len(f.seen()) == 0 {
		t.Fatal("expected the engine to have been tried")
	}
}

func TestSearch_PrivateProfileFallbackMergesForViewer(t *testing.T) {
	// Engine returns no users; the viewer's own private profile must still be
	// merged in from the SQL fallback.
	_, srv := newFakeMultiSearch(t, func(uid string) []map[string]interface{} { return []map[string]interface{}{} })
	handler, mock := engineHandler(t, srv)

	mock.ExpectQuery(`ps\.private_profile IS TRUE`).
		WithArgs("hidden", "user-1", 24).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "username", "display_name", "avatar_url"}).
			AddRow("priv-1", 99, "hidden", "Hidden", nil))

	c, w := newGETContextWithClaims("/api/v1/search", map[string]string{"q": "hidden", "type": "users"}, &auth.Claims{UserID: "user-1"})
	handler.Search(c)

	if !strings.Contains(w.Body.String(), "hidden") {
		t.Fatalf("viewer's private profile must be merged: %s", w.Body.String())
	}
}

func TestParseSearchTypes(t *testing.T) {
	if got := parseSearchTypes(""); got != nil {
		t.Errorf("empty types = %v, want nil (all)", got)
	}
	if got := parseSearchTypes("all"); got != nil {
		t.Errorf("all types = %v, want nil", got)
	}
	got := parseSearchTypes("threads, posts, bogus")
	if len(got) != 2 || !got["threads"] || !got["posts"] {
		t.Errorf("types = %v", got)
	}
}

func TestParseSince(t *testing.T) {
	if parseSince("") != 0 {
		t.Error("empty since should be 0")
	}
	if got := parseSince("1700000000"); got != 1700000000 {
		t.Errorf("unix since = %d", got)
	}
	if parseSince("nonsense") != 0 {
		t.Error("bad since should be 0")
	}
	got := parseSince("1d")
	want := time.Now().Add(-24 * time.Hour).Unix()
	if got < want-5 || got > want+5 {
		t.Errorf("1d since = %d, want ~%d", got, want)
	}
}

func TestParseSearchLimit(t *testing.T) {
	if parseSearchLimit("") != 0 || parseSearchLimit("0") != 0 || parseSearchLimit("-3") != 0 {
		t.Error("non-positive limits should be 0 (use default)")
	}
	if parseSearchLimit("500") != maxSearchLimit {
		t.Errorf("limit must be clamped to %d", maxSearchLimit)
	}
	if parseSearchLimit("42") != 42 {
		t.Error("valid limit must pass through")
	}
}
