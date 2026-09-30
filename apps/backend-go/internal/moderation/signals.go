package moderation

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Auto-signal tuning defaults. Every knob is overridable from the environment
// (SIGNAL_* — see loadSignalConfig), so thresholds can be tuned without a
// rebuild. A threshold <= 0 disables that check.
const (
	defSignalWindowMinutes = 5
	defSignalIntervalMins  = 5
	defDupWindowHours      = 24
	defDupMinHits          = 3
	defDupMinLen           = 20

	defLikesThreshold    = 40
	defEntriesThreshold  = 15
	defCommentsThreshold = 20
	defRepostsThreshold  = 10
)

// signalConfig is the resolved auto-signal tuning.
type signalConfig struct {
	window     time.Duration // burst look-back
	interval   time.Duration // scan period
	thresholds map[string]int
	dupWindow  time.Duration
	dupMinHits int
	dupMinLen  int
}

var (
	signalCfgOnce sync.Once
	signalCfg     signalConfig
)

// SignalConfig resolves the tuning once from the environment. Exposed so the
// startup log can print what is actually in effect.
func SignalConfig() signalConfig {
	signalCfgOnce.Do(func() { signalCfg = loadSignalConfig() })
	return signalCfg
}

func loadSignalConfig() signalConfig {
	c := signalConfig{
		window:     time.Duration(envInt("SIGNAL_BURST_WINDOW_MINUTES", defSignalWindowMinutes)) * time.Minute,
		interval:   time.Duration(envInt("SIGNAL_INTERVAL_MINUTES", defSignalIntervalMins)) * time.Minute,
		dupWindow:  time.Duration(envInt("SIGNAL_DUP_WINDOW_HOURS", defDupWindowHours)) * time.Hour,
		dupMinHits: envInt("SIGNAL_DUP_MIN_HITS", defDupMinHits),
		dupMinLen:  envInt("SIGNAL_DUP_MIN_LEN", defDupMinLen),
		thresholds: map[string]int{
			"like_given":      envInt("SIGNAL_LIKES_THRESHOLD", defLikesThreshold),
			"entry_created":   envInt("SIGNAL_ENTRIES_THRESHOLD", defEntriesThreshold),
			"comment_created": envInt("SIGNAL_COMMENTS_THRESHOLD", defCommentsThreshold),
			"repost_created":  envInt("SIGNAL_REPOSTS_THRESHOLD", defRepostsThreshold),
		},
	}
	// A non-positive threshold means "do not check this event type".
	for k, v := range c.thresholds {
		if v <= 0 {
			delete(c.thresholds, k)
		}
	}
	if c.dupMinHits < 2 {
		c.dupMinHits = 2
	}
	return c
}

func envInt(key string, def int) int {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			return n
		}
	}
	return def
}

var eventLabels = map[string]string{
	"like_given":      "лайков",
	"entry_created":   "записей",
	"comment_created": "комментариев",
	"repost_created":  "репостов",
}

// StartSignalLoop runs the ledger/duplicate scan every signalInterval until ctx
// is cancelled. Errors are logged, never fatal.
func (h *Handler) StartSignalLoop(ctx context.Context) {
	ticker := time.NewTicker(SignalConfig().interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := h.RunSignalScan(ctx); err != nil {
				log.Printf("[signals] scan failed: %v", err)
			} else if n > 0 {
				log.Printf("[signals] filed %d system report(s)", n)
			}
		}
	}
}

// RunSignalScan looks for anomalies in the activity ledger (bursts) and in the
// content tables (duplicates) and files one system report per finding. The
// partial unique index keeps at most ONE open system report per target, so a
// standing anomaly does not pile up. Returns how many reports were created.
func (h *Handler) RunSignalScan(ctx context.Context) (int, error) {
	if h.db == nil {
		return 0, nil
	}
	created, err := h.scanBursts(ctx)
	if err != nil {
		return created, err
	}
	dups, err := h.scanDuplicates(ctx)
	created += dups
	if created > 0 {
		h.invalidateModerationCache()
	}
	if err != nil {
		return created, err
	}
	return created, nil
}

