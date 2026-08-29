// Package actieye implements the activity summary behind the ActiEye widget:
// a gradient circle on the profile whose colors shift with the owner's
// activity, plus the daily-visit streak panel ("дорога" of the last 30 days).
// It derives everything from already-maintained tables (users counters +
// user_daily_visits) — no separate event log is needed.
package actieye

import (
	"context"
	"database/sql"
	"hash/fnv"
	"time"
)

// DayEntry is one day of the streak road.
type DayEntry struct {
	Date   string `json:"date"`
	Active bool   `json:"active"`
}

// Summary is the per-user activity snapshot consumed by ActiEye.
type Summary struct {
	Posts         int        `json:"posts"`
	Comments      int        `json:"comments"`
	Likes         int        `json:"likes"`
	ActiveDays    int        `json:"active_days"`
	CurrentStreak int        `json:"current_streak"`
	BestStreak    int        `json:"best_streak"`
	Days          []DayEntry `json:"days"`
	Seed          int        `json:"seed"`
}

// SeedFor derives a stable per-user seed from the user ID (FNV-1a hash).
// It feeds the gradient's base rotation so every user's eye starts differently.
func SeedFor(userID string) int {
	h := fnv.New32a()
	_, _ = h.Write([]byte(userID))
	return int(h.Sum32() % 360)
}

// Fetch builds the activity summary for one user. Counters mirror the profile
// stats definitions (Записи = threads + wall posts, Комментарии, Лайков).
func Fetch(ctx context.Context, db *sql.DB, userID string) (Summary, error) {
	now := time.Now().UTC()
	s := Summary{Seed: SeedFor(userID)}

	var registered time.Time
	if err := db.QueryRowContext(ctx, `
		SELECT COALESCE(thread_count, 0) + COALESCE(wall_post_count, 0),
		       COALESCE(comment_count, 0),
		       COALESCE(likes_received_count, 0),
		       created_at
		FROM users WHERE id = $1`, userID).
		Scan(&s.Posts, &s.Comments, &s.Likes, &registered); err != nil {
		return s, err
	}

	rows, err := db.QueryContext(ctx, `
		SELECT visit_date FROM user_daily_visits WHERE user_id = $1`, userID)
	if err != nil {
		return s, err
	}
	defer rows.Close()

	dates := make([]time.Time, 0, 32)
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			return s, err
		}
		dates = append(dates, midnightUTC(d))
	}
	if err := rows.Err(); err != nil {
		return s, err
	}

	s.ActiveDays = len(dates)
	s.CurrentStreak, s.BestStreak = streaks(dates, midnightUTC(now))
	s.Days = road(dates, midnightUTC(registered), now)

	return s, nil
}

// midnightUTC normalizes a timestamp to UTC midnight so date comparisons are
// stable regardless of how the driver parses DATE columns.
func midnightUTC(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// streaks returns the current and longest consecutive-day visit runs. The
// current run counts backwards from today; when today has no visit yet, it
// counts from yesterday instead — the streak is still alive until the day ends.
func streaks(dates []time.Time, today time.Time) (current, best int) {
	visited := make(map[time.Time]bool, len(dates))
	for _, d := range dates {
		visited[d] = true
	}

	cur := today
	if !visited[cur] {
		cur = cur.AddDate(0, 0, -1)
	}
	for visited[cur] {
		current++
		cur = cur.AddDate(0, 0, -1)
	}

	for _, d := range dates {
		if visited[d.AddDate(0, 0, -1)] {
			continue // not the start of a run
		}
		run := 0
		for c := d; visited[c]; c = c.AddDate(0, 0, 1) {
			run++
		}
		if run > best {
			best = run
		}
	}
	return current, best
}

// road builds the days from the registration date through today as active
// flags, oldest first — the horizontal "дорога" in the ActiEye panel. Days
// before registration are simply not part of the road.
func road(dates []time.Time, registered, now time.Time) []DayEntry {
	visited := make(map[time.Time]bool, len(dates))
	for _, d := range dates {
		visited[d] = true
	}
	today := midnightUTC(now)
	if registered.After(today) {
		registered = today
	}
	out := make([]DayEntry, 0, int(today.Sub(registered)/(24*time.Hour))+1)
	for day := registered; !day.After(today); day = day.AddDate(0, 0, 1) {
		out = append(out, DayEntry{
			Date:   day.Format("2006-01-02"),
			Active: visited[day],
		})
	}
	return out
}
