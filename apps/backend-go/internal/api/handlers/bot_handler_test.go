package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── Test Helpers ────────────────────────────────────────────────────────────

func setupBotHandler(t *testing.T) (*BotHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

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

	handler := NewBotHandler(db)
	handler.SetBotManager(nil) // Skip bot manager loading in tests
	return handler, mock
}

func ownerClaims() *auth.Claims {
	return &auth.Claims{UserID: "owner-1", Username: "owner", Domain: "localhost:8080"}
}

func botColumns() []string {
	return []string{"id", "owner_id", "username", "display_name", "avatar_url", "description", "lua_code", "token", "is_active", "created_at", "updated_at"}
}

func botRow(id, username string, isActive bool) *sqlmock.Rows {
	return sqlmock.NewRows(botColumns()).AddRow(
		id, "owner-1", username, "Test Bot "+username, nil, nil, "print('hello')", "token-"+id, isActive, time.Now(), time.Now(),
	)
}

// ─── Token Generation ────────────────────────────────────────────────────────

func TestGenerateBotToken_Length(t *testing.T) {
	token, err := generateBotToken()
	if err != nil {
		t.Fatalf("generateBotToken() error: %v", err)
	}
	if len(token) != 64 {
		t.Errorf("Expected 64 hex chars, got %d", len(token))
	}
}

func TestGenerateBotToken_IsHex(t *testing.T) {
	token, err := generateBotToken()
	if err != nil {
		t.Fatalf("generateBotToken() error: %v", err)
	}
	// Validate hex by trying to decode
	for _, c := range token {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("Token contains non-hex character: %c", c)
		}
	}
}

func TestGenerateBotToken_Uniqueness(t *testing.T) {
	tokens := make(map[string]bool)
	for i := 0; i < 100; i++ {
		token, err := generateBotToken()
		if err != nil {
			t.Fatalf("generateBotToken() error at iter %d: %v", i, err)
		}
		if tokens[token] {
			t.Fatalf("Duplicate token at iter %d", i)
		}
		tokens[token] = true
	}
}

func TestGenerateBotToken_NotPredictable(t *testing.T) {
	tok1, _ := generateBotToken()
	tok2, _ := generateBotToken()
	if tok1 == tok2 {
		t.Fatal("Consecutive tokens are identical")
	}
}

// ─── getUserIDFromContext ────────────────────────────────────────────────────

func TestGetUserIDFromContext_ValidClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("claims", &auth.Claims{UserID: "test-user-123"})

	userID, err := getUserIDFromContext(c)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if userID != "test-user-123" {
		t.Errorf("expected 'test-user-123', got '%s'", userID)
	}
}

func TestGetUserIDFromContext_NoClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)

	_, err := getUserIDFromContext(c)
	if err == nil {
		t.Fatal("expected error for missing claims")
	}
}

func TestGetUserIDFromContext_WrongType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("claims", "not-claims")

	_, err := getUserIDFromContext(c)
	if err == nil {
		t.Fatal("expected error for wrong type")
	}
}

func TestGetUserIDFromContext_NilClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("claims", nil)

	_, err := getUserIDFromContext(c)
	if err == nil {
		t.Fatal("expected error for nil claims")
	}
}

func TestGetUserIDFromContext_EmptyUserID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("claims", &auth.Claims{UserID: ""})

	userID, err := getUserIDFromContext(c)
	if err != nil {
		t.Fatalf("should not error for empty user ID: %v", err)
	}
	if userID != "" {
		t.Errorf("expected empty, got '%s'", userID)
	}
}

// ─── CreateBot ───────────────────────────────────────────────────────────────

