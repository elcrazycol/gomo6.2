package bots

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
	lua "github.com/yuin/gopher-lua"
)

// BotRuntime manages a single bot's Lua VM and execution
type BotRuntime struct {
	Bot       *models.Bot
	VM        *lua.LState
	DB        *sql.DB
	Redis     *redis.Client
	WSHub     *websocket.Hub
	mu        sync.Mutex
	isRunning bool
}

// BotManager manages all active bots
type BotManager struct {
	DB       *sql.DB
	Redis    *redis.Client
	WSHub    *websocket.Hub
	bots     map[string]*BotRuntime
	mu       sync.RWMutex
	ctx      context.Context
	cancel   context.CancelFunc
}

// BotEvent represents an event that bots can handle
type BotEvent struct {
	Type    string                 `json:"type"`
	Data    map[string]interface{} `json:"data"`
	UserID  string                 `json:"user_id"`
	Context map[string]interface{} `json:"context"`
}

// NewBotManager creates a new bot manager
func NewBotManager(db *sql.DB, redis *redis.Client, wsHub *websocket.Hub) *BotManager {
	ctx, cancel := context.WithCancel(context.Background())
	return &BotManager{
		DB:     db,
		Redis:  redis,
		WSHub:  wsHub,
		bots:   make(map[string]*BotRuntime),
		ctx:    ctx,
		cancel: cancel,
	}
}

// Start starts the bot manager and loads all active bots
func (bm *BotManager) Start() error {
	// Load all active bots from database
	rows, err := bm.DB.Query(`
		SELECT id, owner_id, username, display_name, avatar_url, description, lua_code, token, is_active, created_at, updated_at
		FROM bots
		WHERE is_active = true
	`)
	if err != nil {
		return fmt.Errorf("failed to load bots: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var bot models.Bot
		err := rows.Scan(
			&bot.ID, &bot.OwnerID, &bot.Username, &bot.DisplayName, &bot.AvatarURL,
			&bot.Description, &bot.LuaCode, &bot.Token, &bot.IsActive, &bot.CreatedAt, &bot.UpdatedAt,
		)
		if err != nil {
			log.Printf("Failed to scan bot: %v", err)
			continue
		}

		if err := bm.LoadBot(&bot); err != nil {
			log.Printf("Failed to load bot %s: %v", bot.Username, err)
		}
	}

	// Subscribe to bot events from Redis
	go bm.subscribeToEvents()

	log.Printf("Bot manager started with %d active bots", len(bm.bots))
	return nil
}

// Stop stops the bot manager and all bots
func (bm *BotManager) Stop() {
	bm.cancel()
	bm.mu.Lock()
	defer bm.mu.Unlock()

	for _, runtime := range bm.bots {
		runtime.Stop()
	}
	bm.bots = make(map[string]*BotRuntime)
}

// LoadBot loads a bot into the runtime
func (bm *BotManager) LoadBot(bot *models.Bot) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	// Check if bot is already loaded
	if _, exists := bm.bots[bot.ID]; exists {
		return fmt.Errorf("bot already loaded")
	}

	runtime := &BotRuntime{
		Bot:   bot,
		DB:    bm.DB,
		Redis: bm.Redis,
		WSHub: bm.WSHub,
	}

	if err := runtime.Init(); err != nil {
		return fmt.Errorf("failed to initialize bot: %w", err)
	}

	bm.bots[bot.ID] = runtime
	log.Printf("Loaded bot: %s (%s)", bot.Username, bot.ID)
	return nil
}

// UnloadBot unloads a bot from the runtime
func (bm *BotManager) UnloadBot(botID string) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if runtime, exists := bm.bots[botID]; exists {
		runtime.Stop()
		delete(bm.bots, botID)
		log.Printf("Unloaded bot: %s", botID)
	}
}

// ReloadBot reloads a bot (useful after code update)
func (bm *BotManager) ReloadBot(botID string) error {
	bm.UnloadBot(botID)

	var bot models.Bot
	err := bm.DB.QueryRow(`
		SELECT id, owner_id, username, display_name, avatar_url, description, lua_code, token, is_active, created_at, updated_at
		FROM bots
		WHERE id = $1
	`, botID).Scan(
		&bot.ID, &bot.OwnerID, &bot.Username, &bot.DisplayName, &bot.AvatarURL,
		&bot.Description, &bot.LuaCode, &bot.Token, &bot.IsActive, &bot.CreatedAt, &bot.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to load bot from database: %w", err)
	}

	if !bot.IsActive {
		return nil // Bot is disabled, don't load
	}

	return bm.LoadBot(&bot)
}

// subscribeToEvents subscribes to Redis pub/sub for bot events
func (bm *BotManager) subscribeToEvents() {
	pubsub := bm.Redis.Subscribe(bm.ctx, "bot:events")
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-bm.ctx.Done():
			return
		case msg := <-ch:
			var event BotEvent
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Printf("Failed to unmarshal bot event: %v", err)
				continue
			}

			bm.handleEvent(&event)
		}
	}
}

