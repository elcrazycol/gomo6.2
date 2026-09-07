package moderation

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func setupHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
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

	return NewHandler(db, nil, nil), mock
}

func claimsFor(userID string) *auth.Claims {
	return &auth.Claims{UserID: userID, Username: "alice"}
}

// expectModerator stubs the moderator-role lookup.
func expectModerator(mock sqlmock.Sqlmock, isMod bool) {
	rows := sqlmock.NewRows([]string{"count"})
	if isMod {
		rows = rows.AddRow(1)
	} else {
		rows = rows.AddRow(0)
	}
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_roles WHERE user_id = \$1 AND role IN \('moderator', 'admin'\)`).
		WithArgs("u1").
		WillReturnRows(rows)
}

func newPOSTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(http.MethodPost, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

func newGETContext(url string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, url, nil)
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

func newDELETEContext(url string, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, url, nil)
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

func TestCreateReport_Success(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM profile_wall_posts WHERE id = \$1\)`).
		WithArgs("post-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`INSERT INTO content_reports .*ON CONFLICT .*RETURNING id, post_id, reporter_id, category, reason, status, created_at`).
		WithArgs("post-1", "u1", "spam", "Реклама казино").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "reporter_id", "category", "reason", "status", "created_at"}).
			AddRow("r-1", "post-1", "u1", "spam", "Реклама казино", "open", time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM content_reports WHERE post_id = \$1 AND status = 'open'`).
		WithArgs("post-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	c, w := newPOSTContext("/api/v1/moderation/reports",
		map[string]string{"post_id": "post-1", "category": "spam", "reason": "Реклама казино"},
		claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			ID         string `json:"id"`
			PostID     string `json:"post_id"`
			ReporterID string `json:"reporter_id"`
			Status     string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response JSON: %v", err)
	}
	if !resp.Success || resp.Data.ID != "r-1" || resp.Data.ReporterID != "u1" || resp.Data.Status != "open" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestCreateReport_DuplicateReturns409(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM profile_wall_posts WHERE id = \$1\)`).
		WithArgs("post-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`INSERT INTO content_reports`).
		WillReturnError(sql.ErrNoRows) // ON CONFLICT DO NOTHING → no row returned

	c, w := newPOSTContext("/api/v1/moderation/reports",
		map[string]string{"post_id": "post-1", "category": "spam", "reason": "Повторная жалоба"},
		claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestCreateReport_RejectsMissingPost(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM profile_wall_posts WHERE id = \$1\)`).
		WithArgs("nope").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/moderation/reports",
		map[string]string{"post_id": "nope", "category": "other", "reason": "Нет такого поста"},
		claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestCreateReport_RejectsEmptyReason(t *testing.T) {
	h, _ := setupHandler(t)

	c, w := newPOSTContext("/api/v1/moderation/reports",
		map[string]string{"post_id": "post-1", "category": "other", "reason": "   "},
		claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateReport_RequiresAuth(t *testing.T) {
	h, _ := setupHandler(t)

	c, w := newPOSTContext("/api/v1/moderation/reports",
		map[string]string{"post_id": "post-1", "category": "other", "reason": "текст"},
		nil, nil)
	h.CreateReport(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// postRow builds the enriched wall-post row the queue attaches to each group.
func postRow(id, ownerID string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "user_id", "author_id", "title", "content", "content_json", "image_url", "attachments",
		"repost_of_post_id", "created_at", "updated_at", "is_pinned", "pinned_order",
		"likes_count", "comments_count", "reposts_count", "views_count", "author",
	}).AddRow(
		id, ownerID, "author-1", "", "Спорный контент", []byte(`{}`), nil, nil,
		nil, time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC), time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC), false, nil,
		1, 2, 0, 3, []byte(`{"username":"bob","display_name":null,"nickname_emoji_id":null,"is_anonymous":false,"avatar_url":null}`),
	)
}

func TestListReports_GroupsAndSortsByCount(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	// Two reports on post-2 (2 open) and one on post-1 (1 open). The list query
	// returns them newest first: r3 (post-1), r2 (post-2), r1 (post-2).
	mock.ExpectQuery(`(?s).*FROM content_reports r.*WHERE EXISTS.*ORDER BY r.created_at DESC`).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "post_id", "reporter_id", "category", "reason", "status", "created_at",
			"username", "display_name", "avatar_url",
		}).
			AddRow("r3", "post-1", "u3", "abuse", "Оскорбление", "open", time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC), "carol", nil, nil).
			AddRow("r2", "post-2", "u2", "hate", "Ненависть", "open", time.Date(2026, 9, 2, 9, 0, 0, 0, time.UTC), "bob", nil, nil).
			AddRow("r1", "post-2", "u1", "spam", "Реклама", "open", time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC), "alice", nil, nil))

	// The post fetch happens per distinct group (post-1 then post-2 in first
	// encounter order).
	mock.ExpectQuery(`(?s)SELECT p.id.*FROM profile_wall_posts p.*WHERE p.id = \$1`).
		WithArgs("post-1").
		WillReturnRows(postRow("post-1", "owner-1"))
	mock.ExpectQuery(`(?s)SELECT p.id.*FROM profile_wall_posts p.*WHERE p.id = \$1`).
		WithArgs("post-2").
		WillReturnRows(postRow("post-2", "owner-2"))

	c, w := newGETContext("/api/v1/moderation/reports", claimsFor("u1"))
	h.ListReports(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool          `json:"success"`
		Data    []ReportGroup `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response JSON: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 groups, got %d", len(resp.Data))
	}
	// Sorted by open count desc: post-2 (2) first, post-1 (1) second.
	if resp.Data[0].Post["id"] != "post-2" || resp.Data[0].ReportCount != 2 {
		t.Fatalf("expected post-2 with 2 reports first, got %+v", resp.Data[0])
	}
	if resp.Data[1].Post["id"] != "post-1" || resp.Data[1].ReportCount != 1 {
		t.Fatalf("expected post-1 with 1 report second, got %+v", resp.Data[1])
	}
	if len(resp.Data[0].Reports) != 2 {
		t.Fatalf("expected 2 reports under post-2, got %d", len(resp.Data[0].Reports))
	}
}

func TestListReports_RejectsNonModerator(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, false)

	c, w := newGETContext("/api/v1/moderation/reports", claimsFor("u1"))
	h.ListReports(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestResolvePostReports_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM profile_wall_posts WHERE id = \$1\)`).
		WithArgs("post-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`UPDATE content_reports SET status = 'resolved' WHERE post_id = \$1 AND status = 'open'`).
		WithArgs("post-1").
		WillReturnResult(sqlmock.NewResult(0, 2))

	c, w := newPOSTContext("/api/v1/moderation/posts/post-1/resolve", nil, claimsFor("u1"), map[string]string{"postId": "post-1"})
	h.ResolvePostReports(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeletePost_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post-1").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("owner-1"))
	mock.ExpectExec(`DELETE FROM profile_wall_posts WHERE id = \$1`).
		WithArgs("post-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newDELETEContext("/api/v1/moderation/posts/post-1", claimsFor("u1"), map[string]string{"postId": "post-1"})
	h.DeletePost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeletePost_RejectsNonModerator(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, false)

	c, w := newDELETEContext("/api/v1/moderation/posts/post-1", claimsFor("u1"), map[string]string{"postId": "post-1"})
	h.DeletePost(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}
