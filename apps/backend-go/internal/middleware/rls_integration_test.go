//go:build integration

package middleware

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

// TestMessengerRLSIsolation requires a PostgreSQL database with the messenger
// migrations applied and is intentionally excluded from the default unit suite.
// Run with:
//
// DATABASE_URL_TEST=postgres://... go test -tags=integration ./internal/middleware -run TestMessengerRLSIsolation
func TestMessengerRLSIsolation(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL_TEST")
	if dsn == "" {
		t.Skip("DATABASE_URL_TEST is not set")
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}

	user1 := uuid.New()
	user2 := uuid.New()
	conversationID := uuid.New()
	clientID := fmt.Sprintf("rls-integration-%s", uuid.NewString())

	// users has no messenger RLS policy; fixture creation is isolated by random
	// IDs and cleaned by the users FK cascade in the defer below.
	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, username, email, password_hash)
		VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)
	`, user1, "rls_"+user1.String()[:8], user1.String()+"@invalid.test", "fixture",
		user2, "rls_"+user2.String()[:8], user2.String()+"@invalid.test", "fixture")
	if err != nil {
		t.Fatalf("insert users: %v", err)
	}
	defer func() {
		// ON DELETE CASCADE removes the conversation, membership, and message
		// fixture without requiring a privileged bypass of FORCE ROW LEVEL SECURITY.
		_, _ = db.ExecContext(ctx, "DELETE FROM users WHERE id IN ($1, $2)", user1, user2)
	}()

	// User 1 creates a conversation and both memberships in one request-shaped
	// transaction. SET LOCAL must be set before every query using that tx.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin user 1 transaction: %v", err)
	}
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, true)", user1); err != nil {
		t.Fatalf("bind user 1: %v", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO chat_conversations (id) VALUES ($1)", conversationID); err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2)", conversationID, user1); err != nil {
		t.Fatalf("insert user 1 membership: %v", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2)", conversationID, user2); err != nil {
		t.Fatalf("insert user 2 membership: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO chat_messages (conversation_id, sender_user_id, content, client_id)
		VALUES ($1, $2, $3, $4)
	`, conversationID, user1, "server-encrypted fixture", clientID); err != nil {
		t.Fatalf("insert message: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}

	assertVisible := func(user uuid.UUID, want int) {
		t.Helper()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatalf("begin read transaction for %s: %v", user, err)
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, true)", user); err != nil {
			t.Fatalf("bind read transaction for %s: %v", user, err)
		}
		var got int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM chat_messages WHERE conversation_id = $1", conversationID).Scan(&got); err != nil {
			t.Fatalf("count messages for %s: %v", user, err)
		}
		if got != want {
			t.Errorf("user %s saw %d messages, want %d", user, got, want)
		}
	}

	assertVisible(user1, 1)
	assertVisible(user2, 1)

	// A third user must see zero rows. This catches accidental session-level
	// binding and proves the setting does not leak from user 1 or user 2.
	user3 := uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, username, email, password_hash)
		VALUES ($1, $2, $3, $4)
	`, user3, "rls_"+user3.String()[:8], user3.String()+"@invalid.test", "fixture")
	if err != nil {
		t.Fatalf("insert user 3: %v", err)
	}
	defer db.ExecContext(ctx, "DELETE FROM users WHERE id = $1", user3)
	assertVisible(user3, 0)
}
