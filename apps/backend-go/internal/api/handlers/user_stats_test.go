package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

const statsUID = "550e8400-e29b-41d4-a716-446655440000"

const (
	headerRe         = `SELECT username,.*COALESCE\(post_count, 0\), COALESCE\(thread_count, 0\),`
	showDetailedRe   = `SELECT COALESCE\(show_detailed_stats, false\) FROM privacy_settings`
	breakdownRe      = `COALESCE\(FLOOR\(SUM\(total_minutes\)::numeric / 30\), 0\)::int`
	activityDailyRe  = `SELECT \(created_at AT TIME ZONE 'UTC'\)::date::text, COUNT\(\*\)::int`
	activitySeriesRe = `SELECT 'posts' AS kind,`
)

// expectStatsHeader sets up the username + snapshot-counters read.
func expectStatsHeader(mock sqlmock.Sqlmock, username string, garma int64) {
	mock.ExpectQuery(headerRe).WithArgs(statsUID).
		WillReturnRows(sqlmock.NewRows([]string{
			"username", "posts", "threads", "wall_posts", "comments",
			"likes_received", "likes_given", "views_received", "garma", "session_minutes",
		}).AddRow(username, 85, 51, 10, 20, 82, 61, 777, garma, 300))
}

func statsFromResponse(t *testing.T, body []byte) userStatsResponse {
	t.Helper()
	var resp models.APIResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	raw, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("marshal data: %v", err)
	}
	var out userStatsResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal stats: %v", err)
	}
	return out
}

