package moderation

import (
	"context"
	"database/sql"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const appealUUID = "aa0e8400-e29b-41d4-a716-446655440000"

// ──────────────────────────── Appeals ────────────────────────────

func TestSubmitAppeal_Success(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT revoked_at, expires_at FROM user_sanctions WHERE id = \$1 AND user_id = \$2`).
		WithArgs(appealUUID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"revoked_at", "expires_at"}).AddRow(nil, nil))
	mock.ExpectQuery(`INSERT INTO sanction_appeals`).
		WithArgs(appealUUID, "u1", "прошу пересмотреть").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("ap-1"))

	c, w := newPOSTContext("/api/v1/moderation/appeals",
		map[string]string{"sanction_id": appealUUID, "body": "прошу пересмотреть"}, claimsFor("u1"), nil)
	h.SubmitAppeal(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestSubmitAppeal_InactiveSanction(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT revoked_at, expires_at FROM user_sanctions`).
		WithArgs(appealUUID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"revoked_at", "expires_at"}).AddRow(time.Now(), nil))

	c, w := newPOSTContext("/api/v1/moderation/appeals",
		map[string]string{"sanction_id": appealUUID, "body": "пересмотрите"}, claimsFor("u1"), nil)
	h.SubmitAppeal(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for an inactive sanction, got %d", w.Code)
	}
}

func TestSubmitAppeal_AlreadyAppealed(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery(`SELECT revoked_at, expires_at FROM user_sanctions`).
		WithArgs(appealUUID, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"revoked_at", "expires_at"}).AddRow(nil, nil))
	mock.ExpectQuery(`INSERT INTO sanction_appeals`).WillReturnError(sql.ErrNoRows) // ON CONFLICT DO NOTHING

	c, w := newPOSTContext("/api/v1/moderation/appeals",
		map[string]string{"sanction_id": appealUUID, "body": "повторно"}, claimsFor("u1"), nil)
	h.SubmitAppeal(c)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a duplicate appeal, got %d", w.Code)
	}
}

func TestDecideAppeal_AcceptLiftsSanction(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE sanction_appeals\s*SET status = \$1, decided_by = \$2`).
		WithArgs("accepted", "u1", "", appealUUID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "sanction_id"}).AddRow("u-9", appealUUID))
	mock.ExpectExec(`UPDATE user_sanctions SET revoked_at = NOW\(\), revoked_by = \$1`).
		WithArgs("u1", appealUUID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "appeal_accepted", TargetUser, "u-9", nil, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/appeals/"+appealUUID+"/accept", nil, claimsFor("u1"),
		map[string]string{"id": appealUUID})
	h.DecideAppeal(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestListAppeals_HelperCanRead(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, true)

	mock.ExpectQuery(`SELECT COUNT\(\*\)::int .*FROM sanction_appeals a`).
		WithArgs("open").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`SELECT\s+a\.id::text, a\.sanction_id::text`).
		WithArgs("open", 50, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "sanction_id", "user_id", "username", "body", "status", "kind", "reason",
			"decision_note", "decided_by", "decided_at", "created_at",
		}))

	c, w := newGETContext("/api/v1/moderation/appeals", claimsFor("u1"))
	h.ListAppeals(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

// ──────────────────────────── Auto-signals ────────────────────────────

func TestInsertSystemReport_DedupesOpenSystemReports(t *testing.T) {
	h, mock := setupHandler(t)

	// First scan files a report …
	mock.ExpectQuery(`INSERT INTO content_reports \(target_type, target_id, reporter_id, category, reason, source\)`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("r-1"))
	created, err := h.insertSystemReport(t.Context(), TargetUser, appealUUID, "всплеск")
	if err != nil || !created {
		t.Fatalf("expected a created report, got created=%v err=%v", created, err)
	}

	// … a second one for the same target is suppressed by the partial index.
	mock.ExpectQuery(`INSERT INTO content_reports`).WillReturnError(sql.ErrNoRows)
	created, err = h.insertSystemReport(t.Context(), TargetUser, appealUUID, "всплеск")
	if err != nil || created {
		t.Fatalf("expected the duplicate to be suppressed, got created=%v err=%v", created, err)
	}
}

func TestRunSignalScan_FilesBurstReport(t *testing.T) {
	h, mock := setupHandler(t)

	// Burst scan finds one user.
	mock.ExpectQuery(`(?s)FROM user_activity_events e.*HAVING COUNT\(\*\) >= t\.threshold`).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "event_type", "count"}).
			AddRow("u-9", "like_given", 99))
	// A system report is filed for that user …
	mock.ExpectQuery(`INSERT INTO content_reports`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("r-1"))
	// … then the duplicate scan finds nothing.
	mock.ExpectQuery(`(?s)FROM \(\s*SELECT 'post' AS target_type`).
		WillReturnRows(sqlmock.NewRows([]string{"target_type", "target_id", "n"}))

	created, err := h.RunSignalScan(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if created != 1 {
		t.Fatalf("expected 1 system report, got %d", created)
	}
}

func TestLoadSignalConfig_Defaults(t *testing.T) {
	c := loadSignalConfig()
	if c.window != 5*time.Minute || c.interval != 5*time.Minute {
		t.Fatalf("unexpected windows: %+v", c)
	}
	if c.thresholds["like_given"] != 40 || c.dupMinHits != 3 || c.dupMinLen != 20 {
		t.Fatalf("unexpected defaults: %+v", c)
	}
}

func TestLoadSignalConfig_EnvOverridesAndDisable(t *testing.T) {
	t.Setenv("SIGNAL_LIKES_THRESHOLD", "5")
	t.Setenv("SIGNAL_REPOSTS_THRESHOLD", "0")
	t.Setenv("SIGNAL_BURST_WINDOW_MINUTES", "1")
	t.Setenv("SIGNAL_DUP_MIN_HITS", "1") // clamped up to 2

	c := loadSignalConfig()
	if c.thresholds["like_given"] != 5 {
		t.Fatalf("override ignored: %+v", c.thresholds)
	}
	if _, ok := c.thresholds["repost_created"]; ok {
		t.Fatal("a zero threshold must disable the check")
	}
	if c.window != time.Minute {
		t.Fatalf("window override ignored: %v", c.window)
	}
	if c.dupMinHits != 2 {
		t.Fatalf("dupMinHits must clamp to 2, got %d", c.dupMinHits)
	}
}
