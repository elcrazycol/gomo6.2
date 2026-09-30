package database

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// testSchemaPublicIDs is the scratch schema the migration is applied to, so this
// test never mutates the shared test database's public schema. Every statement
// runs in one transaction that is rolled back at the end — DDL in PostgreSQL is
// transactional, so the schema and all its objects simply disappear.
const testSchemaPublicIDs = "publicid_test"

// usersFixtureDDL mirrors every column the profiles view references (091) —
// without them the view creation in the migration fails.
const usersFixtureDDL = `
	CREATE TABLE users (
		id                  UUID PRIMARY KEY,
		username            TEXT NOT NULL,
		display_name        TEXT,
		email               TEXT,
		password_hash       TEXT,
		domain              TEXT,
		avatar_url          TEXT,
		bio                 TEXT,
		bio_json            JSONB,
		garma               INTEGER,
		post_count          INTEGER,
		thread_count        INTEGER,
		wall_post_count     INTEGER,
		comment_count       INTEGER,
		likes_received_count INTEGER,
		likes_given_count   INTEGER,
		drops               INTEGER,
		wallet_address      TEXT,
		is_remote           BOOLEAN,
		is_anonymous        BOOLEAN,
		is_online           BOOLEAN,
		last_seen_at        TIMESTAMPTZ,
		account_number      TEXT,
		search_vector       TEXT,
		nickname_emoji_id   UUID,
		created_at          TIMESTAMPTZ DEFAULT NOW(),
		updated_at          TIMESTAMPTZ DEFAULT NOW()
	)`

// publicIDsMigrationSQL reads the real migration file under test.
func publicIDsMigrationSQL(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "migrations", "128_public_ids.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	return string(raw)
}

// applyPublicIDsMigration opens an isolated scratch schema on the test database
// and applies the real migration inside a transaction the caller must roll back.
func applyPublicIDsMigration(t *testing.T, schema string) *txHelper {
	t.Helper()
	db := requireTestDB(t)

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })

	h := &txHelper{t: t, tx: tx}
	// The migration grants on the view TO gomo6; create the role when it is
	// missing, without letting the (possibly duplicate) error abort the tx.
	h.exec("SAVEPOINT pre_role")
	if _, err := tx.Exec("CREATE ROLE gomo6"); err != nil {
		h.exec("ROLLBACK TO SAVEPOINT pre_role")
	}
	h.exec("CREATE SCHEMA " + schema)
	h.exec("SET LOCAL search_path TO " + schema)
	return h
}

type txHelper struct {
	t  *testing.T
	tx *sql.Tx
}

func (h *txHelper) exec(sql string) {
	h.t.Helper()
	if _, err := h.tx.Exec(sql); err != nil {
		h.t.Fatalf("exec failed: %v\nSQL: %s", err, sql)
	}
}

func (h *txHelper) queryRow(sql string, args ...any) *sql.Row {
	h.t.Helper()
	return h.tx.QueryRow(sql, args...)
}

