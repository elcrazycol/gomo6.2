package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// setupFeedHandler creates a FeedHandler with a mock DB.
func setupFeedHandler(t *testing.T) (*FeedHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	return NewFeedHandler(db), mock
}

func feedColumnNames() []string {
	return []string{
		"item_type", "item_id", "score", "created_at", "updated_at",
		"title", "content", "content_json", "image_url", "image_urls", "attachments",
		"tags", "post_count",
		"author_id", "author_username", "author_display_name", "author_nickname_emoji_id",
		"author_is_anonymous", "author_avatar_url",
		"board_id", "board_slug", "board_name", "board_is_gomosub",
		"wall_user_id",
		"likes_count", "comments_count", "reposts_count", "liked_by_viewer", "views_count",
	}
}

// TestGetUserFeed_AuthenticatedWithThreadAndWall verifies a logged-in viewer
// receives a mixed feed: one thread item and one wall post item, with the
// viewer's user id passed to the SQL function.
func TestGetUserFeed_AuthenticatedWithThreadAndWall(t *testing.T) {
	handler, mock := setupFeedHandler(t)

	now := time.Now()
	claims := &auth.Claims{UserID: "viewer-1", Username: "viewer"}
	c, w := newGETContextWithClaims("/api/v1/feed", map[string]string{"limit": "20", "offset": "0"}, claims)

	rows := sqlmock.NewRows(feedColumnNames()).
		AddRow(
			"thread", "thread-1", 12.345, now, now,
			"Hello", "World", `{"type":"doc"}`, "img1", `["img1"]`, nil,
			`{"content":"games"}`, 3,
			"author-1", "alice", "Alice", nil, false, "avatar1",
			"board-1", "b", "Board", false,
			nil,
			5, 3, 0, true, 42,
		).
		AddRow(
			"wall_post", "post-1", 8.5, now, now,
			"Wall title", "Wall content", nil, "img2", nil, `[{"url":"img2","type":"image"}]`,
			nil, nil,
			"author-2", "bob", "Bob", nil, false, "avatar2",
			nil, nil, nil, false,
			"wall-owner-2",
			2, 1, 0, false, 7,
		)

	mock.ExpectQuery(`SELECT item_type, item_id.*FROM get_user_feed\(\$1, \$2, \$3\)`).
		WithArgs("viewer-1", 20, 0).
		WillReturnRows(rows)

	handler.GetUserFeed(c)

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

	items, ok := resp.Data.([]interface{})
	if !ok {
		t.Fatalf("expected data to be an array, got %T", resp.Data)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}

	first := items[0].(map[string]interface{})
	if first["item_type"] != "thread" {
		t.Fatalf("expected first item to be a thread, got %v", first["item_type"])
	}
	if first["item_id"] != "thread-1" {
		t.Fatalf("expected item_id thread-1, got %v", first["item_id"])
	}
	// Likes are embedded — the frontend must not fire a second batch request.
	if first["likes_count"] != float64(5) {
		t.Fatalf("expected likes_count 5, got %v", first["likes_count"])
	}
	if first["liked_by_viewer"] != true {
		t.Fatalf("expected liked_by_viewer true, got %v", first["liked_by_viewer"])
	}
	author := first["author"].(map[string]interface{})
	if author["username"] != "alice" {
		t.Fatalf("expected author alice, got %v", author["username"])
	}
	board := first["boards"].(map[string]interface{})
	if board["slug"] != "b" {
		t.Fatalf("expected board slug b, got %v", board["slug"])
	}

	second := items[1].(map[string]interface{})
	if second["item_type"] != "wall_post" {
		t.Fatalf("expected second item to be a wall post, got %v", second["item_type"])
	}
	if second["wall_user_id"] != "wall-owner-2" {
		t.Fatalf("expected wall_user_id wall-owner-2, got %v", second["wall_user_id"])
	}
}

// TestGetUserFeed_AnonymousPassesNull verifies anonymous callers pass a NULL
// user id to the SQL function (global stream) and still get a 200.
func TestGetUserFeed_AnonymousPassesNull(t *testing.T) {
	handler, mock := setupFeedHandler(t)

	c, w := newGETContext("/api/v1/feed", map[string]string{"limit": "10", "offset": "0"})

	rows := sqlmock.NewRows(feedColumnNames()).
		AddRow(
			"thread", "thread-9", 4.2, time.Now(), time.Now(),
			"Popular", "Content", nil, nil, nil, nil,
			nil, 1,
			"author-9", "anon-user", nil, nil, false, nil,
			"board-2", "g", "Gsub", true,
			nil,
			9, 1, 0, false, 13,
		)

	mock.ExpectQuery(`SELECT item_type, item_id.*FROM get_user_feed\(\$1, \$2, \$3\)`).
		WithArgs(nil, 10, 0).
		WillReturnRows(rows)

	handler.GetUserFeed(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// TestGetUserFeed_DBError verifies a query failure returns a 500.
func TestGetUserFeed_DBError(t *testing.T) {
	handler, mock := setupFeedHandler(t)

	c, w := newGETContext("/api/v1/feed", nil)

	mock.ExpectQuery(`SELECT item_type, item_id.*FROM get_user_feed\(\$1, \$2, \$3\)`).
		WithArgs(nil, 20, 0).
		WillReturnError(sqlmock.ErrCancelled)

	handler.GetUserFeed(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
