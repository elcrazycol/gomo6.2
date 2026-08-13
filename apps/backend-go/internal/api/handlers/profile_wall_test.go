package handlers

import (
	"database/sql"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── decodeMaybeJSONB ─────────────────────────────────────────────────────────

func TestDecodeMaybeJSONB_Nil(t *testing.T) {
	result := decodeMaybeJSONB(nil)
	if result != nil {
		t.Fatalf("expected nil, got %v", result)
	}
}

func TestDecodeMaybeJSONB_ByteSliceJSON(t *testing.T) {
	input := []byte(`{"key": "value", "num": 42}`)
	result := decodeMaybeJSONB(input)

	parsed, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map[string]interface{}, got %T: %v", result, result)
	}
	if parsed["key"] != "value" {
		t.Fatalf("expected 'value', got %v", parsed["key"])
	}
	if parsed["num"] != float64(42) {
		t.Fatalf("expected 42.0, got %v (%T)", parsed["num"], parsed["num"])
	}
}

func TestDecodeMaybeJSONB_ByteSlicePlain(t *testing.T) {
	input := []byte(`plain text, not json`)
	result := decodeMaybeJSONB(input)
	if result != "plain text, not json" {
		t.Fatalf("expected 'plain text, not json', got %q", result)
	}
}

func TestDecodeMaybeJSONB_ByteSliceEmpty(t *testing.T) {
	input := []byte{}
	result := decodeMaybeJSONB(input)
	if result != "" {
		t.Fatalf("expected empty string, got %q", result)
	}
}

func TestDecodeMaybeJSONB_StringJSON(t *testing.T) {
	input := `{"array": [1, 2, 3], "nested": {"a": 1}}`
	result := decodeMaybeJSONB(input)

	parsed, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map[string]interface{}, got %T: %v", result, result)
	}

	arr, ok := parsed["array"].([]interface{})
	if !ok || len(arr) != 3 || arr[0] != float64(1) {
		t.Fatalf("unexpected array: %v", parsed["array"])
	}
}

func TestDecodeMaybeJSONB_StringPlain(t *testing.T) {
	input := `just a regular string`
	result := decodeMaybeJSONB(input)
	if result != "just a regular string" {
		t.Fatalf("expected 'just a regular string', got %q", result)
	}
}

func TestDecodeMaybeJSONB_StringNumber(t *testing.T) {
	input := `42`
	result := decodeMaybeJSONB(input)
	expected := float64(42)
	if result != expected {
		t.Fatalf("expected %v (float64), got %v (%T)", expected, result, result)
	}
}

func TestDecodeMaybeJSONB_StringBool(t *testing.T) {
	input := `true`
	result := decodeMaybeJSONB(input)
	if result != true && result != "true" {
		t.Fatalf("expected true (bool) or 'true' (string), got %v (%T)", result, result)
	}
}

func TestDecodeMaybeJSONB_StringArray(t *testing.T) {
	input := `[1, "two", 3.0]`
	result := decodeMaybeJSONB(input)

	parsed, ok := result.([]interface{})
	if !ok {
		t.Fatalf("expected []interface{}, got %T: %v", result, result)
	}
	if len(parsed) != 3 {
		t.Fatalf("expected 3 elements, got %d", len(parsed))
	}
}

func TestDecodeMaybeJSONB_OtherTypeInt(t *testing.T) {
	result := decodeMaybeJSONB(42)
	if result != 42 {
		t.Fatalf("expected 42, got %v", result)
	}
}

func TestDecodeMaybeJSONB_OtherTypeMap(t *testing.T) {
	input := map[string]string{"already": "parsed"}
	result := decodeMaybeJSONB(input)
	m, ok := result.(map[string]string)
	if !ok || m["already"] != "parsed" {
		t.Fatalf("expected original map, got %v", result)
	}
}

// ─── tryRespondProfileWallEnriched ────────────────────────────────────────────

func TestTryRespondProfileWallEnriched_NonWallTable(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/some_other_table", nil, nil)
	result := map[string]interface{}{"id": "123"}
	enriched := h.tryRespondProfileWallEnriched(c, "some_other_table", result)
	_ = mock
	_ = w

	if enriched {
		t.Fatal("expected false for non-wall table")
	}
}

