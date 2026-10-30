package achievements

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// AutoRule is one row of award_auto_rules: an activity window plus the
// thresholds a user must ALL meet inside it to receive the award.
type AutoRule struct {
	AwardKey         string
	ActiveFrom       time.Time
	ActiveTo         time.Time
	MinWallPosts     int
	MinThreads       int
	MinLikesGiven    int
	MinLikesReceived int
	MinActiveDays    int
	// CreatedBy is the rule author's user id (awarded_by of auto grants and
	// the actor of the grant notification). Empty when unset.
	CreatedBy string
}

// AutoGrant is one issued automatic grant, with everything the notification
// layer needs. AwardedAt is the evaluation time — grants are never backdated.
type AutoGrant struct {
	UserID    string
	AwardKey  string
	Actor     string
	AwardedAt time.Time
}

// AwardNotifier delivers award-grant notifications (a row in the notifications
// panel — no toast). Nil disables them. Wired in routes once the notification
// service is available.
type AwardNotifier interface {
	NotifyAwardGranted(userID, awardKey, actor string)
}

// autoAwardEvery is the default cadence of the auto-award loop.
const autoAwardEvery = time.Hour

// AutoAwardLoop evaluates every open auto-rule immediately once, then every
// `every` (default hourly) until the context is cancelled. Started from
// routes, next to the other achievement background passes.
func (e *Engine) AutoAwardLoop(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = autoAwardEvery
	}
	if _, err := e.EvaluateAutoAwards(ctx, ""); err != nil {
		e.logf("auto-awards: initial pass: %v", err)
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := e.EvaluateAutoAwards(ctx, ""); err != nil {
				e.logf("auto-awards: pass: %v", err)
			}
		}
	}
}

// EvaluateAutoAwards grants open auto-rule awards to every qualifying user.
// A rule is open while active_from <= now <= active_to: before the window the
// counters are empty anyway, and after active_to no new grants are issued for
// the rule (a manual staff grant stays possible anytime). When onlyKey is not
// empty, only that rule is evaluated (the admin "check now" button).
//
// Qualification is strict AND over the nonzero thresholds, counted inside the
// closed window [active_from, active_to]. Users holding any active grant of
// the award (manual or auto) are skipped, so one award means one card.
// awarded_at is always the evaluation time. The returned grants are committed;
// notification failures never roll them back.
func (e *Engine) EvaluateAutoAwards(ctx context.Context, onlyKey string) ([]AutoGrant, error) {
	if e.db == nil {
		return nil, nil
	}
	rules, err := e.openAutoRules(ctx, onlyKey)
	if err != nil {
		return nil, err
	}
	var grants []AutoGrant
	for _, r := range rules {
		got, err := e.evaluateAutoRule(ctx, r)
		if err != nil {
			return grants, fmt.Errorf("achievements: auto-awards %s: %w", r.AwardKey, err)
		}
		grants = append(grants, got...)
	}
	return grants, nil
}

// openAutoRules loads the rules eligible for evaluation right now.
func (e *Engine) openAutoRules(ctx context.Context, onlyKey string) ([]AutoRule, error) {
	q := `
SELECT r.award_key, r.active_from, r.active_to,
       r.min_wall_posts, r.min_threads, r.min_likes_given,
       r.min_likes_received, r.min_active_days,
       COALESCE(r.created_by::text, '')
FROM award_auto_rules r
JOIN achievements a ON a.group_key = r.award_key
WHERE a.kind = 'award'
  AND r.active_from <= NOW() AND r.active_to >= NOW()`
	args := []interface{}{}
	if onlyKey != "" {
		q += ` AND r.award_key = $1`
		args = append(args, onlyKey)
	}
	rows, err := e.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("achievements: auto-awards load rules: %w", err)
	}
	defer rows.Close()
	var rules []AutoRule
	for rows.Next() {
		var r AutoRule
		if err := rows.Scan(&r.AwardKey, &r.ActiveFrom, &r.ActiveTo,
			&r.MinWallPosts, &r.MinThreads, &r.MinLikesGiven,
			&r.MinLikesReceived, &r.MinActiveDays, &r.CreatedBy); err != nil {
			return nil, fmt.Errorf("achievements: auto-awards scan rule: %w", err)
		}
		rules = append(rules, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("achievements: auto-awards rows: %w", err)
	}
	return rules, nil
}

// evaluateAutoRule grants one rule's award to every qualifying user and
// notifies them. The INSERT is set-based and race-safe: the partial unique
// index on (award_key, user_id) for active auto grants backs the ON CONFLICT
// guard, and holders of any active grant (manual included) are skipped.
func (e *Engine) evaluateAutoRule(ctx context.Context, r AutoRule) ([]AutoGrant, error) {
	query, args := autoGrantQuery(r)
	rows, err := e.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("achievements: auto-awards grant: %w", err)
	}
	defer rows.Close()
	var grants []AutoGrant
	for rows.Next() {
		var g AutoGrant
		if err := rows.Scan(&g.UserID, &g.AwardKey, &g.AwardedAt); err != nil {
			return nil, fmt.Errorf("achievements: auto-awards scan grant: %w", err)
		}
		grants = append(grants, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("achievements: auto-awards grant rows: %w", err)
	}
	if len(grants) == 0 {
		return nil, nil
	}

	actor := ""
	if r.CreatedBy != "" {
		_ = e.db.QueryRowContext(ctx,
			`SELECT username FROM users WHERE id = $1`, r.CreatedBy).Scan(&actor)
	}
	for i := range grants {
		grants[i].Actor = actor
	}
	// Notify after the commit — never before, so a failed insert cannot
	// produce a phantom notification. Delivery is best-effort.
	if e.AwardNotifier != nil {
		for _, g := range grants {
			e.AwardNotifier.NotifyAwardGranted(g.UserID, g.AwardKey, g.Actor)
		}
	}
	return grants, nil
}

