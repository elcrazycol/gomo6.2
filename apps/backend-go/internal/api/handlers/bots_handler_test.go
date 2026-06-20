package handlers

import (
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

func setupBotsHandler(t *testing.T) (*BotsHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})
	return NewBotsHandler(db), mock
}

func TestGenerateBotToken(t *testing.T) {
	rawToken, hash, err := generateBotToken()
	if err != nil {
		t.Fatalf("generateBotToken failed: %v", err)
	}
	if rawToken == "" {
		t.Error("rawToken should not be empty")
	}
	if hash == "" {
		t.Error("hash should not be empty")
	}
	if len(rawToken) != 74 { // "gomo6_bot_" + 64 hex chars
		t.Errorf("rawToken length: got %d, want 74", len(rawToken))
	}
	if len(hash) != 64 { // SHA256 hex
		t.Errorf("hash length: got %d, want 64", len(hash))
	}

	rawToken2, _, err := generateBotToken()
	if err != nil {
		t.Fatalf("generateBotToken failed: %v", err)
	}
	if rawToken == rawToken2 {
		t.Error("two calls should produce different tokens")
	}
}

func TestBotUsernameRegex(t *testing.T) {
	tests := []struct {
		name  string
		input string
		match bool
	}{
		{"valid simple", "my_bot", true},
		{"valid with numbers", "bot123_bot", true},
		{"valid uppercase", "MyBot_bot", true},
		{"invalid no suffix", "mybot", false},
		{"invalid dash", "my-bot_bot", false},
		{"invalid space", "my bot_bot", false},
		{"invalid just _bot", "_bot", false},
		{"invalid empty", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := botUsernameRegex.MatchString(tt.input)
			if got != tt.match {
				t.Errorf("botUsernameRegex(%q) = %v, want %v", tt.input, got, tt.match)
			}
		})
	}
}

func TestListBots_Success(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	now := time.Now()
	botRows := sqlmock.NewRows([]string{"id", "owner_id", "user_id", "username", "display_name", "description", "is_active", "created_at", "updated_at"}).
		AddRow("bot-1", "user-123", "bot-1", "test_bot", nil, nil, true, now, now)
	mock.ExpectQuery(`SELECT (.+) FROM bots WHERE owner_id = \$1`).WithArgs("user-123").WillReturnRows(botRows)

	c, w := newPOSTContext("/api/v1/bots", nil, claims, nil)
	c.Request.Method = "GET"

	handler.ListBots(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestListBots_Empty(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	rows := sqlmock.NewRows([]string{"id", "owner_id", "user_id", "username", "display_name", "description", "is_active", "created_at", "updated_at"})
	mock.ExpectQuery(`SELECT (.+) FROM bots WHERE owner_id = \$1`).WithArgs("user-123").WillReturnRows(rows)

	c, w := newPOSTContext("/api/v1/bots", nil, claims, nil)
	c.Request.Method = "GET"

	handler.ListBots(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestCreateBot_InvalidUsername(t *testing.T) {
	handler, _ := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/bots", map[string]interface{}{
		"username":     "invalid-name",
		"display_name": "Invalid Bot",
	}, claims, nil)

	handler.CreateBot(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestCreateBot_InvalidJSON(t *testing.T) {
	handler, _ := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/bots", nil, claims, nil)

	handler.CreateBot(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetBot_NotFound(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT (.+) FROM bots WHERE id (.+) AND owner_id").
		WithArgs("bot-999", "user-123").
		WillReturnRows(sqlmock.NewRows(nil))

	c, w := newPOSTContext("/api/v1/bots/bot-999", nil, claims, map[string]string{"id": "bot-999"})
	c.Request.Method = "GET"

	handler.GetBot(c)

	if w.Code != 404 {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetBot_Success(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	now := time.Now()
	mock.ExpectQuery("SELECT (.+) FROM bots WHERE id (.+) AND owner_id").
		WithArgs("bot-1", "user-123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_id", "user_id", "username", "display_name", "description", "is_active", "created_at", "updated_at"}).
			AddRow("bot-1", "user-123", "bot-1", "test_bot", nil, nil, true, now, now))

	c, w := newPOSTContext("/api/v1/bots/bot-1", nil, claims, map[string]string{"id": "bot-1"})
	c.Request.Method = "GET"

	handler.GetBot(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpdateBot_NotFound(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectExec("UPDATE bots SET display_name").WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newPOSTContext("/api/v1/bots/bot-999", map[string]interface{}{
		"display_name": "Updated",
	}, claims, map[string]string{"id": "bot-999"})

	handler.UpdateBot(c)

	if w.Code != 404 {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpdateBot_Success(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectExec("UPDATE bots SET display_name").WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newPOSTContext("/api/v1/bots/bot-1", map[string]interface{}{
		"display_name": "Updated",
	}, claims, map[string]string{"id": "bot-1"})

	handler.UpdateBot(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteBot_NotFound(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT user_id FROM bots WHERE id").WithArgs("bot-999", "user-123").
		WillReturnRows(sqlmock.NewRows(nil))

	c, w := newPOSTContext("/api/v1/bots/bot-999", nil, claims, map[string]string{"id": "bot-999"})

	handler.DeleteBot(c)

	if w.Code != 404 {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteBot_Success(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT user_id FROM bots WHERE id").WithArgs("bot-1", "user-123").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("bot-1"))
	mock.ExpectExec("DELETE FROM bots WHERE id").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM users WHERE id").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/bots/bot-1", nil, claims, map[string]string{"id": "bot-1"})

	handler.DeleteBot(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestToggleBot_NotFound(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("UPDATE bots SET is_active").WithArgs("bot-999", "user-123").
		WillReturnRows(sqlmock.NewRows(nil))

	c, w := newPOSTContext("/api/v1/bots/bot-999/toggle", nil, claims, map[string]string{"id": "bot-999"})

	handler.ToggleBot(c)

	if w.Code != 404 {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestToggleBot_Success(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("UPDATE bots SET is_active").WithArgs("bot-1", "user-123").
		WillReturnRows(sqlmock.NewRows([]string{"is_active"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/bots/bot-1/toggle", nil, claims, map[string]string{"id": "bot-1"})

	handler.ToggleBot(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestRegenerateToken_NotFound(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("UPDATE bots SET token_hash").WithArgs(sqlmock.AnyArg(), "bot-999", "user-123").
		WillReturnRows(sqlmock.NewRows(nil))

	c, w := newPOSTContext("/api/v1/bots/bot-999/regenerate-token", nil, claims, map[string]string{"id": "bot-999"})

	handler.RegenerateToken(c)

	if w.Code != 404 {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestRegenerateToken_Success(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	now := time.Now()
	mock.ExpectQuery("UPDATE bots SET token_hash").WithArgs(sqlmock.AnyArg(), "bot-1", "user-123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_id", "user_id", "username", "display_name", "description", "is_active", "created_at", "updated_at"}).
			AddRow("bot-1", "user-123", "bot-1", "test_bot", nil, nil, true, now, now))

	c, w := newPOSTContext("/api/v1/bots/bot-1/regenerate-token", nil, claims, map[string]string{"id": "bot-1"})

	handler.RegenerateToken(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestListBots_DBError(t *testing.T) {
	handler, mock := setupBotsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT (.+) FROM bots WHERE owner_id").WithArgs("user-123").
		WillReturnError(sql.ErrConnDone)

	c, w := newPOSTContext("/api/v1/bots", nil, claims, nil)
	c.Request.Method = "GET"

	handler.ListBots(c)

	if w.Code != 500 {
		t.Errorf("expected 500, got %d", w.Code)
	}
}