func TestTryRespondProfileWallEnriched_MissingID(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"title": "no id here"}
	enriched := h.tryRespondProfileWallEnriched(c, "profile_wall_posts", result)
	_ = mock
	_ = w

	if enriched {
		t.Fatal("expected false when id is missing from result")
	}
}

func TestTryRespondProfileWallEnriched_PostDBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"id": "post123"}

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post123", "viewer").
		WillReturnError(sqlmock.ErrCancelled)

	enriched := h.tryRespondProfileWallEnriched(c, "profile_wall_posts", result)

	if !enriched {
		t.Fatal("expected true (falls back to original result on DB error)")
	}

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data == nil {
		t.Fatal("expected data in response")
	}
}

func TestTryRespondProfileWallEnriched_PostSuccess(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"id": "post123"}

	authorJSON := `{"username": "testuser", "avatar_url": null}`
	rows := sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments", "repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
		AddRow("post123", "u1", "u1", "Hello!", "World", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post123", "viewer").
		WillReturnRows(rows)

	enriched := h.tryRespondProfileWallEnriched(c, "profile_wall_posts", result)

	if !enriched {
		t.Fatal("expected true")
	}

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data["id"] != "post123" {
		t.Fatalf("expected post123, got %v", resp.Data["id"])
	}
	author, ok := resp.Data["author"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected author object, got %T", resp.Data["author"])
	}
	if author["username"] != "testuser" {
		t.Fatalf("expected testuser, got %v", author["username"])
	}
}

func TestTryRespondProfileWallEnriched_CommentSuccess(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"id": "comm123"}

	authorJSON := `{"username": "commenter", "is_anonymous": true}`
	rows := sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "content_json", "created_at", "updated_at", "author"}).
		AddRow("comm123", "post1", "u2", "Nice post!", nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", authorJSON)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.id = \$1`).
		WithArgs("comm123", "viewer").
		WillReturnRows(rows)

	enriched := h.tryRespondProfileWallEnriched(c, "profile_wall_post_comments", result)

	if !enriched {
		t.Fatal("expected true")
	}

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data["id"] != "comm123" {
		t.Fatalf("expected comm123, got %v", resp.Data["id"])
	}
}

// ─── Profile Wall Posts: GET with filters/pagination/errors ──────────────────

func TestHandleProfileWallPostsGet_EmptyResult(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data == nil {
		t.Fatal("expected empty array, not nil")
	}
}