func TestCreateBot_Success(t *testing.T) {
	h, mock := setupBotHandler(t)

	body := models.CreateBotRequest{
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode:     "print('hello')",
	}

	// Check bot count (0 < 5)
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM bots WHERE owner_id`).
		WithArgs("owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	// Check username exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots WHERE username`).
		WithArgs("testbot.bot").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	// INSERT bot
	mock.ExpectQuery(`INSERT INTO bots`).
		WithArgs("owner-1", "testbot.bot", "Test Bot", nil, nil, "print('hello')", sqlmock.AnyArg()).
		WillReturnRows(botRow("bot-1", "testbot.bot", true))

	// INSERT user record for bot
	mock.ExpectExec(`INSERT INTO users`).
		WithArgs("bot-1", "testbot.bot", "bot_testbot.bot@localhost").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// INSERT chat_user_keys
	mock.ExpectExec(`INSERT INTO chat_user_keys`).
		WithArgs("bot-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newPOSTContext("/api/v1/bots", body, ownerClaims(), nil)
	h.CreateBot(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var bot models.Bot
	if err := json.Unmarshal(w.Body.Bytes(), &bot); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if bot.Username != "testbot.bot" {
		t.Errorf("expected username 'testbot.bot', got '%s'", bot.Username)
	}
}

func TestCreateBot_MaxBotsReached(t *testing.T) {
	h, mock := setupBotHandler(t)
	body := models.CreateBotRequest{Username: "testbot", DisplayName: "TB", LuaCode: ""}

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM bots WHERE owner_id`).
		WithArgs("owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(5))

	c, w := newPOSTContext("/api/v1/bots", body, ownerClaims(), nil)
	h.CreateBot(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateBot_UsernameTaken(t *testing.T) {
	h, mock := setupBotHandler(t)
	body := models.CreateBotRequest{Username: "testbot", DisplayName: "TB", LuaCode: ""}

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM bots WHERE owner_id`).
		WithArgs("owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots WHERE username`).
		WithArgs("testbot.bot").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/bots", body, ownerClaims(), nil)
	h.CreateBot(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateBot_LuaCodeTooLarge(t *testing.T) {
	h, mock := setupBotHandler(t)
	bigCode := make([]byte, 10241)
	for i := range bigCode {
		bigCode[i] = 'x'
	}
	body := models.CreateBotRequest{
		Username:    "testbot",
		DisplayName: "TB",
		LuaCode:     string(bigCode),
	}

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM bots WHERE owner_id`).
		WithArgs("owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots WHERE username`).
		WithArgs("testbot.bot").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/bots", body, ownerClaims(), nil)
	h.CreateBot(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for large code, got %d", w.Code)
	}
}

func TestCreateBot_Unauthenticated(t *testing.T) {
	h, _ := setupBotHandler(t)
	body := models.CreateBotRequest{Username: "testbot", DisplayName: "TB", LuaCode: ""}

	c, w := newPOSTContext("/api/v1/bots", body, nil, nil)
	h.CreateBot(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestCreateBot_AutoAddsBotSuffix(t *testing.T) {
	h, mock := setupBotHandler(t)
	body := models.CreateBotRequest{
		Username:    "already.bot",
		DisplayName: "Test",
		LuaCode:     "",
	}

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM bots WHERE owner_id`).
		WithArgs("owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	// Should NOT add .bot suffix since it already has it
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots WHERE username`).
		WithArgs("already.bot").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectQuery(`INSERT INTO bots`).
		WithArgs("owner-1", "already.bot", "Test", nil, nil, "", sqlmock.AnyArg()).
		WillReturnRows(botRow("bot-1", "already.bot", true))

	mock.ExpectExec(`INSERT INTO users`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectExec(`INSERT INTO chat_user_keys`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newPOSTContext("/api/v1/bots", body, ownerClaims(), nil)
	h.CreateBot(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── GetBots ─────────────────────────────────────────────────────────────────

func TestGetBots_Success_ReturnsList(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT id, owner_id, username.*FROM bots.*WHERE owner_id.*ORDER BY created_at DESC`).
		WithArgs("owner-1").
		WillReturnRows(botRow("bot-1", "bot1.bot", true).AddRow(
			"bot-2", "owner-1", "bot2.bot", "Bot 2", nil, nil, "print('2')", "tok-2", false, time.Now(), time.Now(),
		))

	c, w := newGETContextWithClaims("/api/v1/bots", nil, ownerClaims())
	h.GetBots(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var bots []models.Bot
	if err := json.Unmarshal(w.Body.Bytes(), &bots); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(bots) != 2 {
		t.Errorf("expected 2 bots, got %d", len(bots))
	}
}

func TestGetBots_EmptyList(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT id, owner_id, username.*FROM bots.*WHERE owner_id`).
		WithArgs("owner-1").
		WillReturnRows(sqlmock.NewRows(botColumns()))

	c, w := newGETContextWithClaims("/api/v1/bots", nil, ownerClaims())
	h.GetBots(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	// nil is valid JSON for empty list in Go
	var bots []models.Bot
	json.Unmarshal(w.Body.Bytes(), &bots)
	if len(bots) != 0 {
		t.Errorf("expected empty list, got %d bots", len(bots))
	}
}

func TestGetBots_Unauthenticated(t *testing.T) {
	h, _ := setupBotHandler(t)
	c, w := newGETContextWithClaims("/api/v1/bots", nil, nil)
	h.GetBots(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGetBots_DBError(t *testing.T) {
	h, mock := setupBotHandler(t)
	mock.ExpectQuery(`SELECT id, owner_id, username.*FROM bots.*WHERE owner_id`).
		WithArgs("owner-1").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newGETContextWithClaims("/api/v1/bots", nil, ownerClaims())
	h.GetBots(c)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── GetBot ──────────────────────────────────────────────────────────────────

func TestGetBot_Success(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT id, owner_id, username.*FROM bots.*WHERE id = \$1 AND owner_id = \$2`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(botRow("bot-1", "mybot.bot", true))

	c, w := newGETContextWithClaims("/api/v1/bots/bot-1", map[string]string{"id": "bot-1"}, ownerClaims())
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBot(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetBot_NotFound(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT id, owner_id, username.*FROM bots.*WHERE id = \$1 AND owner_id = \$2`).
		WithArgs("bot-1", "owner-1").
		WillReturnError(sql.ErrNoRows)

	c, w := newGETContextWithClaims("/api/v1/bots/bot-1", nil, ownerClaims())
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBot(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetBot_Unauthenticated(t *testing.T) {
	h, _ := setupBotHandler(t)
	c, w := newGETContextWithClaims("/api/v1/bots/bot-1", nil, nil)
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBot(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── UpdateBot ───────────────────────────────────────────────────────────────

func TestUpdateBot_Success_UpdateDisplayName(t *testing.T) {
	h, mock := setupBotHandler(t)
	newName := "Updated Name"

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots WHERE id = \$1 AND owner_id = \$2\)`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	body := map[string]interface{}{"display_name": newName}
	// Dynamic update: SET display_name = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3
	mock.ExpectQuery(`(?s).*UPDATE bots SET.*`).
		WithArgs(newName, "bot-1", "owner-1").
		WillReturnRows(botRow("bot-1", "mybot.bot", true))

	c, w := newPUTContext("/api/v1/bots/bot-1", body, ownerClaims(), map[string]string{"id": "bot-1"})
	h.UpdateBot(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateBot_NotFound(t *testing.T) {
	h, mock := setupBotHandler(t)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPUTContext("/api/v1/bots/bot-1", map[string]interface{}{"display_name": "X"}, ownerClaims(), map[string]string{"id": "bot-1"})
	h.UpdateBot(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdateBot_LuaCodeTooLarge(t *testing.T) {
	h, mock := setupBotHandler(t)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	bigCode := make([]byte, 10241)
	for i := range bigCode {
		bigCode[i] = 'x'
	}
	strCode := string(bigCode)
	c, w := newPUTContext("/api/v1/bots/bot-1", map[string]interface{}{"lua_code": strCode}, ownerClaims(), map[string]string{"id": "bot-1"})
	h.UpdateBot(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── DeleteBot ───────────────────────────────────────────────────────────────

func TestDeleteBot_Success(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectExec(`DELETE FROM bots WHERE id = \$1 AND owner_id = \$2`).
		WithArgs("bot-1", "owner-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newDELETEPContext("/api/v1/bots/bot-1", nil, map[string]string{"id": "bot-1"})
	c.Set("claims", ownerClaims())
	h.DeleteBot(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteBot_NotFound(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectExec(`DELETE FROM bots WHERE id = \$1 AND owner_id = \$2`).
		WithArgs("bot-1", "owner-1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newDELETEPContext("/api/v1/bots/bot-1", nil, map[string]string{"id": "bot-1"})
	c.Set("claims", ownerClaims())
	h.DeleteBot(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeleteBot_Unauthenticated(t *testing.T) {
	h, _ := setupBotHandler(t)
	c, w := newDELETEPContext("/api/v1/bots/bot-1", nil, map[string]string{"id": "bot-1"})
	h.DeleteBot(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── ToggleBot ───────────────────────────────────────────────────────────────

func TestToggleBot_Success_ToggleOff(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`UPDATE bots SET is_active = NOT is_active, updated_at = NOW\(\) WHERE id = \$1 AND owner_id = \$2 RETURNING`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(botRow("bot-1", "mybot.bot", false))

	c, w := newPOSTContext("/api/v1/bots/bot-1/toggle", nil, ownerClaims(), map[string]string{"id": "bot-1"})
	h.ToggleBot(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var bot models.Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	if bot.IsActive {
		t.Error("expected bot to be deactivated")
	}
}

func TestToggleBot_NotFound(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`UPDATE bots SET is_active = NOT is_active.*WHERE id = \$1 AND owner_id = \$2 RETURNING`).
		WithArgs("bot-1", "owner-1").
		WillReturnError(sql.ErrNoRows)

	c, w := newPOSTContext("/api/v1/bots/bot-1/toggle", nil, ownerClaims(), map[string]string{"id": "bot-1"})
	h.ToggleBot(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestToggleBot_Unauthenticated(t *testing.T) {
	h, _ := setupBotHandler(t)
	c, w := newPOSTContext("/api/v1/bots/bot-1/toggle", nil, nil, map[string]string{"id": "bot-1"})
	h.ToggleBot(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── GetBotLogs ──────────────────────────────────────────────────────────────

func TestGetBotLogs_Success_ReturnsLogs(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots WHERE id = \$1 AND owner_id = \$2\)`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	now := time.Now()
	mock.ExpectQuery(`SELECT id, bot_id, level, message, context, created_at FROM bot_logs WHERE bot_id = \$1 ORDER BY created_at ASC LIMIT 100`).
		WithArgs("bot-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "bot_id", "level", "message", "context", "created_at"}).
			AddRow("log-1", "bot-1", "info", "Started", nil, now).
			AddRow("log-2", "bot-1", "error", "Something went wrong", `{"detail":"err"}`, now))

	c, w := newGETContextWithClaims("/api/v1/bots/bot-1/logs", nil, ownerClaims())
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBotLogs(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var logs []models.BotLog
	if err := json.Unmarshal(w.Body.Bytes(), &logs); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("expected 2 logs, got %d", len(logs))
	}
	if logs[0].Level != "info" {
		t.Errorf("expected level 'info', got '%s'", logs[0].Level)
	}
	if logs[1].Level != "error" {
		t.Errorf("expected level 'error', got '%s'", logs[1].Level)
	}
}

func TestGetBotLogs_EmptyLogs(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT id, bot_id, level, message, context, created_at FROM bot_logs`).
		WithArgs("bot-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "bot_id", "level", "message", "context", "created_at"}))

	c, w := newGETContextWithClaims("/api/v1/bots/bot-1/logs", nil, ownerClaims())
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBotLogs(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var logs []models.BotLog
	json.Unmarshal(w.Body.Bytes(), &logs)
	if len(logs) != 0 {
		t.Errorf("expected empty list, got %d", len(logs))
	}
}

func TestGetBotLogs_BotNotOwned(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newGETContextWithClaims("/api/v1/bots/bot-1/logs", nil, ownerClaims())
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBotLogs(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ─── GetBotStats ─────────────────────────────────────────────────────────────

func TestGetBotStats_Success_ReturnsStats(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	today := time.Now()
	mock.ExpectQuery(`SELECT id, bot_id, messages_sent, messages_received, commands_processed, errors_count, date FROM bot_stats WHERE bot_id = \$1 AND date >= \$2 ORDER BY date DESC`).
		WithArgs("bot-1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "bot_id", "messages_sent", "messages_received", "commands_processed", "errors_count", "date"}).
			AddRow("stat-1", "bot-1", 10, 5, 3, 1, today))

	c, w := newGETContextWithClaims("/api/v1/bots/bot-1/stats", nil, ownerClaims())
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBotStats(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var stats []models.BotStats
	if err := json.Unmarshal(w.Body.Bytes(), &stats); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(stats) != 1 {
		t.Errorf("expected 1 stat entry, got %d", len(stats))
	}
	if stats[0].MessagesSent != 10 {
		t.Errorf("expected 10 messages sent, got %d", stats[0].MessagesSent)
	}
}

func TestGetBotStats_Unauthenticated(t *testing.T) {
	h, _ := setupBotHandler(t)
	c, w := newGETContextWithClaims("/api/v1/bots/bot-1/stats", nil, nil)
	c.Params = []gin.Param{{Key: "id", Value: "bot-1"}}
	h.GetBotStats(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── ClearBotLogs ────────────────────────────────────────────────────────────

func TestClearBotLogs_Success(t *testing.T) {
	h, mock := setupBotHandler(t)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM bots`).
		WithArgs("bot-1", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(`DELETE FROM bot_logs WHERE bot_id = \$1`).
		WithArgs("bot-1").
		WillReturnResult(sqlmock.NewResult(0, 5))

	c, w := newDELETEPContext("/api/v1/bots/bot-1/logs", nil, map[string]string{"id": "bot-1"})
	c.Set("claims", ownerClaims())
	h.ClearBotLogs(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestClearBotLogs_Unauthenticated(t *testing.T) {
	h, _ := setupBotHandler(t)
	c, w := newDELETEPContext("/api/v1/bots/bot-1/logs", nil, map[string]string{"id": "bot-1"})
	h.ClearBotLogs(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
