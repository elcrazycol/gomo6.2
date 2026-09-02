package wall

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// privacyRowSQL matches CanViewWall's two-flag SELECT.
const privacyRowSQL = `SELECT COALESCE\(private_profile, false\), COALESCE\(private_hide_wall, false\) FROM privacy_settings WHERE user_id = \$1`

func expectVisibleWall(mock sqlmock.Sqlmock, ownerID string) {
	mock.ExpectQuery(privacyRowSQL).
		WithArgs(ownerID).
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}).AddRow(false, false))
}

func expectHiddenWall(mock sqlmock.Sqlmock, viewerID, ownerID string) {
	mock.ExpectQuery(privacyRowSQL).
		WithArgs(ownerID).
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}).AddRow(true, false))
	// A private wall routes to the friendship check (not a friend → hidden).
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs(viewerID, ownerID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
}

func expectNoPrivacyRow(mock sqlmock.Sqlmock, ownerID string) {
	mock.ExpectQuery(privacyRowSQL).
		WithArgs(ownerID).
		WillReturnRows(sqlmock.NewRows([]string{"private_profile", "private_hide_wall"}))
}

// ─── HandleAlbumsGet ────────────────────────────────────────────────────────

func TestHandleAlbumsGet_RequiresUserFilter(t *testing.T) {
	srv, _ := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_albums", nil, nil)
	srv.HandleAlbumsGet(c)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleAlbumsGet_OwnerSeesAlbumsWithCount(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_albums?user_id=eq.u1", nil, &auth.Claims{UserID: "u1"})

	// Viewer == owner → CanViewWall returns true without a privacy query.
	rows := sqlmock.NewRows([]string{"id", "user_id", "name", "created_at", "updated_at", "post_count"}).
		AddRow("album-1", "u1", "Мои лучшие", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", 3)
	mock.ExpectQuery(`(?s).*SELECT a\.id, a\.user_id, a\.name.*FROM profile_albums a.*WHERE a\.user_id = \$1.*ORDER BY a\.created_at ASC`).
		WithArgs("u1").
		WillReturnRows(rows)

	srv.HandleAlbumsGet(c)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 1 || resp.Data[0]["id"] != "album-1" {
		t.Fatalf("unexpected albums: %+v", resp.Data)
	}
	if resp.Data[0]["post_count"] != float64(3) {
		t.Fatalf("expected post_count 3, got %v", resp.Data[0]["post_count"])
	}
}

func TestHandleAlbumsGet_PublicWallVisibleToAnonymous(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_albums?user_id=eq.u1", nil, nil)

	expectNoPrivacyRow(mock, "u1") // no privacy row = public wall
	rows := sqlmock.NewRows([]string{"id", "user_id", "name", "created_at", "updated_at", "post_count"})
	mock.ExpectQuery(`(?s).*FROM profile_albums a.*WHERE a\.user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(rows)

	srv.HandleAlbumsGet(c)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestHandleAlbumsGet_HiddenWallReturnsEmpty(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_albums?user_id=eq.u1", nil, &auth.Claims{UserID: "viewer"})

	expectHiddenWall(mock, "viewer", "u1")

	srv.HandleAlbumsGet(c)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if w.Body.String() == "" {
		t.Fatal("expected a body")
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data == nil {
		t.Fatal("expected empty data array")
	}
}

// ─── HandleAlbumPostsGet ────────────────────────────────────────────────────

func TestHandleAlbumPostsGet_RequiresAlbumFilter(t *testing.T) {
	srv, _ := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_album_posts", nil, nil)
	srv.HandleAlbumPostsGet(c)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleAlbumPostsGet_UnknownAlbum404(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_album_posts?album_id=eq.missing", nil, nil)
	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("missing").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}))
	srv.HandleAlbumPostsGet(c)
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestHandleAlbumPostsGet_ReturnsWallRowsNewestAddedFirst(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_album_posts?album_id=eq.album-1", nil, &auth.Claims{UserID: "viewer"})

	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	expectVisibleWall(mock, "u1")

	authorJSON := `{"username": "author", "avatar_url": null}`
	rows := sqlmock.NewRows([]string{
		"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments",
		"repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author",
	}).AddRow("post-1", "u1", "u1", "Post", "body", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON)
	mock.ExpectQuery(`(?s).*FROM profile_album_posts ap.*JOIN profile_wall_posts p ON p\.id = ap\.post_id.*WHERE ap\.album_id = \$1.*ORDER BY ap\.added_at DESC`).
		WithArgs("album-1", "viewer").
		WillReturnRows(rows)

	srv.HandleAlbumPostsGet(c)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 1 || resp.Data[0]["id"] != "post-1" {
		t.Fatalf("unexpected posts: %+v", resp.Data)
	}
	if _, ok := resp.Data[0]["author"].(map[string]interface{}); !ok {
		t.Fatalf("expected author embed, got %T", resp.Data[0]["author"])
	}
}

func TestHandleAlbumPostsGet_HiddenWallReturnsEmpty(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("GET", "/api/v1/profile_album_posts?album_id=eq.album-1", nil, &auth.Claims{UserID: "viewer"})

	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	expectHiddenWall(mock, "viewer", "u1")

	srv.HandleAlbumPostsGet(c)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestHandleAlbumPostsGet_KeysetHasMore(t *testing.T) {
	srv, mock := setupService(t)

	// limit=2, 3 rows added → the probe (LIMIT 3) returns 3 rows,
	// has_more=true, and next_cursor comes from the last KEPT row (post2,
	// index 1 after slicing) keyed on the album membership's added_at.
	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	expectVisibleWall(mock, "u1")

	columns := []string{
		"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments",
		"repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "added_at", "author",
	}
	mock.ExpectQuery(`(?s).*FROM profile_album_posts ap.*WHERE ap\.album_id = \$1.*ORDER BY ap\.added_at DESC, ap\.post_id DESC.*LIMIT 3`).
		WithArgs("album-1", "viewer").
		WillReturnRows(sqlmock.NewRows(columns).
			AddRow("post3", "u1", "u1", "Post 3", "C", nil, nil, nil, nil, "2025-01-03T00:00:00Z", "2025-01-03T00:00:00Z", false, nil, time.Date(2025, 1, 3, 0, 0, 0, 0, time.UTC), `{}`).
			AddRow("post2", "u1", "u1", "Post 2", "C", nil, nil, nil, nil, "2025-01-02T00:00:00Z", "2025-01-02T00:00:00Z", false, nil, time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC), `{}`).
			AddRow("post1", "u1", "u1", "Post 1", "C", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), `{}`))

	c, w := newRequestContext("GET", "/api/v1/profile_album_posts?album_id=eq.album-1&limit=2", nil, &auth.Claims{UserID: "viewer"})
	srv.HandleAlbumPostsGet(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data       []map[string]interface{} `json:"data"`
		HasMore    *bool                    `json:"has_more"`
		NextCursor *string                  `json:"next_cursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 posts on page 1, got %d", len(resp.Data))
	}
	if resp.HasMore == nil || !*resp.HasMore {
		t.Fatalf("expected has_more=true, got %v", resp.HasMore)
	}
	if resp.NextCursor == nil || !strings.HasPrefix(*resp.NextCursor, "2025-01-02T00:00:00Z::post2") {
		t.Fatalf("expected next_cursor from the last kept row (post2), got %q", cursorOrNil(resp.NextCursor))
	}
}

func TestHandleAlbumPostsGet_KeysetCursorPage(t *testing.T) {
	srv, mock := setupService(t)

	// A cursor page binds the keyset predicate after album_id and the viewer:
	// $1 album_id, $2 viewer, $3 added_at, $4 post id.
	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	expectVisibleWall(mock, "u1")

	columns := []string{
		"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments",
		"repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "added_at", "author",
	}
	mock.ExpectQuery(`(?s).*WHERE ap\.album_id = \$1 AND \(ap\.added_at, ap\.post_id\) < \(\$3::timestamptz, \$4::uuid\).*ORDER BY ap\.added_at DESC.*LIMIT 3`).
		WithArgs("album-1", "viewer", time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC), "post2").
		WillReturnRows(sqlmock.NewRows(columns).
			AddRow("post1", "u1", "u1", "Post 1", "C", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), `{}`).
			AddRow("post0", "u1", "u1", "Post 0", "C", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, time.Date(2024, 12, 31, 0, 0, 0, 0, time.UTC), `{}`))

	c, w := newRequestContext("GET",
		"/api/v1/profile_album_posts?album_id=eq.album-1&limit=2&cursor=2025-01-02T00:00:00Z::post2",
		nil, &auth.Claims{UserID: "viewer"})
	srv.HandleAlbumPostsGet(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data       []map[string]interface{} `json:"data"`
		HasMore    *bool                    `json:"has_more"`
		NextCursor *string                  `json:"next_cursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 posts on the cursor page, got %d", len(resp.Data))
	}
	if resp.HasMore == nil || *resp.HasMore {
		t.Fatalf("expected has_more=false, got %v", resp.HasMore)
	}
	if resp.NextCursor != nil {
		t.Fatalf("expected no next_cursor when the probe returned exactly limit rows, got %q", cursorOrNil(resp.NextCursor))
	}
}

func TestHandleAlbumPostsGet_InvalidCursor_Returns400(t *testing.T) {
	srv, mock := setupService(t)

	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	expectVisibleWall(mock, "u1")

	c, w := newRequestContext("GET", "/api/v1/profile_album_posts?album_id=eq.album-1&cursor=not-a-valid-cursor", nil, &auth.Claims{UserID: "viewer"})
	srv.HandleAlbumPostsGet(c)

	if w.Code != 400 {
		t.Fatalf("expected 400 for an invalid cursor, got %d", w.Code)
	}
}

// ─── PrepareAlbumBody ───────────────────────────────────────────────────────

func TestPrepareAlbumBody_ValidatesName(t *testing.T) {
	srv, _ := setupService(t)

	c, w := newRequestContext("POST", "/api/v1/profile_albums", map[string]interface{}{"name": "   "}, &auth.Claims{UserID: "u1"})
	if srv.PrepareAlbumBody(c, "profile_albums", "POST", map[string]interface{}{"name": "   "}) {
		t.Fatal("expected rejection for blank name")
	}
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}

	long := make([]rune, 81)
	for i := range long {
		long[i] = 'a'
	}
	c2, w2 := newRequestContext("POST", "/api/v1/profile_albums", nil, &auth.Claims{UserID: "u1"})
	if srv.PrepareAlbumBody(c2, "profile_albums", "POST", map[string]interface{}{"name": string(long)}) {
		t.Fatal("expected rejection for name longer than 80 chars")
	}
	if w2.Code != 400 {
		t.Fatalf("expected 400, got %d", w2.Code)
	}

	c3, _ := newRequestContext("POST", "/api/v1/profile_albums", nil, &auth.Claims{UserID: "u1"})
	data := map[string]interface{}{"name": "  Лучшее  "}
	if !srv.PrepareAlbumBody(c3, "profile_albums", "POST", data) {
		t.Fatal("expected acceptance for a valid name")
	}
	if data["name"] != "Лучшее" {
		t.Fatalf("expected trimmed name, got %v", data["name"])
	}
}

// ─── PrepareAlbumPostBody ───────────────────────────────────────────────────

func TestPrepareAlbumPostBody_NonPostPasses(t *testing.T) {
	srv, _ := setupService(t)
	c, _ := newRequestContext("DELETE", "/api/v1/profile_album_posts", nil, &auth.Claims{UserID: "u1"})
	if !srv.PrepareAlbumPostBody(c, "profile_album_posts", "DELETE", nil) {
		t.Fatal("expected DELETE to pass the POST-only guard")
	}
}

func TestPrepareAlbumPostBody_MissingFields(t *testing.T) {
	srv, _ := setupService(t)
	c, w := newRequestContext("POST", "/api/v1/profile_album_posts", nil, &auth.Claims{UserID: "u1"})
	if srv.PrepareAlbumPostBody(c, "profile_album_posts", "POST", map[string]interface{}{"album_id": "a"}) {
		t.Fatal("expected rejection when post_id is missing")
	}
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPrepareAlbumPostBody_AlbumNotFound(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("POST", "/api/v1/profile_album_posts", nil, &auth.Claims{UserID: "u1"})
	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-x").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}))
	if srv.PrepareAlbumPostBody(c, "profile_album_posts", "POST", map[string]interface{}{"album_id": "album-x", "post_id": "p1"}) {
		t.Fatal("expected rejection for missing album")
	}
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestPrepareAlbumPostBody_AlbumOfAnotherUser(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("POST", "/api/v1/profile_album_posts", nil, &auth.Claims{UserID: "u1"})
	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-x").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("other-user"))
	if srv.PrepareAlbumPostBody(c, "profile_album_posts", "POST", map[string]interface{}{"album_id": "album-x", "post_id": "p1"}) {
		t.Fatal("expected rejection for someone else's album")
	}
	if w.Code != 403 {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestPrepareAlbumPostBody_PostOnAnotherWall(t *testing.T) {
	srv, mock := setupService(t)
	c, w := newRequestContext("POST", "/api/v1/profile_album_posts", nil, &auth.Claims{UserID: "u1"})
	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-x").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("someone-else"))
	if srv.PrepareAlbumPostBody(c, "profile_album_posts", "POST", map[string]interface{}{"album_id": "album-x", "post_id": "p1"}) {
		t.Fatal("expected rejection for a post from another wall")
	}
	if w.Code != 403 {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestPrepareAlbumPostBody_HappyPath(t *testing.T) {
	srv, mock := setupService(t)
	c, _ := newRequestContext("POST", "/api/v1/profile_album_posts", nil, &auth.Claims{UserID: "u1"})
	mock.ExpectQuery(`SELECT user_id FROM profile_albums WHERE id = \$1`).
		WithArgs("album-x").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	if !srv.PrepareAlbumPostBody(c, "profile_album_posts", "POST", map[string]interface{}{"album_id": "album-x", "post_id": "p1"}) {
		t.Fatal("expected acceptance for own album + own wall post")
	}
}

func cursorOrNil(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}
