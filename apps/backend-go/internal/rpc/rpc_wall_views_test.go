package rpc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/testutil"
	"github.com/redis/go-redis/v9"
)

const viewPostUUID = "550e8400-e29b-41d4-a716-446655440000"

// TestRecordWallViews_Authenticated verifies an authenticated viewer records a
// view keyed by their user id, and that matching anonymous rows under the same
// viewer_key are migrated (attributed) to the account in one batch UPDATE so
// the person still counts as one.
func TestRecordWallViews_Authenticated(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "viewer-1", Username: "viewer"}

	// Merge: anonymous rows under the same key are attributed to the account
	// in a single UPDATE across the whole batch.
	mock.ExpectExec(`(?s)UPDATE profile_wall_post_views.*SET viewer_id = \$1, viewer_key = NULL.*viewer_key = \$2 AND post_id::text = ANY\(\$3\)`).
		WithArgs("viewer-1", "anon-key-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// Authenticated rows carry the user id only (nil viewer_key) — otherwise
	// two accounts on a shared browser would collide on UNIQUE(post_id,
	// viewer_key). The batch INSERT applies the visibility gate per post.
	mock.ExpectExec(`(?s)INSERT INTO profile_wall_post_views.*ON CONFLICT DO NOTHING`).
		WithArgs("viewer-1", nil, sqlmock.AnyArg(), "viewer-1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs:   []string{viewPostUUID},
		ViewerKey: "anon-key-1",
	}, claims)
	h.RecordWallViews(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Data != float64(1) {
		t.Fatalf("expected 1 recorded view, got %v", resp.Data)
	}
}

// TestRecordWallViews_AuthenticatedWithoutKey verifies an authenticated viewer
// does not need a viewer_key (dedup runs on the user id alone) and that no
// merge UPDATE runs without a key.
func TestRecordWallViews_AuthenticatedWithoutKey(t *testing.T) {
	h, mock := setupRPCHandler(t)
	claims := &auth.Claims{UserID: "viewer-1", Username: "viewer"}

	mock.ExpectExec(`(?s)INSERT INTO profile_wall_post_views.*ON CONFLICT DO NOTHING`).
		WithArgs("viewer-1", nil, sqlmock.AnyArg(), "viewer-1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs: []string{viewPostUUID},
	}, claims)
	h.RecordWallViews(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Data != float64(1) {
		t.Fatalf("expected 1 recorded view, got %v", resp.Data)
	}
}

// TestRecordWallViews_Anonymous verifies an anonymous browser records a view
// keyed by its viewer_key (viewer_id NULL).
func TestRecordWallViews_Anonymous(t *testing.T) {
	h, mock := setupRPCHandler(t)

	mock.ExpectExec(`(?s)INSERT INTO profile_wall_post_views.*ON CONFLICT DO NOTHING`).
		WithArgs(nil, "anon-key-1", sqlmock.AnyArg(), "").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs:   []string{viewPostUUID},
		ViewerKey: "anon-key-1",
	}, nil)
	h.RecordWallViews(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Data != float64(1) {
		t.Fatalf("expected 1 recorded view, got %v", resp.Data)
	}
}

// TestRecordWallViews_AnonymousWithoutKey verifies anonymous callers without a
// viewer_key are rejected (they could not be deduped at all).
func TestRecordWallViews_AnonymousWithoutKey(t *testing.T) {
	h, _ := setupRPCHandler(t)

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs: []string{viewPostUUID},
	}, nil)
	h.RecordWallViews(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	// No expectations were set — sqlmock fails the test if any query ran.
}

// TestRecordWallViews_EmptyList verifies an empty/invalid post list is a
// successful no-op (no DB round trips).
func TestRecordWallViews_EmptyList(t *testing.T) {
	h, _ := setupRPCHandler(t)

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs:   []string{},
		ViewerKey: "anon-key-1",
	}, nil)
	h.RecordWallViews(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Data != float64(0) {
		t.Fatalf("expected 0 recorded views, got %v", resp.Data)
	}
}

// TestRecordWallViews_SkipsInvalidAndDuplicateIds verifies garbage ids are
// dropped silently and duplicates collapse — the remaining ids are sent as one
// batch INSERT whose RowsAffected reflects exactly the valid unique ids.
func TestRecordWallViews_SkipsInvalidAndDuplicateIds(t *testing.T) {
	h, mock := setupRPCHandler(t)
	other := "550e8400-e29b-41d4-a716-446655440001"

	mock.ExpectExec(`(?s)INSERT INTO profile_wall_post_views.*ON CONFLICT DO NOTHING`).
		WithArgs(nil, "anon-key-1", sqlmock.AnyArg(), "").
		WillReturnResult(sqlmock.NewResult(1, 2))

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs:   []string{"not-a-uuid", viewPostUUID, viewPostUUID, "", other},
		ViewerKey: "anon-key-1",
	}, nil)
	h.RecordWallViews(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Data != float64(2) {
		t.Fatalf("expected 2 recorded views, got %v", resp.Data)
	}
}