// TestPublicIDsMigration applies the real 128_public_ids.sql to a non-empty
// fixture and asserts the invariants it promises:
//   - users нумеруются с базы 10, threads — с 100, profile_wall_posts — с 1;
//   - порядок номеров = created_at (старейший получает самый низкий номер);
//   - новый INSERT продолжает MAX+1 (setval), а не уходит в базу;
//   - public_id NOT NULL, уникален и с DEFAULT на sequence;
//   - profiles-вью отдаёт public_id (иначе джойны его не увидят).
func TestPublicIDsMigration(t *testing.T) {
	h := applyPublicIDsMigration(t, testSchemaPublicIDs)

	h.exec(usersFixtureDDL)
	h.exec(`CREATE TABLE threads (id UUID PRIMARY KEY, created_at TIMESTAMPTZ)`)
	h.exec(`CREATE TABLE profile_wall_posts (id UUID PRIMARY KEY, created_at TIMESTAMPTZ)`)

	// Oldest must get the lowest number, so order by created_at — not by id.
	h.exec(`
		INSERT INTO users (id, username, created_at) VALUES
		('00000000-0000-0000-0000-0000000000a1', 'newest', '2022-01-01'),
		('00000000-0000-0000-0000-0000000000a2', 'oldest', '2020-01-01'),
		('00000000-0000-0000-0000-0000000000a3', 'middle', '2021-01-01')`)
	h.exec(`
		INSERT INTO threads (id, created_at) VALUES
		('00000000-0000-0000-0000-0000000000b1', '2020-01-01'),
		('00000000-0000-0000-0000-0000000000b2', '2021-01-01')`)
	h.exec(`
		INSERT INTO profile_wall_posts (id, created_at) VALUES
		('00000000-0000-0000-0000-0000000000c1', '2020-01-01'),
		('00000000-0000-0000-0000-0000000000c2', '2021-01-01')`)

	h.exec(publicIDsMigrationSQL(t))

	// ── Backfill: order by created_at, per-line base ────────────────────────
	var oldestID string
	var oldestPublicID int64
	if err := h.queryRow(`SELECT id, public_id FROM users ORDER BY created_at, id LIMIT 1`).
		Scan(&oldestID, &oldestPublicID); err != nil {
		t.Fatalf("query oldest user: %v", err)
	}
	if oldestID != "00000000-0000-0000-0000-0000000000a2" {
		t.Fatalf("oldest user mismatch: got %s", oldestID)
	}
	if oldestPublicID != 10 {
		t.Errorf("oldest user public_id = %d, want 10 (users base)", oldestPublicID)
	}

	for _, tc := range []struct {
		table string
		base  int64
		rows  int64
	}{
		{"users", 10, 3},
		{"threads", 100, 2},
		{"profile_wall_posts", 1, 2},
	} {
		var min, max int64
		var count int
		if err := h.queryRow(`SELECT MIN(public_id), MAX(public_id), COUNT(*) FROM `+tc.table).
			Scan(&min, &max, &count); err != nil {
			t.Fatalf("aggregate %s: %v", tc.table, err)
		}
		if int64(count) != tc.rows {
			t.Errorf("%s: %d rows, want %d", tc.table, count, tc.rows)
		}
		if min != tc.base {
			t.Errorf("%s: MIN(public_id) = %d, want base %d (reserved band must stay unreachable)", tc.table, min, tc.base)
		}
		if want := tc.base + tc.rows - 1; max != want {
			t.Errorf("%s: MAX(public_id) = %d, want %d", tc.table, max, want)
		}
	}

	// ── Column contract: NOT NULL + DEFAULT on the sequence ─────────────────
	for _, table := range []string{"users", "threads", "profile_wall_posts"} {
		var isNullable, columnDefault string
		if err := h.queryRow(`
			SELECT is_nullable, COALESCE(column_default, '')
			FROM information_schema.columns
			WHERE table_schema = $1 AND table_name = $2 AND column_name = 'public_id'`,
			testSchemaPublicIDs, table).Scan(&isNullable, &columnDefault); err != nil {
			t.Fatalf("inspect %s.public_id: %v", table, err)
		}
		if isNullable != "NO" {
			t.Errorf("%s.public_id is_nullable = %q, want NO", table, isNullable)
		}
		if columnDefault == "" {
			t.Errorf("%s.public_id has no DEFAULT — new rows would fail NOT NULL", table)
		}
	}

	// ── New inserts continue MAX+1 (setval ran) ─────────────────────────────
	h.exec(`INSERT INTO users (id, username, created_at)
		VALUES ('00000000-0000-0000-0000-0000000000a4', 'fresh', NOW())`)
	h.exec(`INSERT INTO threads (id, created_at)
		VALUES ('00000000-0000-0000-0000-0000000000b3', NOW())`)
	h.exec(`INSERT INTO profile_wall_posts (id, created_at)
		VALUES ('00000000-0000-0000-0000-0000000000c3', NOW())`)

	for _, tc := range []struct {
		table string
		id    string
		want  int64
	}{
		{"users", "00000000-0000-0000-0000-0000000000a4", 13},
		{"threads", "00000000-0000-0000-0000-0000000000b3", 102},
		{"profile_wall_posts", "00000000-0000-0000-0000-0000000000c3", 3},
	} {
		var got int64
		if err := h.queryRow(`SELECT public_id FROM `+tc.table+` WHERE id = $1`, tc.id).Scan(&got); err != nil {
			t.Fatalf("query fresh %s: %v", tc.table, err)
		}
		if got != tc.want {
			t.Errorf("new %s public_id = %d, want %d (setval must continue after backfill)", tc.table, got, tc.want)
		}
	}

	// ── Unique index present on every numbered table ───────────────────────
	for _, tc := range []struct{ table, index string }{
		{"users", "idx_users_public_id"},
		{"threads", "idx_threads_public_id"},
		{"profile_wall_posts", "idx_profile_wall_posts_public_id"},
	} {
		var found int
		if err := h.queryRow(`
			SELECT COUNT(*) FROM pg_indexes
			WHERE schemaname = $1 AND tablename = $2 AND indexname = $3`,
			testSchemaPublicIDs, tc.table, tc.index).Scan(&found); err != nil {
			t.Fatalf("query index %s: %v", tc.index, err)
		}
		if found != 1 {
			t.Errorf("unique index %s missing on %s", tc.index, tc.table)
		}
	}

	// ── profiles view exposes public_id (joins depend on it) ────────────────
	var viewPublicID int64
	if err := h.queryRow(`SELECT public_id FROM profiles WHERE id = '00000000-0000-0000-0000-0000000000a2'`).
		Scan(&viewPublicID); err != nil {
		t.Fatalf("query public_id through profiles view: %v", err)
	}
	if viewPublicID != 10 {
		t.Errorf("profiles view public_id = %d, want 10", viewPublicID)
	}
}