// TestHandleProfileWallPostsGet_StrangerOnPrivateWall_GetsEmpty guards the read
// path of the wall privacy gate: the wall GET must join privacy_settings and
// keep the (private_profile OR private_hide_wall) predicate in its WHERE clause
// so a stranger asking for a private user's wall receives an empty array — not
// the wall rows, not an error. The predicate logic itself is unit-tested in the
// media gate (canViewUserWall) and the write gate (wallOwnerVisibleToViewer);
// this test pins the SQL so the read path cannot silently drop the filter.
func TestHandleProfileWallPostsGet_StrangerOnPrivateWall_GetsEmpty(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*LEFT JOIN privacy_settings ps.*COALESCE\(ps\.private_profile, false\) = false AND COALESCE\(ps\.private_hide_wall, false\) = false.*EXISTS \(SELECT 1 FROM friendships f`).
		WithArgs("privateUser", "stranger").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?user_id=eq.privateUser", nil, &auth.Claims{UserID: "stranger"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data == nil {
		t.Fatal("expected empty array, not nil")
	}
	arr, ok := resp.Data.([]interface{})
	if !ok || len(arr) != 0 {
		t.Fatalf("expected an empty wall, got %#v", resp.Data)
	}
}

func TestHandleProfileWallPostsGet_WithFilterAndLimit(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.user_id = \$1.*LIMIT 5`).
		WithArgs("u1", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "Post 1", "Content 1", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`).
			AddRow("post2", "u1", "u1", "Post 2", "Content 2", "2025-01-02T00:00:00Z", "2025-01-02T00:00:00Z", true, 1, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?user_id=eq.u1&limit=5", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 posts, got %d", len(resp.Data))
	}
	if resp.Data[0]["title"] != "Post 1" {
		t.Fatalf("expected 'Post 1', got %v", resp.Data[0]["title"])
	}
}

func TestHandleProfileWallPostsGet_WithIsPinnedFilterAndOrder(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.is_pinned = \$1.*ORDER BY "p"."pinned_order" ASC`).
		WithArgs("true", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("pin1", "u1", "u1", "Pinned 1", "Content", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", true, 1, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?is_pinned=eq.true&order=pinned_order.asc", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallPostsGet_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallPostsGet_WithNotEqFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE NOT \(p\.is_pinned = \$1\).*`).
		WithArgs("true", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post3", "u1", "u1", "Unpinned", "Content", "2025-01-03T00:00:00Z", "2025-01-03T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?is_pinned=not.eq.true", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallPostsGet_WithOrFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE \(p\.user_id = \$1 OR p\.user_id = \$2\).*`).
		WithArgs("u1", "u2", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "From u1", "", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`).
			AddRow("post2", "u2", "u2", "From u2", "", "2025-01-02T00:00:00Z", "2025-01-02T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?or=(user_id.eq.u1,user_id.eq.u2)", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHandleProfileWallPostsGet_EmbedsInteractionCounts verifies the wall GET
// returns the per-post interaction state (likes/comments/reposts counts +
// viewer state) embedded in every post row — this is what lets the client
// render the wall with ZERO per-post count requests.
func TestHandleProfileWallPostsGet_EmbedsInteractionCounts(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The regex requires `l.user_id = $1` (the substituted viewer reference in
	// the count subqueries) — if the {viewer} placeholder were ever left
	// unsubstituted, the query would not match and this test would fail.
	mock.ExpectQuery(`(?s).*SELECT p\.id.*l\.user_id = \$1.*FROM profile_wall_posts p LEFT JOIN users u.*`).
		WithArgs("viewer").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments",
			"repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order",
			"likes_count", "comments_count", "reposts_count", "liked_by_viewer",
			"my_repost_record_id", "my_reposted_wall_post_id", "author",
		}).
			AddRow("post1", "u1", "u1", "Post", "Content", nil, nil, nil, nil,
				"2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil,
				int64(7), int64(3), int64(1), true, "repost-1", "copy-1", `{"username": "u1"}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 post, got %d", len(resp.Data))
	}
	row := resp.Data[0]
	if row["likes_count"] != float64(7) || row["comments_count"] != float64(3) || row["reposts_count"] != float64(1) {
		t.Fatalf("unexpected counts: %+v", row)
	}
	if row["liked_by_viewer"] != true {
		t.Fatalf("expected liked_by_viewer=true, got %v", row["liked_by_viewer"])
	}
	if row["my_repost_record_id"] != "repost-1" || row["my_reposted_wall_post_id"] != "copy-1" {
		t.Fatalf("unexpected repost state: %+v", row)
	}
}

// ─── Profile Wall Comments: GET edge cases ───────────────────────────────────

func TestHandleProfileWallCommentsGet_WithFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.post_id = \$1`).
		WithArgs("post1", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}).
			AddRow("c1", "post1", "u2", "Nice!", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", `{}`).
			AddRow("c2", "post1", "u3", "Thanks!", "2025-01-02T00:00:00Z", "2025-01-02T00:00:00Z", `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments?post_id=eq.post1", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallCommentsGet_Empty(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallCommentsGet_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Profile Wall POST ───────────────────────────────────────────────────────

func TestUniversalPost_ProfileWallPost(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_posts \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content"}).
			AddRow("new_post", "u1", "u1", "My Wall Post", "Hello world!"))

	// Enrichment fetch
	authorJSON := `{"username": "testuser", "avatar_url": null}`
	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("new_post", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments", "repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("new_post", "u1", "u1", "My Wall Post", "Hello world!", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id":   "u1",
		"author_id": "u1",
		"title":     "My Wall Post",
		"content":   "Hello world!",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data["title"] != "My Wall Post" {
		t.Fatalf("expected 'My Wall Post', got %v", resp.Data["title"])
	}
	if _, ok := resp.Data["author"]; !ok {
		t.Fatal("expected author in response")
	}
}

func TestUniversalPost_ProfileWallComment(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// L5: the wall-privacy gate resolves the post's owner first; the post must
	// exist (otherwise the comment would be an orphan readable by everyone).
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	// post1 belongs to u1, commenter is u2 → check u1's wall visibility
	// (public profile, wall not hidden → visible).
	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\), COALESCE\(private_hide_wall, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"private", "hide_wall"}).AddRow(false, false))

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_comments \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content"}).
			AddRow("new_comment", "post1", "u2", "Great post!"))

	// Enrichment fetch
	authorJSON := `{"username": "commenter", "avatar_url": null}`
	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.id = \$1`).
		WithArgs("new_comment", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "content_json", "created_at", "updated_at", "author"}).
			AddRow("new_comment", "post1", "u2", "Great post!", nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", authorJSON))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_comments", map[string]string{
		"post_id": "post1",
		"user_id": "u2",
		"content": "Great post!",
	}, &auth.Claims{UserID: "u2"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data["content"] != "Great post!" {
		t.Fatalf("expected 'Great post!', got %v", resp.Data["content"])
	}
	if _, ok := resp.Data["author"]; !ok {
		t.Fatal("expected author in response")
	}
}

// ─── Profile Wall Likes ──────────────────────────────────────────────────────

func TestUniversalPost_ProfileWallPostLike(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// L5: the wall-privacy gate resolves the post's owner first; the post must
	// exist. post1 belongs to u1 (the caller) → allowed without a privacy check.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_likes.*VALUES.*ON CONFLICT.*DO UPDATE SET user_id = EXCLUDED.user_id.*RETURNING \*`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id"}).
			AddRow("like1", "post1", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "post1",
		"user_id": "u1",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_ProfileWallPostLike_InvalidBody(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_likes", "not valid at all", nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── L5: orphan-comment hardening ───────────────────────────────────────────

// TestHandleProfileWallCommentsGet_UsesInnerJoin is a regression guard for the
// L5 leak: the comment read query must INNER JOIN the parent post so that a
// comment whose post has been deleted (orphan) is dropped instead of passing
// the privacy predicate with a NULL wall owner.
func TestHandleProfileWallCommentsGet_UsesInnerJoin(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c.*INNER JOIN profile_wall_posts wp ON wp\.id = c\.post_id.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, &auth.Claims{UserID: "viewer"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_ProfileWallComment_PostNotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// L5: commenting on a nonexistent post must be rejected (fail-closed), not
	// silently creating an orphan comment readable by everyone.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("ghost-post").
		WillReturnError(sql.ErrNoRows)

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_comments", map[string]string{
		"post_id": "ghost-post",
		"content": "orphan attempt",
	}, &auth.Claims{UserID: "u2"})
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_ProfileWallComment_MissingPostID(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_comments", map[string]string{
		"content": "no post reference",
	}, &auth.Claims{UserID: "u2"})
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_ProfileWallPostLike_PostNotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("ghost-post").
		WillReturnError(sql.ErrNoRows)

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "ghost-post",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_CommentLike_CommentNotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// L5: liking a comment whose (post) chain is gone must be rejected.
	mock.ExpectQuery(`(?s).*SELECT wp\.user_id.*FROM profile_wall_post_comments c JOIN profile_wall_posts wp.*WHERE c\.id = \$1`).
		WithArgs("ghost-comment").
		WillReturnError(sql.ErrNoRows)

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_comment_likes", map[string]string{
		"comment_id": "ghost-comment",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_Repost_PostNotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// L5: reposting a nonexistent post would create a dangling repost readable
	// by everyone — reject it.
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("ghost-post").
		WillReturnError(sql.ErrNoRows)

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_reposts", map[string]string{
		"post_id": "ghost-post",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_ProfileWallComment_CannotMovePost(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// L5: the client tries to re-point the comment onto another post via a
	// generic PUT; post_id must be dropped from the SET clause (the target post
	// is fixed at creation), so the UPDATE stays scoped to the caller's own
	// comment and only content changes.
	mock.ExpectQuery(`(?s).*UPDATE profile_wall_post_comments SET content = \$1 WHERE user_id = \$2 AND id = \$3.*RETURNING \*`).
		WithArgs("updated", "u1", "c1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content"}).
			AddRow("c1", "post1", "u1", "updated"))

	// Enrichment fetch
	authorJSON := `{"username": "commenter", "avatar_url": null}`
	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.id = \$1`).
		WithArgs("c1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "content_json", "created_at", "updated_at", "author"}).
			AddRow("c1", "post1", "u1", "updated", nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", authorJSON))

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_post_comments?id=eq.c1", map[string]string{
		"content": "updated",
		"post_id": "victim-post",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestUniversalPut_ProfileWallComment_CannotTouchIsDeleted proves the
// un-delete vector is closed: is_deleted is server-managed (set only by the
// soft-delete DELETE path), so a generic PUT trying to reset it is stripped
// from the SET clause — the UPDATE only ever carries content.
func TestUniversalPut_ProfileWallComment_CannotTouchIsDeleted(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*UPDATE profile_wall_post_comments SET content = \$1 WHERE user_id = \$2 AND id = \$3.*RETURNING \*`).
		WithArgs("updated", "u1", "c1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "is_deleted"}).
			AddRow("c1", "post1", "u1", "updated", true))

	// Enrichment fetch
	authorJSON := `{"username": "commenter", "avatar_url": null}`
	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.id = \$1`).
		WithArgs("c1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "content_json", "created_at", "updated_at", "is_deleted", "author"}).
			AddRow("c1", "post1", "u1", "updated", nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", true, authorJSON))

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_post_comments?id=eq.c1", map[string]string{
		"content":    "updated",
		"is_deleted": "false",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHandleProfileWallPostCommentsGet_DeletedComment_AuthorScrubbed proves
// M-3 (2026-08-14 audit): a soft-deleted comment must not leak its author
// through the API. The SELECT CASE-scrubs user_id and the author embed when
// is_deleted, so the response carries no identity — the UI's "Автор
// неизвестен" placeholder is no longer a lie at the API level.
func TestHandleProfileWallPostCommentsGet_DeletedComment_AuthorScrubbed(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s)SELECT c\.id, c\.post_id.*CASE WHEN c\.is_deleted THEN NULL ELSE c\.user_id END AS user_id.*` +
		`CASE WHEN c\.is_deleted THEN '\{\}'::json.*AS author.*FROM profile_wall_post_comments c.*`).
		WithArgs("post-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "post_id", "user_id", "parent_id", "content", "content_json",
			"created_at", "updated_at", "is_deleted", "likes_count", "liked_by_viewer", "author",
		}).AddRow("c1", "post-1", nil, nil, nil, nil,
			"2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", true, int64(0), false, []byte(`{}`)))

	c, w := newUniversalRequestContext("GET",
		"/api/v1/profile_wall_post_comments?post_id=eq.post-1&order=created_at.asc", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	data, ok := resp.Data.([]interface{})
	if !ok || len(data) != 1 {
		t.Fatalf("expected 1 comment row, got %#v", resp.Data)
	}
	row, ok := data[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected row object, got %#v", data[0])
	}
	if row["user_id"] != nil {
		t.Fatalf("deleted comment leaked user_id: %#v", row["user_id"])
	}
	author, ok := row["author"].(map[string]interface{})
	if !ok || len(author) != 0 {
		t.Fatalf("deleted comment leaked author: %#v", row["author"])
	}
	if row["is_deleted"] != true {
		t.Fatalf("expected is_deleted true, got %#v", row["is_deleted"])
	}
}