// TestRecordWallViews_InvisiblePostCountsZero verifies a post that fails the
// visibility gate (private wall, non-friend) inserts nothing: RowsAffected 0.
func TestRecordWallViews_InvisiblePostCountsZero(t *testing.T) {
	h, mock := setupRPCHandler(t)

	mock.ExpectExec(`(?s)INSERT INTO profile_wall_post_views.*ON CONFLICT DO NOTHING`).
		WithArgs(nil, "anon-key-1", sqlmock.AnyArg(), "").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs:   []string{viewPostUUID},
		ViewerKey: "anon-key-1",
	}, nil)
	h.RecordWallViews(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Data != float64(0) {
		t.Fatalf("expected 0 recorded views, got %v", resp.Data)
	}
}

// TestRecordWallViews_BatchCapped verifies at most maxWallViewsBatch ids are
// processed per request even when the client sends more.
func TestRecordWallViews_BatchCapped(t *testing.T) {
	h, mock := setupRPCHandler(t)

	ids := make([]string, 0, maxWallViewsBatch+10)
	const hexChars = "0123456789abcdef"
	for i := 0; i < maxWallViewsBatch+10; i++ {
		// Vary the last two hex digits so every id is a distinct valid UUID.
		ids = append(ids, viewPostUUID[:34]+string([]byte{hexChars[(i/16)%16], hexChars[i%16]}))
	}

	mock.ExpectExec(`(?s)INSERT INTO profile_wall_post_views.*ON CONFLICT DO NOTHING`).
		WithArgs(nil, "anon-key-1", sqlmock.AnyArg(), "").
		WillReturnResult(sqlmock.NewResult(1, maxWallViewsBatch))

	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs:   ids,
		ViewerKey: "anon-key-1",
	}, nil)
	h.RecordWallViews(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Data != float64(maxWallViewsBatch) {
		t.Fatalf("expected %d recorded views, got %v", maxWallViewsBatch, resp.Data)
	}
}

// TestRecordWallViews_OversizedBody verifies a request body far beyond
// maxWallViewsBodyBytes is rejected before any SQL runs.
func TestRecordWallViews_OversizedBody(t *testing.T) {
	h, _ := setupRPCHandler(t)

	// ~5000 duplicated ids serialize to well over the 64 KB cap.
	ids := make([]string, 0, 5000)
	for i := 0; i < 5000; i++ {
		ids = append(ids, viewPostUUID)
	}
	c, w := testutil.NewRPCPostContext(recordWallViewsRequest{
		PostIDs:   ids,
		ViewerKey: "anon-key-1",
	}, nil)
	h.RecordWallViews(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an oversized body, got %d", w.Code)
	}
	// No expectations set — sqlmock fails the test if any query ran.
}

// TestAnonymousViewerKeyCap verifies the per-IP anti-inflation budget: a real
// browser reusing one key is never blocked, but an attacker rotating forged
// keys hits the cap and is rejected. Different IPs have independent budgets.
func TestAnonymousViewerKeyCap(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	h, _ := setupRPCHandler(t)
	h.SetRedis(rdb)

	ctxFor := func(remoteAddr string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/rpc/record_wall_views", nil)
		c.Request.RemoteAddr = remoteAddr
		return c
	}
	c := ctxFor("203.0.113.7:1234")

	// A real browser sends the SAME key on every flush — always allowed.
	for i := 0; i < 3; i++ {
		if !h.anonymousViewerKeyAllowed(c, "stable-key") {
			t.Fatal("repeated stable key must always be allowed")
		}
	}

	// Rotating forged keys exhausts the per-IP cap.
	blocked := false
	for i := 0; i < maxAnonViewerKeysPerIP+10; i++ {
		if !h.anonymousViewerKeyAllowed(c, fmt.Sprintf("forged-%d", i)) {
			blocked = true
			break
		}
	}
	if !blocked {
		t.Fatalf("expected the distinct-key cap (%d) to block forged keys", maxAnonViewerKeysPerIP)
	}

	// A different IP has its own budget.
	other := ctxFor("198.51.100.9:4321")
	if !h.anonymousViewerKeyAllowed(other, "forged-0") {
		t.Fatal("a different IP must have its own key budget")
	}
}
