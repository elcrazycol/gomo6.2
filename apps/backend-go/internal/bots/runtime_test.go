package bots

import (
	"testing"
	"time"

	"github.com/gomo6/backend/internal/models"
)

// TestBotRuntimeInit tests bot runtime initialization
func TestBotRuntimeInit(t *testing.T) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode: `
function onWallPost(post)
	bot.log("info", "Test message")
end
`,
		IsActive: true,
	}

	runtime := &BotRuntime{
		Bot: bot,
	}

	err := runtime.Init()
	if err != nil {
		t.Fatalf("Failed to initialize bot runtime: %v", err)
	}
	defer runtime.Stop()

	if runtime.VM == nil {
		t.Fatal("Lua VM not initialized")
	}

	if !runtime.isRunning {
		t.Fatal("Bot runtime not marked as running")
	}
}

// TestBotRuntimeSandbox tests that dangerous functions are disabled
func TestBotRuntimeSandbox(t *testing.T) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode:     ``,
		IsActive:    true,
	}

	runtime := &BotRuntime{
		Bot: bot,
	}

	err := runtime.Init()
	if err != nil {
		t.Fatalf("Failed to initialize bot runtime: %v", err)
	}
	defer runtime.Stop()

	// Test that dangerous modules are disabled
	dangerousModules := []string{"io", "os", "debug", "package"}
	for _, module := range dangerousModules {
		val := runtime.VM.GetGlobal(module)
		if val.Type().String() != "nil" {
			t.Errorf("Dangerous module %s is not disabled", module)
		}
	}

	// Test that dangerous functions are disabled
	dangerousFuncs := []string{"dofile", "loadfile", "load"}
	for _, fn := range dangerousFuncs {
		val := runtime.VM.GetGlobal(fn)
		if val.Type().String() != "nil" {
			t.Errorf("Dangerous function %s is not disabled", fn)
		}
	}
}

// TestBotRuntimeInvalidLua tests handling of invalid Lua code
func TestBotRuntimeInvalidLua(t *testing.T) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode:     `this is invalid lua code {{{`,
		IsActive:    true,
	}

	runtime := &BotRuntime{
		Bot: bot,
	}

	err := runtime.Init()
	if err == nil {
		runtime.Stop()
		t.Fatal("Expected error for invalid Lua code, got nil")
	}
}

// TestBotRuntimeEventHandling tests event handling
func TestBotRuntimeEventHandling(t *testing.T) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode: `
function onWallPost(post)
	-- This function should be called
end
`,
		IsActive: true,
	}

	runtime := &BotRuntime{
		Bot: bot,
	}

	err := runtime.Init()
	if err != nil {
		t.Fatalf("Failed to initialize bot runtime: %v", err)
	}
	defer runtime.Stop()

	// Create test event
	event := &BotEvent{
		Type: "wall_post",
		Data: map[string]interface{}{
			"id":      "post-123",
			"content": "Test post",
		},
	}

	// This should not panic
	runtime.HandleEvent(event)
}

// TestBotRuntimeTimeout tests execution timeout
func TestBotRuntimeTimeout(t *testing.T) {
	t.Skip("Skipping timeout test - requires database connection")

	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode: `
function onWallPost(post)
	-- Infinite loop
	while true do
		local x = 1 + 1
	end
end
`,
		IsActive: true,
	}

	runtime := &BotRuntime{
		Bot: bot,
	}

	err := runtime.Init()
	if err != nil {
		t.Fatalf("Failed to initialize bot runtime: %v", err)
	}
	defer runtime.Stop()

	event := &BotEvent{
		Type: "wall_post",
		Data: map[string]interface{}{
			"id":      "post-123",
			"content": "Test post",
		},
	}

	// Start timer
	start := time.Now()

	// This should timeout after 5 seconds
	runtime.HandleEvent(event)

	elapsed := time.Since(start)

	// Should complete within 6 seconds (5s timeout + 1s buffer)
	if elapsed > 6*time.Second {
		t.Errorf("Event handling took too long: %v", elapsed)
	}
}

// TestLuaTableConversion tests conversion between Go and Lua types
func TestLuaTableConversion(t *testing.T) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode:     ``,
		IsActive:    true,
	}

	runtime := &BotRuntime{
		Bot: bot,
	}

	err := runtime.Init()
	if err != nil {
		t.Fatalf("Failed to initialize bot runtime: %v", err)
	}
	defer runtime.Stop()

	// Test Go map to Lua table
	goMap := map[string]interface{}{
		"string": "value",
		"number": 42,
		"bool":   true,
		"nested": map[string]interface{}{
			"key": "value",
		},
	}

	luaTable := mapToLuaTable(runtime.VM, goMap)
	if luaTable == nil {
		t.Fatal("Failed to convert Go map to Lua table")
	}

	// Test that values are accessible
	stringVal := luaTable.RawGetString("string")
	if stringVal.String() != "value" {
		t.Errorf("Expected 'value', got '%s'", stringVal.String())
	}
}

// TestBotAPIFunctions tests that bot API functions are registered
func TestBotAPIFunctions(t *testing.T) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode:     ``,
		IsActive:    true,
	}

	runtime := &BotRuntime{
		Bot: bot,
	}

	err := runtime.Init()
	if err != nil {
		t.Fatalf("Failed to initialize bot runtime: %v", err)
	}
	defer runtime.Stop()

	// Check that bot table exists
	botTable := runtime.VM.GetGlobal("bot")
	if botTable.Type().String() == "nil" {
		t.Fatal("bot table not registered")
	}

	// Check that API functions exist
	apiFunctions := []string{"log", "sendWallComment", "sendThreadPost", "getUser", "sleep"}
	for _, fn := range apiFunctions {
		val := runtime.VM.GetField(botTable, fn)
		if val.Type().String() != "function" {
			t.Errorf("API function %s not registered or not a function", fn)
		}
	}
}

// Benchmark bot initialization
func BenchmarkBotInit(b *testing.B) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode: `
function onWallPost(post)
	bot.log("info", "Test")
end
`,
		IsActive: true,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		runtime := &BotRuntime{Bot: bot}
		runtime.Init()
		runtime.Stop()
	}
}

// Benchmark event handling
func BenchmarkEventHandling(b *testing.B) {
	bot := &models.Bot{
		ID:          "test-bot-id",
		OwnerID:     "test-owner-id",
		Username:    "testbot",
		DisplayName: "Test Bot",
		LuaCode: `
function onWallPost(post)
	local content = post.content or ""
	if content:match("test") then
		-- Do something
	end
end
`,
		IsActive: true,
	}

	runtime := &BotRuntime{Bot: bot}
	runtime.Init()
	defer runtime.Stop()

	event := &BotEvent{
		Type: "wall_post",
		Data: map[string]interface{}{
			"id":      "post-123",
			"content": "test message",
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		runtime.HandleEvent(event)
	}
}