// handleEvent dispatches an event to all active bots
func (bm *BotManager) handleEvent(event *BotEvent) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	for _, runtime := range bm.bots {
		go runtime.HandleEvent(event)
	}
}

// Init initializes the bot runtime and Lua VM
func (br *BotRuntime) Init() error {
	br.mu.Lock()
	defer br.mu.Unlock()

	// Create new Lua state
	br.VM = lua.NewState()

	// Set up sandbox (disable dangerous functions)
	br.setupSandbox()

	// Register bot API functions
	br.registerBotAPI()

	// Load bot's Lua code
	if err := br.VM.DoString(br.Bot.LuaCode); err != nil {
		br.VM.Close()
		return fmt.Errorf("failed to load Lua code: %w", err)
	}

	br.isRunning = true
	return nil
}

// Stop stops the bot runtime
func (br *BotRuntime) Stop() {
	br.mu.Lock()
	defer br.mu.Unlock()

	if br.VM != nil {
		br.VM.Close()
		br.VM = nil
	}
	br.isRunning = false
}

// setupSandbox disables dangerous Lua functions
func (br *BotRuntime) setupSandbox() {
	// Disable dangerous modules
	br.VM.SetGlobal("io", lua.LNil)
	br.VM.SetGlobal("os", lua.LNil)
	br.VM.SetGlobal("debug", lua.LNil)
	br.VM.SetGlobal("package", lua.LNil)
	br.VM.SetGlobal("dofile", lua.LNil)
	br.VM.SetGlobal("loadfile", lua.LNil)
	br.VM.SetGlobal("load", lua.LNil)
}

// registerBotAPI registers bot API functions in Lua
func (br *BotRuntime) registerBotAPI() {
	botTable := br.VM.NewTable()

	// bot.log(level, message)
	botTable.RawSetString("log", br.VM.NewFunction(br.luaLog))

	// bot.sendWallComment(postId, content)
	botTable.RawSetString("sendWallComment", br.VM.NewFunction(br.luaSendWallComment))

	// bot.sendThreadPost(threadId, content)
	botTable.RawSetString("sendThreadPost", br.VM.NewFunction(br.luaSendThreadPost))

	// bot.getUser(userId)
	botTable.RawSetString("getUser", br.VM.NewFunction(br.luaGetUser))

	// bot.sleep(milliseconds)
	botTable.RawSetString("sleep", br.VM.NewFunction(br.luaSleep))

	br.VM.SetGlobal("bot", botTable)
}

// HandleEvent handles an event for this bot
func (br *BotRuntime) HandleEvent(event *BotEvent) {
	br.mu.Lock()
	defer br.mu.Unlock()

	if !br.isRunning {
		return
	}

	// Set timeout for execution (5 seconds)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	done := make(chan bool)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				br.logError(fmt.Sprintf("Panic in event handler: %v", r))
			}
			done <- true
		}()

		// Call appropriate Lua function based on event type
		switch event.Type {
		case "wall_post":
			br.callLuaFunction("onWallPost", event)
		case "wall_comment":
			br.callLuaFunction("onWallComment", event)
		case "thread":
			br.callLuaFunction("onThread", event)
		case "thread_post":
			br.callLuaFunction("onThreadPost", event)
		}
	}()

	select {
	case <-ctx.Done():
		br.logError("Event handler timeout")
	case <-done:
		// Completed successfully
	}
}

// callLuaFunction calls a Lua function with event data
func (br *BotRuntime) callLuaFunction(funcName string, event *BotEvent) {
	fn := br.VM.GetGlobal(funcName)
	if fn.Type() != lua.LTFunction {
		return // Function not defined
	}

	// Convert event data to Lua table
	dataTable := br.VM.NewTable()
	for k, v := range event.Data {
		dataTable.RawSetString(k, br.toLuaValue(v))
	}

	if err := br.VM.CallByParam(lua.P{
		Fn:      fn,
		NRet:    0,
		Protect: true,
	}, dataTable); err != nil {
		br.logError(fmt.Sprintf("Error calling %s: %v", funcName, err))
	}
}

// toLuaValue converts Go value to Lua value
func (br *BotRuntime) toLuaValue(v interface{}) lua.LValue {
	switch val := v.(type) {
	case string:
		return lua.LString(val)
	case int:
		return lua.LNumber(val)
	case int64:
		return lua.LNumber(val)
	case float64:
		return lua.LNumber(val)
	case bool:
		return lua.LBool(val)
	case nil:
		return lua.LNil
	default:
		return lua.LString(fmt.Sprintf("%v", val))
	}
}

// logError logs an error for this bot
func (br *BotRuntime) logError(message string) {
	br.logMessage("error", message)
}

// logMessage logs a message for this bot
func (br *BotRuntime) logMessage(level, message string) {
	_, err := br.DB.Exec(`
		INSERT INTO bot_logs (bot_id, level, message)
		VALUES ($1, $2, $3)
	`, br.Bot.ID, level, message)
	if err != nil {
		log.Printf("Failed to log message for bot %s: %v", br.Bot.Username, err)
	}
}
