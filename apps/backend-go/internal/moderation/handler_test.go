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

const (
	reportUUID = "550e8400-e29b-41d4-a716-446655440000"
	targetUUID = "660e8400-e29b-41d4-a716-446655440000"
	threadUUID = "770e8400-e29b-41d4-a716-446655440000"
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

// expectModerationRead stubs the helper|moderator|admin lookup used by the
// READ endpoints (queue, user card, activity, stats, audit).
func expectModerationRead(mock sqlmock.Sqlmock, allowed bool) {
	mock.ExpectQuery(`SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role IN \('helper', 'moderator', 'admin'\)\)`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(allowed))
}

// expectModerator stubs the moderator-role lookup.
func expectModerator(mock sqlmock.Sqlmock, isMod bool) {
	mock.ExpectQuery(`SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role IN \('moderator', 'admin'\)\)`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(isMod))
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

// ──────────────────────────── CreateReport ────────────────────────────

func TestCreateReport_PolymorphicTarget(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadUUID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`INSERT INTO content_reports`).
		WithArgs(TargetThread, threadUUID, nil, "u1", "spam", "Реклама казино").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_type", "target_id", "reporter_id", "category", "reason", "status", "created_at",
		}).AddRow(reportUUID, TargetThread, threadUUID, "u1", "spam", "Реклама казино", "open",
			time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM content_reports WHERE target_type = \$1 AND target_id = \$2 AND status = 'open'`).
		WithArgs(TargetThread, threadUUID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	c, w := newPOSTContext("/api/v1/moderation/reports", map[string]string{
		"target_type": TargetThread, "target_id": threadUUID, "category": "spam", "reason": "Реклама казино",
	}, claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			ID         string `json:"id"`
			TargetType string `json:"target_type"`
			TargetID   string `json:"target_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response JSON: %v", err)
	}
	if !resp.Success || resp.Data.TargetType != TargetThread || resp.Data.TargetID != threadUUID {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

// The legacy {post_id} shape keeps working and normalises to wall_post.
func TestCreateReport_LegacyPostID(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM profile_wall_posts WHERE id = \$1\)`).
		WithArgs(targetUUID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`INSERT INTO content_reports`).
		WithArgs(TargetWallPost, targetUUID, targetUUID, "u1", "abuse", "Оскорбление").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_type", "target_id", "reporter_id", "category", "reason", "status", "created_at",
		}).AddRow(reportUUID, TargetWallPost, targetUUID, "u1", "abuse", "Оскорбление", "open", time.Now()))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM content_reports WHERE target_type = \$1 AND target_id = \$2 AND status = 'open'`).
		WithArgs(TargetWallPost, targetUUID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	c, w := newPOSTContext("/api/v1/moderation/reports",
		map[string]string{"post_id": targetUUID, "category": "abuse", "reason": "Оскорбление"},
		claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestCreateReport_DuplicateReturns409(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadUUID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`INSERT INTO content_reports`).WillReturnError(sql.ErrNoRows) // ON CONFLICT DO NOTHING

	c, w := newPOSTContext("/api/v1/moderation/reports", map[string]string{
		"target_type": TargetThread, "target_id": threadUUID, "category": "spam", "reason": "Повторная жалоба",
	}, claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestCreateReport_RejectsInvalidTargetType(t *testing.T) {
	h, _ := setupHandler(t)

	c, w := newPOSTContext("/api/v1/moderation/reports", map[string]string{
		"target_type": "dm", "target_id": threadUUID, "category": "spam", "reason": "текст",
	}, claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateReport_RejectsMissingTarget(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadUUID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/moderation/reports", map[string]string{
		"target_type": TargetThread, "target_id": threadUUID, "category": "other", "reason": "Нет такого треда",
	}, claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestCreateReport_RejectsEmptyReason(t *testing.T) {
	h, _ := setupHandler(t)

	c, w := newPOSTContext("/api/v1/moderation/reports", map[string]string{
		"target_type": TargetThread, "target_id": threadUUID, "category": "other", "reason": "   ",
	}, claimsFor("u1"), nil)
	h.CreateReport(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateReport_RequiresAuth(t *testing.T) {
	h, _ := setupHandler(t)

	c, w := newPOSTContext("/api/v1/moderation/reports", map[string]string{
		"target_type": TargetThread, "target_id": threadUUID, "category": "other", "reason": "текст",
	}, nil, nil)
	h.CreateReport(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ──────────────────────────── ListReports (queue) ────────────────────────────

func TestListReports_GroupsAndSortsByCount(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, true)

	// total groups
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM \(SELECT 1 FROM content_reports`).
		WithArgs("", "").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	// page of groups: thread-2 has 2 open, thread-1 has 1.
	mock.ExpectQuery(`(?s)SELECT target_type, target_id::text,.*GROUP BY target_type, target_id.*ORDER BY open_count DESC`).
		WithArgs("", "", 50, 0).
		WillReturnRows(sqlmock.NewRows([]string{"target_type", "target_id", "open_count", "total_count", "last_at"}).
			AddRow(TargetThread, threadUUID, 2, 2, time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)).
			AddRow(TargetWallPost, targetUUID, 1, 1, time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)))
	// reports for the page targets (batched)
	mock.ExpectQuery(`(?s)FROM content_reports r.*unnest\(\$1::text\[\], \$2::uuid\[\]\)`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_type", "target_id", "reporter_id", "category", "reason", "status",
			"created_at", "reason_code", "resolution_note", "username", "display_name", "avatar_url", "source",
		}).
			AddRow("r1", TargetThread, threadUUID, "u2", "hate", "Ненависть", "open", time.Now(), nil, nil, "bob", nil, nil, "user").
			AddRow("r2", TargetThread, threadUUID, "u3", "spam", "Реклама", "open", time.Now(), nil, nil, "carol", nil, nil, "user").
			AddRow("r3", TargetWallPost, targetUUID, "u4", "abuse", "Оскорбление", "open", time.Now(), nil, nil, "dave", nil, nil, "user"))
	// one preview query per target type present (threads, then wall posts)
	mock.ExpectQuery(`SELECT t\.id::text, COALESCE\(t\.title, ''\).*FROM threads t`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "author", "author_id", "created_at", "ctx1", "ctx2"}).
			AddRow(threadUUID, "Спорный тред", "текст", "bob", "author-1", time.Now(), nil, nil))
	mock.ExpectQuery(`SELECT p\.id::text, COALESCE\(p\.title, ''\).*FROM profile_wall_posts p`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "author", "author_id", "created_at", "ctx1", "ctx2"}).
			AddRow(targetUUID, "", "Спорная запись", "dave", "author-2", time.Now(), "owner-9", nil))

	c, w := newGETContext("/api/v1/moderation/reports", claimsFor("u1"))
	h.ListReports(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Items  []ReportGroup `json:"items"`
			Total  int           `json:"total"`
			Limit  int           `json:"limit"`
			Offset int           `json:"offset"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response JSON: %v", err)
	}
	if resp.Data.Total != 2 || len(resp.Data.Items) != 2 {
		t.Fatalf("expected 2 groups, got %+v", resp.Data)
	}
	if resp.Data.Items[0].Target.Type != TargetThread || resp.Data.Items[0].OpenCount != 2 {
		t.Fatalf("expected the 2-report thread first, got %+v", resp.Data.Items[0])
	}
	if !resp.Data.Items[0].Target.Exists || resp.Data.Items[0].Target.Title != "Спорный тред" {
		t.Fatalf("expected the thread preview attached, got %+v", resp.Data.Items[0].Target)
	}
	if resp.Data.Items[0].Target.Link != "/thread/"+threadUUID {
		t.Fatalf("expected the thread link, got %q", resp.Data.Items[0].Target.Link)
	}
	if resp.Data.Items[1].Target.Link != "/profile/owner-9/wall/"+targetUUID {
		t.Fatalf("expected the wall-post link, got %q", resp.Data.Items[1].Target.Link)
	}
	if len(resp.Data.Items[0].Reports) != 2 {
		t.Fatalf("expected 2 reports on the first group, got %d", len(resp.Data.Items[0].Reports))
	}
}

func TestListReports_RejectsNonModerator(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, false)

	c, w := newGETContext("/api/v1/moderation/reports", claimsFor("u1"))
	h.ListReports(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// ──────────────────────────── Triage ────────────────────────────

func TestResolveReport_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE content_reports.*RETURNING target_type, target_id::text`).
		WithArgs("resolved", "", "", "u1", reportUUID).
		WillReturnRows(sqlmock.NewRows([]string{"target_type", "target_id", "reporter_id"}).AddRow(TargetThread, threadUUID, nil))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "resolved", TargetThread, threadUUID, reportUUID, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/reports/"+reportUUID+"/resolve", nil, claimsFor("u1"),
		map[string]string{"id": reportUUID})
	h.ResolveReport(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestRejectReport_WithNote(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE content_reports.*RETURNING target_type, target_id::text`).
		WithArgs("rejected", "invalid", "не нарушение", "u1", reportUUID).
		WillReturnRows(sqlmock.NewRows([]string{"target_type", "target_id", "reporter_id"}).AddRow(TargetWallPost, targetUUID, nil))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "rejected", TargetWallPost, targetUUID, reportUUID, "invalid", "не нарушение").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/reports/"+reportUUID+"/reject",
		map[string]string{"reason_code": "invalid", "note": "не нарушение"}, claimsFor("u1"),
		map[string]string{"id": reportUUID})
	h.RejectReport(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestResolveTargetReports_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE content_reports.*WHERE target_type = \$1 AND target_id = \$2 AND status = 'open'`).
		WithArgs(TargetThread, threadUUID, "", "", "u1").
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "resolve_target", TargetThread, threadUUID, nil, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/targets/"+TargetThread+"/"+threadUUID+"/resolve", nil, claimsFor("u1"),
		map[string]string{"targetType": TargetThread, "targetId": threadUUID})
	h.ResolveTargetReports(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestResolveTargetReports_RejectsInvalidType(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	c, w := newPOSTContext("/api/v1/moderation/targets/dm/"+threadUUID+"/resolve", nil, claimsFor("u1"),
		map[string]string{"targetType": "dm", "targetId": threadUUID})
	h.ResolveTargetReports(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ──────────────────────────── DeletePost ────────────────────────────

func TestDeletePost_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT user_id FROM profile_wall_posts WHERE id = \$1`).
		WithArgs(targetUUID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("owner-1"))
	mock.ExpectExec(`DELETE FROM profile_wall_posts WHERE id = \$1`).
		WithArgs(targetUUID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM content_reports WHERE target_type = \$1 AND target_id = \$2`).
		WithArgs(TargetWallPost, targetUUID).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "delete_content", TargetWallPost, targetUUID, nil, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newDELETEContext("/api/v1/moderation/posts/"+targetUUID, claimsFor("u1"),
		map[string]string{"postId": targetUUID})
	h.DeletePost(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeletePost_RejectsNonModerator(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, false)

	c, w := newDELETEContext("/api/v1/moderation/posts/"+targetUUID, claimsFor("u1"),
		map[string]string{"postId": targetUUID})
	h.DeletePost(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestQueueHavingClause(t *testing.T) {
	cases := map[string]string{
		"":         `COUNT(*) FILTER (WHERE status = 'open') > 0`,
		"open":     `COUNT(*) FILTER (WHERE status = 'open') > 0`,
		"resolved": `COUNT(*) FILTER (WHERE status = 'resolved') > 0`,
		"rejected": `COUNT(*) FILTER (WHERE status = 'rejected') > 0`,
		"all":      `TRUE`,
		"bogus":    `COUNT(*) FILTER (WHERE status = 'open') > 0`,
	}
	for in, want := range cases {
		if got := queueHavingClause(in); got != want {
			t.Errorf("queueHavingClause(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildTargetLink(t *testing.T) {
	cases := []struct {
		typ, id, ctx1, ctx2, want string
	}{
		{TargetWallPost, "p1", "owner1", "", "/profile/owner1/wall/p1"},
		{TargetWallComment, "c1", "owner1", "p1", "/profile/owner1/wall/p1"},
		{TargetThread, "t1", "", "", "/thread/t1"},
		{TargetPost, "p2", "t1", "", "/thread/t1"},
		{TargetUser, "u1", "", "", "/profile/u1"},
		{TargetGomosub, "b1", "my-sub", "", "/g/my-sub"},
		{TargetGomosub, "b1", "", "", ""}, // no slug → no link
		{"unknown", "x", "y", "z", ""},
	}
	for _, c := range cases {
		if got := buildTargetLink(c.typ, c.id, c.ctx1, c.ctx2); got != c.want {
			t.Errorf("buildTargetLink(%s, %s, %s, %s) = %q, want %q", c.typ, c.id, c.ctx1, c.ctx2, got, c.want)
		}
	}
}
