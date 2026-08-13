package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"database/sql"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ──────────────────────────── GetPosts ────────────────────────────

func TestGetPosts_Success_NoFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", nil)

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	).AddRow(
		"p2", "t1", "u2", "World!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"user2", nil, nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*ORDER BY p\.created_at ASC.*LIMIT \$[0-9]+ OFFSET \$[0-9]+`).
		WithArgs("", "", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetPosts_Success_WithThreadFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", map[string]string{
		"thread_id": "eq.550e8400-e29b-41d4-a716-446655440000",
	})

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "550e8400-e29b-41d4-a716-446655440000", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.thread_id = \$1.*ORDER BY p\.created_at ASC.*LIMIT \$[0-9]+ OFFSET \$[0-9]+`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", "", "", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetPosts_Success_WithIDFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", map[string]string{
		"id": "eq.p1",
	})

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*ORDER BY p\.created_at ASC.*LIMIT \$[0-9]+ OFFSET \$[0-9]+`).
		WithArgs("p1", "", "", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetPosts_Success_WithInFilter(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", map[string]string{
		"id": "in.(p1,p2)",
	})

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id IN \(\$1,\$2\).*ORDER BY p\.created_at ASC.*LIMIT \$[0-9]+ OFFSET \$[0-9]+`).
		WithArgs("p1", "p2", "", "", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetPosts_DBError(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", nil)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*`).
		WithArgs("", "", 100, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetPosts(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// TestGetPosts_PrivateBoard_AnonymousEmpty pins the H1 board-visibility gate
// on the list path: an anonymous thread_id=eq. query against a private board
// must carry the join + `b.visibility != 'private'` predicate (the audit PoC
// was `/api/v1/posts?thread_id=eq.<private-thread>` returning content).
func TestGetPosts_PrivateBoard_AnonymousEmpty(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", map[string]string{
		"thread_id": "eq.t1",
	})

	// Anonymous → predicate collapses to `b.visibility != 'private'`, no extra
	// args beyond the privacy gate ("", "") + limit/offset.
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*LEFT JOIN threads t ON p\.thread_id = t\.id.*LEFT JOIN boards b ON t\.board_id = b\.id.*WHERE p\.thread_id = \$1.*b\.visibility != 'private'.*t\.channel_id IS NULL.*LIMIT \$[0-9]+ OFFSET \$[0-9]+`).
		WithArgs("t1", "", "", 100, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "thread_id", "user_id", "content", "content_json",
			"image_url", "image_urls", "attachments", "reply_to",
			"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
			"username", "nickname_emoji_id", "avatar_url",
		}))

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	// A nil Data slice encodes as null — an empty result is the expected outcome.
	if resp.Count != nil && *resp.Count != 0 {
		t.Fatalf("expected 0 posts for anonymous private-board query, got count %d", *resp.Count)
	}
	if resp.Data != nil {
		t.Fatalf("expected empty result set for anonymous private-board query, got %v", resp.Data)
	}
}

// TestGetPosts_PrivateBoard_MemberVisible pins the authenticated branch: a
// gomosub member (or board owner) still sees posts from the private board —
// the predicate must NOT over-filter legitimate members.
func TestGetPosts_PrivateBoard_MemberVisible(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	claims := &auth.Claims{UserID: "member", Username: "member"}
	c, w := newGETContextWithClaims("/api/v1/posts", map[string]string{
		"thread_id": "eq.t1",
	}, claims)

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Member-visible post", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	)

	// Authenticated → the predicate references b.owner_id + gomosub_memberships,
	// with the viewer bound twice (args: thread, privacy x2, visibility x2).
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*LEFT JOIN boards b ON t\.board_id = b\.id.*WHERE p\.thread_id = \$1.*b\.visibility != 'private'.*gomosub_memberships gm WHERE gm\.board_id = t\.board_id AND gm\.user_id::text = \$5.*LIMIT \$[0-9]+ OFFSET \$[0-9]+`).
		WithArgs("t1", "member", "member", "member", "member", 100, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Count == nil || *resp.Count != 1 {
		t.Fatalf("expected count 1, got %v", resp.Count)
	}
}