// TestPublicIDsMigration_EmptyTablesStartAtBase is the fresh-deployment case:
// with no rows to backfill, setval must NOT fire, so the very first insert lands
// exactly on the line's base (10 / 100 / 1) instead of base+1. This pins the
// one-shot decision — an off-by-one here would silently shift every future number.
func TestPublicIDsMigration_EmptyTablesStartAtBase(t *testing.T) {
	h := applyPublicIDsMigration(t, testSchemaPublicIDs+"_empty")

	h.exec(usersFixtureDDL)
	h.exec(`CREATE TABLE threads (id UUID PRIMARY KEY, created_at TIMESTAMPTZ)`)
	h.exec(`CREATE TABLE profile_wall_posts (id UUID PRIMARY KEY, created_at TIMESTAMPTZ)`)

	h.exec(publicIDsMigrationSQL(t))

	h.exec(`INSERT INTO users (id, username) VALUES ('00000000-0000-0000-0000-0000000000e1', 'first')`)
	h.exec(`INSERT INTO threads (id) VALUES ('00000000-0000-0000-0000-0000000000e2')`)
	h.exec(`INSERT INTO profile_wall_posts (id) VALUES ('00000000-0000-0000-0000-0000000000e3')`)

	for _, tc := range []struct {
		table string
		id    string
		want  int64
	}{
		{"users", "00000000-0000-0000-0000-0000000000e1", 10},
		{"threads", "00000000-0000-0000-0000-0000000000e2", 100},
		{"profile_wall_posts", "00000000-0000-0000-0000-0000000000e3", 1},
	} {
		var got int64
		if err := h.queryRow(`SELECT public_id FROM `+tc.table+` WHERE id = $1`, tc.id).Scan(&got); err != nil {
			t.Fatalf("query first %s: %v", tc.table, err)
		}
		if got != tc.want {
			t.Errorf("first %s public_id = %d, want base %d (setval must not fire on an empty table)", tc.table, got, tc.want)
		}
	}
}
