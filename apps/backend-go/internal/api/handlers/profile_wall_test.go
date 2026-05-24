package handlers

import (
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
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

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, nil)
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

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, nil)
	result := map[string]interface{}{"id": "post123"}

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post123").
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

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, nil)
	result := map[string]interface{}{"id": "post123"}

	authorJSON := `{"username": "testuser", "avatar_url": null}`
	rows := sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments", "repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
		AddRow("post123", "u1", "u1", "Hello!", "World", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post123").
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

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, nil)
	result := map[string]interface{}{"id": "comm123"}

	authorJSON := `{"username": "commenter", "is_anonymous": true}`
	rows := sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "content_json", "created_at", "updated_at", "author"}).
		AddRow("comm123", "post1", "u2", "Nice post!", nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", authorJSON)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.id = \$1`).
		WithArgs("comm123").
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

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, nil)
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

func TestHandleProfileWallPostsGet_WithFilterAndLimit(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.user_id = \$1.*LIMIT 5`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "Post 1", "Content 1", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`).
			AddRow("post2", "u1", "u1", "Post 2", "Content 2", "2025-01-02T00:00:00Z", "2025-01-02T00:00:00Z", true, 1, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?user_id=eq.u1&limit=5", nil, nil)
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
		WithArgs("true").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("pin1", "u1", "u1", "Pinned 1", "Content", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", true, 1, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?is_pinned=eq.true&order=pinned_order.asc", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallPostsGet_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallPostsGet_WithNotEqFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE NOT \(p\.is_pinned = \$1\).*`).
		WithArgs("true").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post3", "u1", "u1", "Unpinned", "Content", "2025-01-03T00:00:00Z", "2025-01-03T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?is_pinned=not.eq.true", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallPostsGet_WithOrFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE \(p\.user_id = \$1 OR p\.user_id = \$2\).*`).
		WithArgs("u1", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "From u1", "", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`).
			AddRow("post2", "u2", "u2", "From u2", "", "2025-01-02T00:00:00Z", "2025-01-02T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts?or=(user_id.eq.u1,user_id.eq.u2)", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Profile Wall Comments: GET edge cases ───────────────────────────────────

func TestHandleProfileWallCommentsGet_WithFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.post_id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}).
			AddRow("c1", "post1", "u2", "Nice!", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", `{}`).
			AddRow("c2", "post1", "u3", "Thanks!", "2025-01-02T00:00:00Z", "2025-01-02T00:00:00Z", `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments?post_id=eq.post1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallCommentsGet_Empty(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProfileWallCommentsGet_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, nil)
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
		WithArgs("new_post").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments", "repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("new_post", "u1", "u1", "My Wall Post", "Hello world!", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_posts", map[string]string{
		"user_id":   "u1",
		"author_id": "u1",
		"title":     "My Wall Post",
		"content":   "Hello world!",
	}, nil)
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

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_comments \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content"}).
			AddRow("new_comment", "post1", "u2", "Great post!"))

	// Enrichment fetch
	authorJSON := `{"username": "commenter", "avatar_url": null}`
	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.id = \$1`).
		WithArgs("new_comment").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "content_json", "created_at", "updated_at", "author"}).
			AddRow("new_comment", "post1", "u2", "Great post!", nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", authorJSON))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_comments", map[string]string{
		"post_id": "post1",
		"user_id": "u2",
		"content": "Great post!",
	}, nil)
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

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_likes.*VALUES.*ON CONFLICT.*DO UPDATE SET user_id = EXCLUDED.user_id.*RETURNING \*`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id"}).
			AddRow("like1", "post1", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "post1",
		"user_id": "u1",
	}, nil)
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

	mock.ExpectQuery(`UPDATE profile_wall_posts SET content = \$1 WHERE id = \$2 RETURNING \*`).
		WithArgs("Updated content", "post1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}).
			AddRow("post1", "u1", "My Post", "Updated content"))

	// Enrichment
	authorJSON := `{"username": "testuser", "avatar_url": null}`
	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments", "repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "My Post", "Updated content", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON))

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", map[string]string{
		"content": "Updated content",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_ProfileWallPost_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`UPDATE profile_wall_posts SET content = \$1 WHERE id = \$2 RETURNING \*`).
		WithArgs("New content", "nonexistent").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}))

	c, w := newUniversalRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.nonexistent", map[string]string{
		"content": "New content",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Profile Wall DELETE ─────────────────────────────────────────────────────

func TestUniversalDelete_ProfileWallPost(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`DELETE FROM profile_wall_posts WHERE id = \$1 RETURNING \*`).
		WithArgs("post1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}).
			AddRow("post1", "u1", "My Post", "Content"))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/profile_wall_posts?id=eq.post1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalDelete_ProfileWallPost_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`DELETE FROM profile_wall_posts WHERE id = \$1 RETURNING \*`).
		WithArgs("nonexistent").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "content"}))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/profile_wall_posts?id=eq.nonexistent", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