// scanBursts flags users whose activity of one kind spikes inside signalWindow.
func (h *Handler) scanBursts(ctx context.Context) (int, error) {
	cfg := SignalConfig()
	if len(cfg.thresholds) == 0 {
		return 0, nil
	}
	args := []interface{}{time.Now().Add(-cfg.window)}
	values := make([]string, 0, len(cfg.thresholds))
	for eventType, threshold := range cfg.thresholds {
		args = append(args, eventType, threshold)
		values = append(values, fmt.Sprintf("($%d::text, $%d::int)", len(args)-1, len(args)))
	}

	rows, err := h.db.QueryContext(ctx, `
		SELECT e.user_id::text, e.event_type, COUNT(*)::int
		FROM user_activity_events e
		JOIN (VALUES `+strings.Join(values, ", ")+`) AS t(event_type, threshold)
		  ON t.event_type = e.event_type
		WHERE e.created_at >= $1
		GROUP BY e.user_id, e.event_type, t.threshold
		HAVING COUNT(*) >= t.threshold`, args...)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type finding struct {
		userID    string
		eventType string
		count     int
	}
	findings := []finding{}
	for rows.Next() {
		var f finding
		if err := rows.Scan(&f.userID, &f.eventType, &f.count); err != nil {
			return 0, err
		}
		findings = append(findings, f)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	created := 0
	for _, f := range findings {
		label := eventLabels[f.eventType]
		if label == "" {
			label = f.eventType
		}
		reason := fmt.Sprintf("Системный сигнал: %d %s за %d мин", f.count, label, int(cfg.window.Minutes()))
		ok, err := h.insertSystemReport(ctx, TargetUser, f.userID, reason)
		if err != nil {
			return created, err
		}
		if ok {
			created++
		}
	}
	return created, nil
}

// scanDuplicates flags the same body posted repeatedly by one user.
func (h *Handler) scanDuplicates(ctx context.Context) (int, error) {
	cfg := SignalConfig()
	rows, err := h.db.QueryContext(ctx, `
		SELECT d.target_type, d.target_id::text, d.n
		FROM (
			SELECT 'post' AS target_type,
			       (array_agg(id ORDER BY created_at DESC))[1] AS target_id,
			       COUNT(*) AS n
			FROM posts
			WHERE created_at >= $1
			  AND length(btrim(COALESCE(content, ''))) >= $3
			GROUP BY user_id, md5(COALESCE(content, ''))
			HAVING COUNT(*) >= $2
			UNION ALL
			SELECT 'thread', (array_agg(t.id ORDER BY t.created_at DESC))[1], COUNT(*)
			FROM threads t
			LEFT JOIN boards b ON b.id = t.board_id
			WHERE t.created_at >= $1
			  AND length(btrim(COALESCE(t.content, ''))) >= $3
			  -- Only public contexts: content inside a private gomosub must not be
			  -- surfaced to moderators by an auto-signal.
			  AND (t.board_id IS NULL OR COALESCE(b.visibility, 'public') <> 'private')
			GROUP BY t.user_id, md5(COALESCE(t.content, ''))
			HAVING COUNT(*) >= $2
			UNION ALL
			SELECT 'wall_post', (array_agg(w.id ORDER BY w.created_at DESC))[1], COUNT(*)
			FROM profile_wall_posts w
			LEFT JOIN privacy_settings ps ON ps.user_id = w.user_id
			WHERE w.created_at >= $1
			  AND length(btrim(COALESCE(w.content, ''))) >= $3
			  -- Never surface content from a private / hidden wall to moderators
			  -- through an auto-signal: only user reports may do that.
			  AND COALESCE(ps.private_profile, false) = false
			  AND COALESCE(ps.private_hide_wall, false) = false
			GROUP BY w.author_id, md5(COALESCE(w.content, ''))
			HAVING COUNT(*) >= $2
		) d`, time.Now().Add(-cfg.dupWindow), cfg.dupMinHits, cfg.dupMinLen)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	created := 0
	for rows.Next() {
		var targetType, targetID string
		var n int
		if err := rows.Scan(&targetType, &targetID, &n); err != nil {
			return created, err
		}
		reason := fmt.Sprintf("Системный сигнал: %d одинаковых записей за %d ч", n, int(cfg.dupWindow.Hours()))
		ok, err := h.insertSystemReport(ctx, targetType, targetID, reason)
		if err != nil {
			return created, err
		}
		if ok {
			created++
		}
	}
	return created, rows.Err()
}

// insertSystemReport files one system report. It returns false when an open
// system report for the target already exists (the partial unique index).
func (h *Handler) insertSystemReport(ctx context.Context, targetType, targetID, reason string) (bool, error) {
	if _, ok := targetExistenceQuery[targetType]; !ok {
		return false, nil
	}
	var id string
	err := h.db.QueryRowContext(ctx, `
		INSERT INTO content_reports (target_type, target_id, reporter_id, category, reason, source)
		VALUES ($1, $2, NULL, 'spam', $3, 'system')
		ON CONFLICT (target_type, target_id) WHERE source = 'system' AND status = 'open' DO NOTHING
		RETURNING id::text`, targetType, targetID, reason).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
