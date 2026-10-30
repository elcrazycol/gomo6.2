package achievements

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type stubAwardNotifier struct {
	grants [][3]string // userID, awardKey, actor
}

func (s *stubAwardNotifier) NotifyAwardGranted(userID, awardKey, actor string) {
	s.grants = append(s.grants, [3]string{userID, awardKey, actor})
}

func openRuleRows(keys ...string) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"award_key", "active_from", "active_to",
		"min_wall_posts", "min_threads", "min_likes_given",
		"min_likes_received", "min_active_days", "created_by"})
	from := time.Now().Add(-7 * 24 * time.Hour)
	to := time.Now().Add(7 * 24 * time.Hour)
	for _, k := range keys {
		rows.AddRow(k, from, to, 3, 2, 5, 10, 4, "staff-1")
	}
	return rows
}

func expectOpenRules(mock sqlmock.Sqlmock, keys ...string) {
	mock.ExpectQuery("FROM award_auto_rules").
		WillReturnRows(openRuleRows(keys...))
}

// ──────────────── query building ────────────────

func TestAutoGrantQuery_OnlyNonzeroPredicates(t *testing.T) {
	q, args := autoGrantQuery(AutoRule{
		AwardKey: "hw2026", MinWallPosts: 3, MinActiveDays: 2,
		ActiveFrom: time.Now().Add(-time.Hour), ActiveTo: time.Now().Add(time.Hour),
	})
	for _, want := range []string{"profile_wall_posts", "user_daily_visits"} {
		if !strings.Contains(q, want) {
			t.Errorf("query should count %s:\n%s", want, q)
		}
	}
	for _, absent := range []string{"threads t", "post_likes", "thread_likes"} {
		if strings.Contains(q, absent) {
			t.Errorf("zero-threshold table %q must not be counted:\n%s", absent, q)
		}
	}
	if !strings.Contains(q, "NOT EXISTS (SELECT 1 FROM user_awards") {
		t.Errorf("query must skip existing holders:\n%s", q)
	}
	if !strings.Contains(q, "ON CONFLICT (award_key, user_id)") {
		t.Errorf("query must be race-safe via ON CONFLICT:\n%s", q)
	}
	// $1=key, $2=from, $3=to, $4=created_by, then thresholds.
	if len(args) != 6 {
		t.Fatalf("expected 6 args (key, window, author, 2 thresholds), got %d", len(args))
	}
	if args[0] != "hw2026" || args[4] != 3 || args[5] != 2 {
		t.Errorf("unexpected args: %v", args)
	}
}

func TestAutoGrantQuery_NullAuthor(t *testing.T) {
	q, args := autoGrantQuery(AutoRule{AwardKey: "hw", MinThreads: 1,
		ActiveFrom: time.Now(), ActiveTo: time.Now().Add(time.Hour)})
	if !strings.Contains(q, "::uuid") {
		t.Errorf("author placeholder must cast to uuid:\n%s", q)
	}
	if args[3] != nil {
		t.Errorf("empty author must bind NULL, got %v", args[3])
	}
}

// ──────────────── evaluation ────────────────

func TestEvaluateAutoAwards_GrantsAndNotifies(t *testing.T) {
	e, mock := newEngine(t)
	notif := &stubAwardNotifier{}
	e.AwardNotifier = notif

	expectOpenRules(mock, "hw2026")
	grantedAt := time.Now()
	mock.ExpectQuery("INSERT INTO user_awards").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "award_key", "awarded_at"}).
			AddRow("u1", "hw2026", grantedAt).
			AddRow("u2", "hw2026", grantedAt))
	mock.ExpectQuery("SELECT username FROM users").
		WithArgs("staff-1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("curator_ann"))

	grants, err := e.EvaluateAutoAwards(context.Background(), "")
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if len(grants) != 2 {
		t.Fatalf("expected 2 grants, got %d", len(grants))
	}
	for _, g := range grants {
		if g.AwardKey != "hw2026" {
			t.Errorf("wrong key: %q", g.AwardKey)
		}
		if g.Actor != "curator_ann" {
			t.Errorf("actor must be the rule author, got %q", g.Actor)
		}
		if g.AwardedAt.IsZero() {
			t.Errorf("awarded_at must be set (evaluation time)")
		}
	}
	if len(notif.grants) != 2 {
		t.Fatalf("expected 2 notifications, got %d", len(notif.grants))
	}
	if notif.grants[0] != [3]string{"u1", "hw2026", "curator_ann"} {
		t.Errorf("unexpected notification: %v", notif.grants[0])
	}
}

func TestEvaluateAutoAwards_NoRulesNoGrants(t *testing.T) {
	e, mock := newEngine(t)
	e.AwardNotifier = &stubAwardNotifier{}
	mock.ExpectQuery("FROM award_auto_rules").
		WillReturnRows(openRuleRows())

	grants, err := e.EvaluateAutoAwards(context.Background(), "")
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if len(grants) != 0 {
		t.Errorf("expected no grants, got %v", grants)
	}
}

func TestEvaluateAutoAwards_ClosedRuleSkipped(t *testing.T) {
	e, mock := newEngine(t)
	// The open-rule loader filters by window; a rule whose active_to passed
	// never reaches the grant query.
	rows := sqlmock.NewRows([]string{"award_key", "active_from", "active_to",
		"min_wall_posts", "min_threads", "min_likes_given",
		"min_likes_received", "min_active_days", "created_by"})
	mock.ExpectQuery("FROM award_auto_rules").WithArgs("old2025").
		WillReturnRows(rows)

	grants, err := e.EvaluateAutoAwards(context.Background(), "old2025")
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if len(grants) != 0 {
		t.Errorf("closed rule must grant nothing, got %v", grants)
	}
}

func TestEvaluateAutoAwards_NilDB(t *testing.T) {
	e := New(nil, testCatalog(t))
	grants, err := e.EvaluateAutoAwards(context.Background(), "")
	if err != nil || len(grants) != 0 {
		t.Errorf("nil db must be a silent noop, got %v, %v", grants, err)
	}
}

// A revoked auto grant frees the slot: the partial unique index only covers
// active grants, so re-evaluation re-issues.
func TestEvaluateAutoAwards_RegrantAfterRevoke(t *testing.T) {
	e, mock := newEngine(t)
	e.AwardNotifier = &stubAwardNotifier{}
	expectOpenRules(mock, "hw2026")
	mock.ExpectQuery("INSERT INTO user_awards").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "award_key", "awarded_at"}).
			AddRow("u9", "hw2026", time.Now()))
	mock.ExpectQuery("SELECT username FROM users").
		WithArgs("staff-1").
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("ann"))

	grants, err := e.EvaluateAutoAwards(context.Background(), "hw2026")
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if len(grants) != 1 || grants[0].UserID != "u9" {
		t.Errorf("expected re-grant to u9, got %v", grants)
	}
}

// ──────────────── (rule payload validation lives in handlers tests) ────────────────