// ─── Profile Wall Likes: GET ─────────────────────────────────────────────────

func TestUniversalGet_ProfileWallPostLikes(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM profile_wall_post_likes`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "created_at"}).
			AddRow("l1", "post1", "u1", "2025-01-01T00:00:00Z").
			AddRow("l2", "post1", "u2", "2025-01-01T00:01:00Z"))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_likes", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 likes, got %d", len(resp.Data))
	}
}

func TestUniversalGet_ProfileWallPostLikes_Empty(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM profile_wall_post_likes`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "created_at"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_likes", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_ProfileWallPostLikes_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM profile_wall_post_likes`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_likes", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Profile Wall PUT ────────────────────────────────────────────────────────

func TestUniversalPut_ProfileWallPost(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*UPDATE profile_wall_posts SET .* WHERE .*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}).
			AddRow("post1", "u1", "My Post", "Updated content"))

	// Enrichment
	authorJSON := `{"username": "testuser", "avatar_url": null}`
	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments", "repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "My Post", "Updated content", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON))

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "Updated content",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_ProfileWallPost_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*UPDATE profile_wall_posts SET .* WHERE .*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}))

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.nonexistent", map[string]string{
		"content": "New content",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Profile Wall DELETE ─────────────────────────────────────────────────────

func TestUniversalDelete_ProfileWallPost(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*DELETE FROM profile_wall_posts WHERE .*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}).
			AddRow("post1", "u1", "My Post", "Content"))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/profile_wall_posts?id=eq.post1", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalDelete_ProfileWallPost_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*DELETE FROM profile_wall_posts WHERE .*RETURNING \*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/profile_wall_posts?id=eq.nonexistent", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
