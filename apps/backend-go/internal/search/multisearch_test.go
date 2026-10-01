package search

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMultiSearchMapsResultsByIndexKey(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/multi-search" {
			http.NotFound(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		var req struct {
			Queries []struct {
				IndexUID string `json:"indexUid"`
			} `json:"queries"`
		}
		_ = json.Unmarshal(body, &req)
		results := make([]map[string]interface{}, 0, len(req.Queries))
		for _, q := range req.Queries {
			results = append(results, map[string]interface{}{
				"indexUid":           q.IndexUID,
				"hits":               []map[string]interface{}{{"id": q.IndexUID}},
				"estimatedTotalHits": 1,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"results": results})
	}))
	t.Cleanup(srv.Close)

	svc := New(Config{URL: srv.URL, IndexPrefix: "gomo6_"})
	res, err := svc.MultiSearch(context.Background(), []MultiQuery{
		{IndexKey: IndexThreads, Query: "привет", Filter: `board_visibility = "public"`, Sort: []string{"created_at:desc"}, Limit: 5},
		{IndexKey: IndexUsers, Query: "привет", Limit: 3},
	})
	if err != nil {
		t.Fatalf("MultiSearch: %v", err)
	}

	if _, ok := res[IndexThreads]; !ok {
		t.Errorf("threads result missing: %v", res)
	}
	if _, ok := res[IndexUsers]; !ok {
		t.Errorf("users result missing: %v", res)
	}
	if !strings.Contains(gotBody, `"indexUid":"gomo6_threads"`) {
		t.Errorf("request did not target the prefixed index: %s", gotBody)
	}
	if !strings.Contains(gotBody, `board_visibility = \"public\"`) {
		t.Errorf("filter not forwarded: %s", gotBody)
	}
	if !strings.Contains(gotBody, `"sort":["created_at:desc"]`) {
		t.Errorf("sort not forwarded: %s", gotBody)
	}
}

func TestMultiSearchDisabled(t *testing.T) {
	if _, err := New(Config{}).MultiSearch(context.Background(), []MultiQuery{{IndexKey: IndexUsers}}); err != ErrDisabled {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
}