// autoGrantQuery builds the set-based grant for one rule. Only nonzero
// thresholds become predicates (a zero threshold is trivially met). Counter
// semantics mirror the quest engine's unified content model (see stats.go),
// but every count is restricted to the closed window:
//
//   - wall posts: authored posts (author_id) in the window, anywhere;
//   - threads: created threads in the window;
//   - likes given: likes the user put in the window (all four like tables);
//   - likes received: likes put in the window on the user's content —
//     activity of OTHERS during the window, on content of any age;
//   - active days: distinct visit dates inside the window.
func autoGrantQuery(r AutoRule) (string, []interface{}) {
	from, to := r.ActiveFrom.UTC(), r.ActiveTo.UTC()
	args := []interface{}{r.AwardKey, from, to}
	next := func(v interface{}) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	by := next(nullableUUID(r.CreatedBy))

	var conds []string
	if r.MinWallPosts > 0 {
		p := next(r.MinWallPosts)
		conds = append(conds, `(SELECT COUNT(*) FROM profile_wall_posts w
  WHERE w.author_id = u.id AND w.created_at >= $2 AND w.created_at <= $3) >= `+p)
	}
	if r.MinThreads > 0 {
		p := next(r.MinThreads)
		conds = append(conds, `(SELECT COUNT(*) FROM threads t
  WHERE t.user_id = u.id AND t.created_at >= $2 AND t.created_at <= $3) >= `+p)
	}
	if r.MinLikesGiven > 0 {
		p := next(r.MinLikesGiven)
		conds = append(conds, `((SELECT COUNT(*) FROM post_likes pl
   WHERE pl.user_id = u.id AND pl.created_at >= $2 AND pl.created_at <= $3)
  + (SELECT COUNT(*) FROM thread_likes tl
   WHERE tl.user_id = u.id AND tl.created_at >= $2 AND tl.created_at <= $3)
  + (SELECT COUNT(*) FROM profile_wall_post_likes wl
   WHERE wl.user_id = u.id AND wl.created_at >= $2 AND wl.created_at <= $3)
  + (SELECT COUNT(*) FROM profile_wall_comment_likes cl
   WHERE cl.user_id = u.id AND cl.created_at >= $2 AND cl.created_at <= $3)) >= `+p)
	}
	if r.MinLikesReceived > 0 {
		p := next(r.MinLikesReceived)
		conds = append(conds, `((SELECT COUNT(*) FROM post_likes pl
   JOIN posts po ON po.id = pl.post_id
   WHERE po.user_id = u.id AND pl.created_at >= $2 AND pl.created_at <= $3)
  + (SELECT COUNT(*) FROM thread_likes tl
   JOIN threads th ON th.id = tl.thread_id
   WHERE th.user_id = u.id AND tl.created_at >= $2 AND tl.created_at <= $3)
  + (SELECT COUNT(*) FROM profile_wall_post_likes wl
   JOIN profile_wall_posts wp ON wp.id = wl.post_id
   WHERE wp.author_id = u.id AND wl.created_at >= $2 AND wl.created_at <= $3)
  + (SELECT COUNT(*) FROM profile_wall_comment_likes cl
   JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id
   WHERE wc.user_id = u.id AND cl.created_at >= $2 AND cl.created_at <= $3)) >= `+p)
	}
	if r.MinActiveDays > 0 {
		p := next(r.MinActiveDays)
		conds = append(conds, `(SELECT COUNT(DISTINCT v.visit_date) FROM user_daily_visits v
  WHERE v.user_id = u.id AND v.visit_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date) >= `+p)
	}

	query := `INSERT INTO user_awards (user_id, award_key, awarded_by, reason, auto_granted)
SELECT u.id, $1, ` + by + `::uuid, '', TRUE
FROM users u
WHERE ` + strings.Join(conds, "\n  AND ") + `
  AND NOT EXISTS (SELECT 1 FROM user_awards ua
    WHERE ua.award_key = $1 AND ua.user_id = u.id AND ua.revoked_at IS NULL)
ON CONFLICT (award_key, user_id) WHERE auto_granted AND revoked_at IS NULL DO NOTHING
RETURNING user_id, award_key, awarded_at`
	return query, args
}

// nullableUUID renders an empty id as NULL for the ::uuid cast.
func nullableUUID(id string) interface{} {
	if id == "" {
		return nil
	}
	return id
}