func TestGetUserStats_InvalidID(t *testing.T) {
	handler, _ := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/users/bad-id/stats", nil)
	c.Params = []gin.Param{{Key: "id", Value: "bad-id"}}

	handler.GetUserStats(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetUserStats_UnknownUser(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/users/"+statsUID+"/stats", nil)
	c.Params = []gin.Param{{Key: "id", Value: statsUID}}

	mock.ExpectQuery(headerRe).WithArgs(statsUID).WillReturnError(sql.ErrNoRows)

	handler.GetUserStats(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// A private profile seen by a non-friend leaks nothing but the username.
func TestGetUserStats_PrivateProfileForStranger(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContextWithClaims("/api/v1/users/"+statsUID+"/stats", nil,
		&auth.Claims{UserID: "stranger", Username: "stranger"})
	c.Params = []gin.Param{{Key: "id", Value: statsUID}}

	expectStatsHeader(mock, "alice", 1002)
	expectPrivacyBatch(mock, privacyBatchRow{id: statsUID, private: true})
	expectMutualFriends(mock) // not a friend

	handler.GetUserStats(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	out := statsFromResponse(t, w.Body.Bytes())
	if out.CanView {
		t.Fatal("expected can_view=false for a private stranger profile")
	}
	if out.Username != "alice" {
		t.Fatalf("username should still be present, got %q", out.Username)
	}
	if out.Totals != nil || len(out.GarmaBreakdown) != 0 || len(out.ActivitySeries) != 0 {
		t.Fatalf("private profile must expose no stats, got %+v", out)
	}
}

// The owner gets totals, the full breakdown and the activity series.
func TestGetUserStats_OwnerGetsEverything(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContextWithClaims("/api/v1/users/"+statsUID+"/stats", nil,
		&auth.Claims{UserID: statsUID, Username: "me"})
	c.Params = []gin.Param{{Key: "id", Value: statsUID}}

	expectStatsHeader(mock, "alice", 1002)
	expectPrivacyBatch(mock) // no row → public defaults; owner → no friend query
	mock.ExpectQuery(breakdownRe).WithArgs(statsUID).
		WillReturnRows(sqlmock.NewRows([]string{"t", "wp", "cc", "pl", "tl", "wpl", "wcl", "r", "st", "ag"}).
			AddRow(51, 10, 20, 40, 30, 5, 3, 7, 12, 100))
	mock.ExpectQuery(activityDailyRe).WithArgs(statsUID, 30).
		WillReturnRows(sqlmock.NewRows([]string{"date", "events"}).
			AddRow("2026-09-29", 7).AddRow("2026-09-30", 3))
	mock.ExpectQuery(activitySeriesRe).WithArgs(statsUID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"kind", "day", "cnt"}).
			AddRow("posts", "2026-09-29", 2))

	handler.GetUserStats(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	out := statsFromResponse(t, w.Body.Bytes())
	if !out.CanView || !out.Detailed || out.StatsHidden {
		t.Fatalf("owner flags wrong: %+v", out)
	}
	if out.Totals == nil || out.Totals.Garma != 1002 || out.Totals.SessionMinutes != 300 {
		t.Fatalf("unexpected totals: %+v", out.Totals)
	}
	if len(out.GarmaBreakdown) != 10 {
		t.Fatalf("expected 10 breakdown terms, got %d", len(out.GarmaBreakdown))
	}
	// threads: raw 51 × weight 4 = 204
	for _, e := range out.GarmaBreakdown {
		if e.Key == "threads" && e.Value != 204 {
			t.Fatalf("threads term = %v, want 204", e.Value)
		}
	}
	if len(out.ActivityDaily) != 2 || out.ActivityDaily[1].Events != 3 {
		t.Fatalf("expected 2 activity days, got %+v", out.ActivityDaily)
	}
	if len(out.ActivitySeries["posts"]) != 1 {
		t.Fatalf("expected the posts series, got %+v", out.ActivitySeries)
	}
}

// A public profile without show_detailed_stats: totals only.
func TestGetUserStats_PublicProfileWithoutDetailed(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/users/"+statsUID+"/stats", nil)
	c.Params = []gin.Param{{Key: "id", Value: statsUID}}

	expectStatsHeader(mock, "alice", 8)
	expectPrivacyBatch(mock) // public, no toggles → no friend query
	mock.ExpectQuery(showDetailedRe).WithArgs(statsUID).
		WillReturnRows(sqlmock.NewRows([]string{"show_detailed_stats"}).AddRow(false))

	handler.GetUserStats(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	out := statsFromResponse(t, w.Body.Bytes())
	if !out.CanView || out.Detailed {
		t.Fatalf("expected public, non-detailed, got %+v", out)
	}
	if out.Totals == nil || out.Totals.Garma != 8 {
		t.Fatalf("totals should still be present, got %+v", out.Totals)
	}
	if len(out.GarmaBreakdown) != 0 || len(out.ActivitySeries) != 0 {
		t.Fatal("breakdown/series must be withheld without show_detailed_stats")
	}
}

// A public profile with show_detailed_stats: breakdown + activity included.
func TestGetUserStats_PublicProfileWithDetailed(t *testing.T) {
	handler, mock := setupProfilesHandler(t)
	c, w := newGETContext("/api/v1/users/"+statsUID+"/stats", nil)
	c.Params = []gin.Param{{Key: "id", Value: statsUID}}

	expectStatsHeader(mock, "alice", 8)
	expectPrivacyBatch(mock)
	mock.ExpectQuery(showDetailedRe).WithArgs(statsUID).
		WillReturnRows(sqlmock.NewRows([]string{"show_detailed_stats"}).AddRow(true))
	mock.ExpectQuery(breakdownRe).WithArgs(statsUID).
		WillReturnRows(sqlmock.NewRows([]string{"t", "wp", "cc", "pl", "tl", "wpl", "wcl", "r", "st", "ag"}).
			AddRow(0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
	mock.ExpectQuery(activityDailyRe).WithArgs(statsUID, 30).
		WillReturnRows(sqlmock.NewRows([]string{"date", "events"}))
	mock.ExpectQuery(activitySeriesRe).WithArgs(statsUID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"kind", "day", "cnt"}))

	handler.GetUserStats(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	out := statsFromResponse(t, w.Body.Bytes())
	if !out.Detailed {
		t.Fatalf("expected detailed=true, got %+v", out)
	}
	if len(out.GarmaBreakdown) != 10 {
		t.Fatalf("expected 10 breakdown terms, got %d", len(out.GarmaBreakdown))
	}
}

func TestParseActivityDays(t *testing.T) {
	cases := map[string]int{"": 30, "7": 7, "0": 30, "abc": 30, "100000": maxActivityDays}
	for in, want := range cases {
		if got := parseActivityDays(in); got != want {
			t.Errorf("parseActivityDays(%q) = %d, want %d", in, got, want)
		}
	}
}
