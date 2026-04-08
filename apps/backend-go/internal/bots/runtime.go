package bots

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
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
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[BotManager] PANIC in subscribeToEvents: %v", r)
		}
	}()

	log.Printf("[BotManager] Starting Redis subscription to bot:events channel")

	if bm.Redis == nil {
		log.Printf("[BotManager] ERROR: Redis client is nil!")
		return
	}

	pubsub := bm.Redis.Subscribe(bm.ctx, "bot:events")
	defer pubsub.Close()

	log.Printf("[BotManager] Successfully subscribed to bot:events channel")
	ch := pubsub.Channel()

	log.Printf("[BotManager] Entering event loop...")
	for {
		select {
		case <-bm.ctx.Done():
			log.Printf("[BotManager] Context cancelled, stopping event subscription")
			return
		case msg := <-ch:
			log.Printf("[BotManager] Received message from Redis: %s", msg.Payload)
			var event BotEvent
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Printf("Failed to unmarshal bot event: %v", err)
				continue
			}

			log.Printf("[BotManager] Parsed event: type=%s, data=%+v", event.Type, event.Data)
			bm.handleEvent(&event)
		}
	}
}

// handleEvent dispatches an event to all active bots
func (bm *BotManager) handleEvent(event *BotEvent) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	log.Printf("[BotManager] handleEvent called with type=%s, dispatching to %d bots", event.Type, len(bm.bots))
	for botID, runtime := range bm.bots {
		log.Printf("[BotManager] Dispatching event to bot %s (%s)", runtime.Bot.Username, botID)
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

	// Logging & Utility
	botTable.RawSetString("log", br.VM.NewFunction(br.luaLog))
	botTable.RawSetString("sleep", br.VM.NewFunction(br.luaSleep))

	// Messages & Comments
	botTable.RawSetString("sendThreadPost", br.VM.NewFunction(br.luaSendThreadPost))
	botTable.RawSetString("replyToThreadPost", br.VM.NewFunction(br.luaReplyToThreadPost))
	botTable.RawSetString("sendWallComment", br.VM.NewFunction(br.luaSendWallComment))
	botTable.RawSetString("replyToWallComment", br.VM.NewFunction(br.luaReplyToWallComment))
	botTable.RawSetString("sendChatMessage", br.VM.NewFunction(br.luaSendChatMessage))

	// Users
	botTable.RawSetString("getUser", br.VM.NewFunction(br.luaGetUser))

	// Threads & Posts
	botTable.RawSetString("getThread", br.VM.NewFunction(br.luaGetThread))
	botTable.RawSetString("getPost", br.VM.NewFunction(br.luaGetPost))
	botTable.RawSetString("getThreadPosts", br.VM.NewFunction(br.luaGetThreadPosts))
	botTable.RawSetString("createThread", br.VM.NewFunction(br.luaCreateThread))

	// Likes & Reactions
	botTable.RawSetString("likePost", br.VM.NewFunction(br.luaLikePost))
	botTable.RawSetString("unlikePost", br.VM.NewFunction(br.luaUnlikePost))

	// Chat
	botTable.RawSetString("getChatConversation", br.VM.NewFunction(br.luaGetChatConversation))

	// Data Storage (persistent key-value store)
	botTable.RawSetString("setData", br.VM.NewFunction(br.luaSetData))
	botTable.RawSetString("getData", br.VM.NewFunction(br.luaGetData))
	botTable.RawSetString("deleteData", br.VM.NewFunction(br.luaDeleteData))

	// HTTP Requests
	botTable.RawSetString("httpGet", br.VM.NewFunction(br.luaHttpGet))
	botTable.RawSetString("httpPost", br.VM.NewFunction(br.luaHttpPost))

	// Bot Info
	botTable.RawSetString("id", lua.LString(br.Bot.ID))
	botTable.RawSetString("username", lua.LString(br.Bot.Username))

	br.VM.SetGlobal("bot", botTable)
}

// HandleEvent handles an event for this bot
func (br *BotRuntime) HandleEvent(event *BotEvent) {
	br.mu.Lock()
	if !br.isRunning {
		log.Printf("[Bot %s] Skipping event %s - bot is not running", br.Bot.Username, event.Type)
		br.mu.Unlock()
		return
	}
	br.mu.Unlock()

	log.Printf("[Bot %s] HandleEvent called for type=%s, data=%+v", br.Bot.Username, event.Type, event.Data)

	// Check if bot should handle this event
	if !br.shouldHandleEvent(event) {
		log.Printf("[Bot %s] Skipping event - bot not mentioned", br.Bot.Username)
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
			log.Printf("[Bot %s] Calling onWallPost", br.Bot.Username)
			br.callLuaFunction("onWallPost", event)
		case "wall_comment":
			log.Printf("[Bot %s] Calling onWallComment", br.Bot.Username)
			br.callLuaFunction("onWallComment", event)
		case "thread":
			log.Printf("[Bot %s] Calling onThread", br.Bot.Username)
			br.callLuaFunction("onThread", event)
		case "thread_post":
			log.Printf("[Bot %s] Calling onThreadPost", br.Bot.Username)
			br.callLuaFunction("onThreadPost", event)
		case "chat_message":
			log.Printf("[Bot %s] Calling onChatMessage", br.Bot.Username)
			br.callLuaFunction("onChatMessage", event)
		default:
			log.Printf("[Bot %s] Unknown event type: %s", br.Bot.Username, event.Type)
		}
	}()

	select {
	case <-ctx.Done():
		br.logError("Event handler timeout")
	case <-done:
		// Completed successfully
	}
}

