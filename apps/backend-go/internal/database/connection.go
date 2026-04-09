package database

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

func InitDB() (*sql.DB, error) {
	// For now, use environment variable or default
	databaseURL := getEnv("DATABASE_URL", "postgres://user:password@localhost/gomo6?sslmode=disable")
	
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	if err := ensureAppSchema(db); err != nil {
		return nil, fmt.Errorf("schema ensure failed: %w", err)
	}

	log.Println("Database connected successfully")
	return db, nil
}

// ensureAppSchema applies additive DDL so older local DBs match what the Go API and web app expect.
func ensureAppSchema(db *sql.DB) error {
	stmts := []string{
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio_json JSONB`,

		`ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_css TEXT`,
		`ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_icon_svg TEXT`,
		`ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_icon_fill TEXT`,
		`ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS username_icon_stroke TEXT`,
		`ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS profile_badge_text TEXT`,
		`ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS profile_badge_css TEXT`,

		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS visibility_profile BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS hide_messages_from_unregistered BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS hide_threads_from_unregistered BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS block_profile_visits_from_unregistered BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_search_by_username BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_search_by_id BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_search_by_secondary_id BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_private_messages BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS anonymous_mode BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_last_seen BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_profile_wall BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS allow_wall_posts_from_others BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_profile_stats BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS show_detailed_stats BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS stats_visibility JSONB DEFAULT '{}'::jsonb`,
	}
	for _, q := range stmts {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("%s: %w", q, err)
		}
	}
	return nil
}