func TestGetPosts_Latest_RequiresThreadFilter(t *testing.T) {
	handler, _ := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", map[string]string{
		"latest": "true",
	})

	handler.GetPosts(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for latest=true without thread filter, got %d", w.Code)
	}
}

func TestGetPosts_Latest_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts", map[string]string{
		"thread_id": "in.(t1,t2)",
		"latest":    "true",
	})

	rows := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Latest in t1", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	).AddRow(
		"p2", "t2", "u2", "Latest in t2", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"user2", nil, nil,
	)

	// The DISTINCT ON subquery regex must match the generated SQL — including
	// the H1 board/channel visibility JOINs and predicates in the subquery.
	mock.ExpectQuery(`SELECT \* FROM \(SELECT DISTINCT ON \(p\.thread_id\).*FROM posts p.*LEFT JOIN threads t ON p\.thread_id = t\.id.*WHERE p\.thread_id IN \(\$1,\$2\).*ORDER BY p\.thread_id, p\.created_at DESC\) sub ORDER BY sub\.created_at DESC LIMIT \$[0-9]+ OFFSET \$[0-9]+`).
		WithArgs("t1", "t2", "", "", 200, 0).
		WillReturnRows(rows)

	handler.GetPosts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
	if resp.Count == nil || *resp.Count != 2 {
		t.Fatalf("expected count 2, got %v", resp.Count)
	}
}

// ──────────────────────────── GetPost ────────────────────────────

func TestGetPost_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	row := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "Hello!", nil,
		nil, "[]", "[]", nil, false, nil, "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	)

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*COALESCE\(p\.is_private`).
		WithArgs("p1", "").
		WillReturnRows(row)

	handler.GetPost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetPost_NotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*COALESCE\(p\.is_private`).
		WithArgs("p1", "").
		WillReturnError(sql.ErrNoRows)

	handler.GetPost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetPost_PrivatePost_AnonymousNotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	// Anonymous viewer: the WHERE predicate filters the private post out → 404.
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*COALESCE\(p\.is_private`).
		WithArgs("p1", "").
		WillReturnError(sql.ErrNoRows)

	handler.GetPost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for anonymous reading a private post, got %d", w.Code)
	}
}

func TestGetPost_PrivatePost_StrangerNotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	claims := &auth.Claims{UserID: "u3", Username: "stranger"}
	c, w := newGETContextWithClaims("/api/v1/posts/p1", nil, claims)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	// Non-participant: the WHERE predicate filters the private post out → 404.
	// The third arg is the viewer bound to the board/channel visibility gate
	// (H1: private boards/channels must hide posts from non-members).
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*COALESCE\(p\.is_private`).
		WithArgs("p1", "u3", "u3").
		WillReturnError(sql.ErrNoRows)

	handler.GetPost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for stranger reading a private post, got %d", w.Code)
	}
}

// TestGetPost_PrivateBoard_StrangerNotFound pins the H1 board-visibility gate
// on the single-post read: a stranger requesting a post whose thread sits on a
// private board must get 404 — the WHERE clause joins threads/boards/channels
// and filters the row out, exactly like threads.go GetThread does.
func TestGetPost_PrivateBoard_StrangerNotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	claims := &auth.Claims{UserID: "stranger", Username: "stranger"}
	c, w := newGETContextWithClaims("/api/v1/posts/p1", nil, claims)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	// The query must join the thread's board and gate it: for a non-member the
	// row is filtered out → 404. The regex pins the join + visibility predicate
	// so the SQL cannot silently drop the gate.
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*LEFT JOIN threads t ON p\.thread_id = t\.id.*LEFT JOIN boards b ON t\.board_id = b\.id.*WHERE p\.id = \$1.*b\.visibility != 'private'.*gomosub_memberships gm WHERE gm\.board_id = t\.board_id`).
		WithArgs("p1", "stranger", "stranger").
		WillReturnError(sql.ErrNoRows)

	handler.GetPost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for stranger reading a private-board post, got %d", w.Code)
	}
}

// TestGetPost_PrivateBoard_AnonymousNotFound pins the anonymous branch: a guest
// must never read a post from a private board via its UUID (H1).
func TestGetPost_PrivateBoard_AnonymousNotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	// Anonymous → the predicate collapses to `b.visibility != 'private'` with
	// no extra args; a private-board row is filtered out → 404.
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*LEFT JOIN threads t ON p\.thread_id = t\.id.*LEFT JOIN boards b ON t\.board_id = b\.id.*WHERE p\.id = \$1.*b\.visibility != 'private'.*t\.channel_id IS NULL`).
		WithArgs("p1", "").
		WillReturnError(sql.ErrNoRows)

	handler.GetPost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for anonymous reading a private-board post, got %d", w.Code)
	}
}

