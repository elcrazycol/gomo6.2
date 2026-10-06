// Package activity records an append-only, best-effort log of user actions.
//
// Two consumers: moderation ("what did user X do" — investigate reports, ban
// behaviour no counter can show) and honest time-series graphs, which cannot be
// reconstructed from the denormalized counters in users.*.
//
// The log is deliberately content-free: no message bodies, no DM events and no
// IP addresses. Private conversations are out of scope by design (the same
// invariant achievements.EventType documents) and a behavioural log has no
// business storing IPs.
//
// Writes go through a bounded bg.Pool: a burst of actions must never spawn one
// goroutine (and therefore one DB connection) per event. A full queue drops the
// event and counts it, exposed via the bg Prometheus metrics.
package activity

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/gomo6/backend/internal/bg"
)

const (
	// One narrow-row insert; two workers keep up with any realistic action rate.
	workers = 2
	// The queue absorbs bursts; under extreme pressure events are dropped
	// (counted) instead of piling up.
	queueLen = 2048
	// Bounds one insert so a stalled DB cannot pin a worker forever.
	insertTimeout = 3 * time.Second
	// How far ahead partition maintenance creates months.
	partitionsAhead = 3
	// Raw events are kept this long; daily aggregates are the long-term record.
	defaultKeepMonths = 6
)

const insertSQL = `INSERT INTO user_activity_events (user_id, event_type, target_type, target_id)
	VALUES ($1, $2, $3, $4)`

// Recorder writes activity events. Build it with New; a nil *Recorder is safe
// everywhere Record is called (it is a no-op), so callers can wire it
// unconditionally.
type Recorder struct {
	db   *sql.DB
	pool *bg.Pool
}

// New builds a recorder over db. A nil db returns a nil recorder.
func New(db *sql.DB) *Recorder {
	if db == nil {
		return nil
	}
	return &Recorder{db: db, pool: bg.New("activity", workers, queueLen)}
}

// Record appends one event. Best-effort and asynchronous: it never blocks the
// caller and never returns an error — a full queue drops the event (counted in
// the bg metrics) and a failed insert is logged.
//
// targetType/targetID are optional; pass "" when the action has no object.
// targetID must be a UUID string or "" (an invalid value fails the insert, which
// is only logged).
func (r *Recorder) Record(userID, eventType, targetType, targetID string) {
	if r == nil || r.db == nil || userID == "" || eventType == "" {
		return
	}
	// Bind NULL (not "") for absent target columns so the columns stay clean and
	// target_id never fails the uuid cast.
	var tt, ti interface{}
	if targetType != "" {
		tt = targetType
	}
	if targetID != "" {
		ti = targetID
	}
	r.pool.Go(func() {
		ctx, cancel := context.WithTimeout(context.Background(), insertTimeout)
		defer cancel()
		if _, err := r.db.ExecContext(ctx, insertSQL, userID, eventType, tt, ti); err != nil {
			log.Printf("[activity] insert %q for %s failed: %v", eventType, userID, err)
		}
	})
}

// MaintainPartitions creates the current month's partitions (plus a few ahead)
// and drops any older than keepMonths. Called at startup and on a timer, so the
// ledger needs no pg_cron or external scheduler. Errors are returned for
// logging — maintenance must never be fatal.
func MaintainPartitions(ctx context.Context, db *sql.DB, keepMonths int) error {
	if db == nil {
		return nil
	}
	if keepMonths < 1 {
		keepMonths = defaultKeepMonths
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `SELECT ensure_activity_partitions($1)`, partitionsAhead); err != nil {
		return fmt.Errorf("ensure activity partitions: %w", err)
	}
	if _, err := db.ExecContext(ctx, `SELECT drop_old_activity_partitions($1)`, keepMonths); err != nil {
		return fmt.Errorf("drop old activity partitions: %w", err)
	}
	return nil
}

// QueueLen reports how many events are waiting to be written (0 for nil).
func (r *Recorder) QueueLen() int {
	if r == nil {
		return 0
	}
	return r.pool.QueueLen()
}

// Dropped reports how many events were dropped because the queue was full.
func (r *Recorder) Dropped() uint64 {
	if r == nil {
		return 0
	}
	return r.pool.Dropped()
}