// shouldHandleEvent checks if bot should handle this event
func (br *BotRuntime) shouldHandleEvent(event *BotEvent) bool {
	// For chat messages, check if bot is a member of the conversation
	if event.Type == "chat_message" {
		log.Printf("[Bot %s] Processing chat_message event, data: %+v", br.Bot.Username, event.Data)

		conversationID, ok := event.Data["conversation_id"].(string)
		log.Printf("[Bot %s] conversation_id extraction: ok=%v, value=%q", br.Bot.Username, ok, conversationID)

		if !ok || conversationID == "" {
			log.Printf("[Bot %s] No conversation_id in chat_message event", br.Bot.Username)
			return false
		}

		// Check if bot is a member of this conversation
		var isMember bool
		err := br.DB.QueryRow(`
			SELECT EXISTS(
				SELECT 1 FROM chat_conversation_members
				WHERE conversation_id = $1 AND user_id = $2 AND archived_at IS NULL
			)
		`, conversationID, br.Bot.ID).Scan(&isMember)

		if err != nil {
			log.Printf("[Bot %s] Error checking conversation membership: %v", br.Bot.Username, err)
			return false
		}

		log.Printf("[Bot %s] Membership check result: isMember=%v for conversation %s", br.Bot.Username, isMember, conversationID)

		if isMember {
			log.Printf("[Bot %s] Bot is a member of conversation %s, handling", br.Bot.Username, conversationID)
			return true
		}

		log.Printf("[Bot %s] Bot is not a member of conversation %s, skipping", br.Bot.Username, conversationID)
		return false
	}

	// Always handle events on bot's own wall
	if event.Type == "wall_post" || event.Type == "wall_comment" {
		// Check wall_owner_id first
		if wallOwnerID, ok := event.Data["wall_owner_id"].(string); ok {
			if wallOwnerID == br.Bot.ID {
				log.Printf("[Bot %s] Event is on bot's wall (wall_owner_id), handling", br.Bot.Username)
				return true
			}
		}
		// For wall_post, also check user_id (the wall owner)
		if event.Type == "wall_post" {
			if userID, ok := event.Data["user_id"].(string); ok {
				if userID == br.Bot.ID {
					log.Printf("[Bot %s] Event is on bot's wall (user_id), handling", br.Bot.Username)
					return true
				}
			}
		}
	}

	// Check if bot is mentioned in content
	botMention := "@" + br.Bot.Username

	// Check in different content fields depending on event type
	var content string
	if contentVal, ok := event.Data["content"].(string); ok {
		content = contentVal
	} else if textVal, ok := event.Data["text"].(string); ok {
		content = textVal
	} else if bodyVal, ok := event.Data["body"].(string); ok {
		content = bodyVal
	}

	if content != "" {
		log.Printf("[Bot %s] Checking content for mention. Content: %q, botMention: %q", br.Bot.Username, content, botMention)
		// Use strings.Contains for more robust mention detection
		if strings.Contains(content, botMention) {
			log.Printf("[Bot %s] Bot is mentioned in content, handling", br.Bot.Username)
			return true
		}
		log.Printf("[Bot %s] Bot mention not found in content", br.Bot.Username)
	}

	log.Printf("[Bot %s] Bot not mentioned and not on bot's wall, skipping", br.Bot.Username)
	return false
}

// callLuaFunction calls a Lua function with event data
func (br *BotRuntime) callLuaFunction(funcName string, event *BotEvent) {
	fn := br.VM.GetGlobal(funcName)
	if fn.Type() != lua.LTFunction {
		log.Printf("[Bot %s] Function %s not defined in Lua code", br.Bot.Username, funcName)
		return // Function not defined
	}

	log.Printf("[Bot %s] Function %s found, preparing to call with data: %+v", br.Bot.Username, funcName, event.Data)

	// Convert event data to Lua table
	dataTable := br.VM.NewTable()
	for k, v := range event.Data {
		dataTable.RawSetString(k, br.toLuaValue(v))
	}

	log.Printf("[Bot %s] Calling Lua function %s", br.Bot.Username, funcName)
	if err := br.VM.CallByParam(lua.P{
		Fn:      fn,
		NRet:    0,
		Protect: true,
	}, dataTable); err != nil {
		br.logError(fmt.Sprintf("Error calling %s: %v", funcName, err))
		log.Printf("[Bot %s] Error calling %s: %v", br.Bot.Username, funcName, err)
	} else {
		log.Printf("[Bot %s] Successfully called %s", br.Bot.Username, funcName)
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