// TestGetPost_PrivateChannel_AnonymousNotFound pins the H1 channel gate: a post
// whose thread lives in a private channel must be hidden from guests even when
// the board itself is public.
func TestGetPost_PrivateChannel_AnonymousNotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	// Anonymous → channel predicate requires a non-private channel.
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*LEFT JOIN threads t ON p\.thread_id = t\.id.*LEFT JOIN channels ch ON t\.channel_id = ch\.id.*WHERE p\.id = \$1.*t\.channel_id IS NULL OR COALESCE\(ch\.is_private, false\) = false`).
		WithArgs("p1", "").
		WillReturnError(sql.ErrNoRows)

	handler.GetPost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for anonymous reading a private-channel post, got %d", w.Code)
	}
}

func TestGetPost_PrivatePost_RecipientSuccess(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	claims := &auth.Claims{UserID: "u2", Username: "recipient"}
	c, w := newGETContextWithClaims("/api/v1/posts/p1", nil, claims)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	row := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "attachments", "reply_to",
		"is_private", "private_recipient_id", "server_domain", "created_at", "is_remote",
		"username", "nickname_emoji_id", "avatar_url",
	}).AddRow(
		"p1", "t1", "u1", "DM content", nil,
		nil, "[]", "[]", nil, true, "u2", "localhost:8080", time.Now(), false,
		"testuser", nil, nil,
	)

	// The private recipient sees the DM. The third arg binds the viewer to the
	// board/channel visibility gate (H1).
	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*COALESCE\(p\.is_private`).
		WithArgs("p1", "u2", "u2").
		WillReturnRows(row)

	handler.GetPost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for the private recipient, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestGetPost_DBError(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newGETContext("/api/v1/posts/p1", nil)
	c.Params = []gin.Param{{Key: "id", Value: "p1"}}

	mock.ExpectQuery(`SELECT p\.id.*FROM posts p.*WHERE p\.id = \$1.*COALESCE\(p\.is_private`).
		WithArgs("p1", "").
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetPost(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ──────────────────────────── DeletePost ────────────────────────────

func TestDeletePost_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	// The author (u1) deletes their own post — no moderation-role check fires.
	c, w := newDELETEPContextWithClaims("/api/v1/posts", nil, map[string]string{"id": "p1"}, &auth.Claims{UserID: "u1", Username: "author"})

	// Get author and thread
	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "thread_id"}).AddRow("u1", "t1"))

	// Delete
	mock.ExpectExec(`DELETE FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Update thread post_count
	mock.ExpectExec(`UPDATE threads SET post_count.*WHERE id = \$1`).
		WithArgs("t1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.DeletePost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestDeletePost_NotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newDELETEPContextWithClaims("/api/v1/posts", nil, map[string]string{"id": "p1"}, &auth.Claims{UserID: "u1"})

	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnError(sql.ErrNoRows)

	handler.DeletePost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeletePost_EmptyID(t *testing.T) {
	handler, _ := setupPostsHandler(t)
	// No id in path and no id in query
	c, w := newDELETEPContext("/api/v1/posts", nil, nil)

	handler.DeletePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── H1: delete ownership (IDOR fix) ────────────────────────────────────────

// TestDeletePost_ForeignAuthor_Forbidden proves a stranger cannot delete
// another user's post: the moderation-role check returns zero rows, so the
// handler must 403 BEFORE issuing the DELETE (sqlmock would fail the test on
// any unexpected DELETE).
func TestDeletePost_ForeignAuthor_Forbidden(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	// u2 (attacker) targets a post authored by u1.
	c, w := newDELETEPContextWithClaims("/api/v1/posts", nil, map[string]string{"id": "p1"}, &auth.Claims{UserID: "u2", Username: "attacker"})

	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "thread_id"}).AddRow("u1", "t1"))

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_roles WHERE user_id = \$1 AND role IN \(.*\)`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	handler.DeletePost(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// TestDeletePost_ModeratorAllowed verifies the moderation flow still works: a
// user holding the moderator role may delete a foreign post through the same
// endpoint the moderation UI uses.
func TestDeletePost_ModeratorAllowed(t *testing.T) {
	handler, mock := setupPostsHandler(t)
	c, w := newDELETEPContextWithClaims("/api/v1/posts", nil, map[string]string{"id": "p1"}, &auth.Claims{UserID: "u2", Username: "mod"})

	mock.ExpectQuery(`SELECT user_id, thread_id FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "thread_id"}).AddRow("u1", "t1"))

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_roles WHERE user_id = \$1 AND role IN \(.*\)`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectExec(`DELETE FROM posts WHERE id = \$1`).
		WithArgs("p1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectExec(`UPDATE threads SET post_count.*WHERE id = \$1`).
		WithArgs("t1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.DeletePost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeletePost_NotAuthenticated(t *testing.T) {
	handler, _ := setupPostsHandler(t)
	// No claims on the context — the handler must 401 before any DB access.
	c, w := newDELETEPContext("/api/v1/posts", nil, map[string]string{"id": "p1"})

	handler.DeletePost(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

// ──────────────────────────── UpdatePost ────────────────────────────

func TestUpdatePost_Success(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}

	// UpdatePost reads id from path param and also parses UUID; use a valid UUID.
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/api/v1/posts/"+postID, body, claims, map[string]string{"id": postID})

	// Check ownership
	mock.ExpectQuery(`SELECT user_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	// Update
	updateRow := sqlmock.NewRows([]string{
		"id", "thread_id", "user_id", "content", "content_json",
		"image_url", "image_urls", "reply_to", "is_private",
		"private_recipient_id", "server_domain", "created_at", "is_remote",
	}).AddRow(
		postID, "t1", "u1", "Updated content!", nil,
		nil, "[]", nil, false, nil, "localhost:8080", time.Now(), false,
	)

	mock.ExpectQuery(`UPDATE posts SET content.*WHERE id = \$[0-9]+.*RETURNING`).
		WithArgs("Updated content!", nil, postID).
		WillReturnRows(updateRow)

	handler.UpdatePost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestUpdatePost_NotFound(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/api/v1/posts/"+postID, body, claims, map[string]string{"id": postID})

	mock.ExpectQuery(`SELECT user_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnError(sql.ErrNoRows)

	handler.UpdatePost(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdatePost_Forbidden(t *testing.T) {
	handler, mock := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u2", Username: "otheruser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	postID := "550e8400-e29b-41d4-a716-446655440000"
	c, w := newPUTContext("/api/v1/posts/"+postID, body, claims, map[string]string{"id": postID})

	mock.ExpectQuery(`SELECT user_id FROM posts WHERE id = \$1`).
		WithArgs(postID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	handler.UpdatePost(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestUpdatePost_InvalidID(t *testing.T) {
	handler, _ := setupPostsHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]interface{}{
		"content": "Updated content!",
	}
	c, w := newPUTContext("/api/v1/posts/not-a-uuid", body, claims, map[string]string{"id": "not-a-uuid"})

	handler.UpdatePost(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
