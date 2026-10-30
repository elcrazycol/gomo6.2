package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

func setupAwardsAdminHandler(t *testing.T) (*AwardsAdminHandler, sqlmock.Sqlmock) {
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
	return NewAwardsAdminHandler(db, nil, nil), mock
}

func curatorClaims() *auth.Claims {
	return &auth.Claims{UserID: "curator-1"}
}

func expectAwardManager(mock sqlmock.Sqlmock, userID string, ok bool) {
	mock.ExpectQuery(`SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role IN \('curator', 'admin'\)\)`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(ok))
}

func rulePayload() map[string]interface{} {
	from := time.Now().Add(-7 * 24 * time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().Add(7 * 24 * time.Hour).UTC().Format(time.RFC3339)
	return map[string]interface{}{
		"award_key": "hw2026", "active_from": from, "active_to": to,
		"min_wall_posts": 3, "min_threads": 0, "min_likes_given": 5,
		"min_likes_received": 0, "min_active_days": 2,
	}
}

func TestUpsertAwardRule_OK(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", true)
	mock.ExpectQuery(`SELECT kind FROM achievements WHERE group_key = \$1`).
		WithArgs("hw2026").
		WillReturnRows(sqlmock.NewRows([]string{"kind"}).AddRow("award"))
	mock.ExpectExec(`INSERT INTO award_auto_rules`).
		WithArgs("hw2026", sqlmock.AnyArg(), sqlmock.AnyArg(), 3, 0, 5, 0, 2, "curator-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := testutil.NewPUTContext("/api/v1/admin/awards/rule", rulePayload(), curatorClaims(), nil)
	h.UpsertAwardRule(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpsertAwardRule_ModeratorForbidden(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", false)

	c, w := testutil.NewPUTContext("/api/v1/admin/awards/rule", rulePayload(), curatorClaims(), nil)
	h.UpsertAwardRule(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpsertAwardRule_MilestoneRejected(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", true)
	mock.ExpectQuery(`SELECT kind FROM achievements WHERE group_key = \$1`).
		WithArgs("hw2026").
		WillReturnRows(sqlmock.NewRows([]string{"kind"}).AddRow("milestone"))

	c, w := testutil.NewPUTContext("/api/v1/admin/awards/rule", rulePayload(), curatorClaims(), nil)
	h.UpsertAwardRule(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpsertAwardRule_BadWindow(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", true)

	bad := rulePayload()
	bad["active_to"] = bad["active_from"] // to == from is fine; make it before
	from, _ := time.Parse(time.RFC3339, bad["active_from"].(string))
	bad["active_to"] = from.Add(-time.Hour).UTC().Format(time.RFC3339)

	c, w := testutil.NewPUTContext("/api/v1/admin/awards/rule", bad, curatorClaims(), nil)
	h.UpsertAwardRule(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpsertAwardRule_AllZeroRejected(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", true)

	zero := rulePayload()
	zero["min_wall_posts"] = 0
	zero["min_likes_given"] = 0
	zero["min_active_days"] = 0

	c, w := testutil.NewPUTContext("/api/v1/admin/awards/rule", zero, curatorClaims(), nil)
	h.UpsertAwardRule(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEvaluateAwards_NoEngine(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", true)

	c, w := testutil.NewPOSTContext("/api/v1/admin/awards/evaluate", map[string]interface{}{}, curatorClaims(), nil)
	h.EvaluateAwards(c)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteAwardRule_OK(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", true)
	mock.ExpectExec(`DELETE FROM award_auto_rules WHERE award_key = \$1`).
		WithArgs("hw2026").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := testutil.NewDELETEContextWithClaims(
		"/api/v1/admin/awards/rule", map[string]string{"award_key": "hw2026"}, nil, curatorClaims())
	h.DeleteAwardRule(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGrantAward_OK(t *testing.T) {
	h, mock := setupAwardsAdminHandler(t)
	expectAwardManager(mock, "curator-1", true)
	// The kind lookup also resolves the display title for the notification.
	mock.ExpectQuery(`SELECT kind, COALESCE\(title, ''\) FROM achievements WHERE group_key = \$1`).
		WithArgs("hw2026").
		WillReturnRows(sqlmock.NewRows([]string{"kind", "title"}).AddRow("award", "Хэллоуин 2026"))
	mock.ExpectQuery(`INSERT INTO user_awards`).
		WithArgs("user-9", "hw2026", "curator-1", "за активность").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("grant-1"))

	body := map[string]interface{}{"user_id": "user-9", "award_key": "hw2026", "reason": "за активность"}
	c, w := testutil.NewPOSTContext("/api/v1/admin/awards/grant", body, curatorClaims(), nil)
	h.GrantAward(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}
