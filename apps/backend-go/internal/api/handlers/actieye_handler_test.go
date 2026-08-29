package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

func TestActiEyeSummary_RequiresAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	defer db.Close()

	h := NewActiEyeHandler(db)
	c, w := testutil.NewGETContext("/api/v1/actieye", nil)

	h.GetSummary(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestActiEyeSummary_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT COALESCE\(thread_count, 0\).*FROM users WHERE id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"posts", "comments", "likes", "created_at"}).
			AddRow(10, 20, 30, time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)))
	mock.ExpectQuery(`SELECT visit_date FROM user_daily_visits WHERE user_id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"visit_date"}))

	h := NewActiEyeHandler(db)
	c, w := testutil.NewGETContextWithClaims("/api/v1/actieye", nil, &auth.Claims{UserID: "user-1"})

	h.GetSummary(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Posts         int `json:"posts"`
			Comments      int `json:"comments"`
			Likes         int `json:"likes"`
			CurrentStreak int `json:"current_streak"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Fatal("expected success=true")
	}
	if resp.Data.Posts != 10 || resp.Data.Comments != 20 || resp.Data.Likes != 30 {
		t.Fatalf("counters mismatch: %+v", resp.Data)
	}
}
