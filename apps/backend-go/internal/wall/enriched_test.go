package wall

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// setupService creates a wall Service with a mock DB (redis/hub/notif nil, so
// every optional interaction is skipped).
func setupService(t *testing.T) (*Service, sqlmock.Sqlmock) {
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
	return New(db, nil, nil, nil), mock
}

// newRequestContext creates a gin context for Service with the given method,
// path, body and claims.
func newRequestContext(method, path string, body interface{}, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")

	// Parse query params from path
	if parts := strings.SplitN(path, "?", 2); len(parts) == 2 {
		req.URL.RawQuery = parts[1]
	}

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}

// ─── TryRespondEnriched ──────────────────────────────────────────────────────

func TestTryRespondEnriched_NonWallTable(t *testing.T) {
	srv, _ := setupService(t)

	c, _ := newRequestContext("GET", "/api/v1/some_other_table", nil, nil)
	result := map[string]interface{}{"id": "123"}
	enriched := srv.TryRespondEnriched(c, "some_other_table", result)

	if enriched {
		t.Fatal("expected false for non-wall table")
	}
}

func TestTryRespondEnriched_MissingID(t *testing.T) {
	srv, _ := setupService(t)

	c, _ := newRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"title": "no id here"}
	enriched := srv.TryRespondEnriched(c, "profile_wall_posts", result)

	if enriched {
		t.Fatal("expected false when id is missing from result")
	}
}

func TestTryRespondEnriched_PostDBError(t *testing.T) {
	srv, mock := setupService(t)

	c, w := newRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"id": "post123"}

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post123", "viewer").
		WillReturnError(sqlmock.ErrCancelled)

	enriched := srv.TryRespondEnriched(c, "profile_wall_posts", result)

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

func TestTryRespondEnriched_PostSuccess(t *testing.T) {
	srv, mock := setupService(t)

	c, w := newRequestContext("GET", "/api/v1/profile_wall_posts", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"id": "post123"}

	authorJSON := `{"username": "testuser", "avatar_url": null}`
	rows := sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments", "repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
		AddRow("post123", "u1", "u1", "Hello!", "World", nil, nil, nil, nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, authorJSON)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*WHERE p\.id = \$1`).
		WithArgs("post123", "viewer").
		WillReturnRows(rows)

	enriched := srv.TryRespondEnriched(c, "profile_wall_posts", result)

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

func TestTryRespondEnriched_CommentSuccess(t *testing.T) {
	srv, mock := setupService(t)

	c, w := newRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, &auth.Claims{UserID: "viewer"})
	result := map[string]interface{}{"id": "comm123"}

	authorJSON := `{"username": "commenter", "is_anonymous": true}`
	rows := sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "content_json", "created_at", "updated_at", "author"}).
		AddRow("comm123", "post1", "u2", "Nice post!", nil, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", authorJSON)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*WHERE c\.id = \$1`).
		WithArgs("comm123", "viewer").
		WillReturnRows(rows)

	enriched := srv.TryRespondEnriched(c, "profile_wall_post_comments", result)

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
