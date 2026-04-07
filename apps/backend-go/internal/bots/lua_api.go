package bots

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	lua "github.com/yuin/gopher-lua"
)

// luaLog implements bot.log(level, message)
func (br *BotRuntime) luaLog(L *lua.LState) int {
	level := L.CheckString(1)
	message := L.CheckString(2)

	// Validate level
	validLevels := map[string]bool{
		"info":  true,
		"warn":  true,
		"error": true,
		"debug": true,
	}
	if !validLevels[level] {
		level = "info"
	}

	br.logMessage(level, message)
	return 0
}

// luaSendWallComment implements bot.sendWallComment(postId, content)
func (br *BotRuntime) luaSendWallComment(L *lua.LState) int {
	postID := L.CheckString(1)
	content := L.CheckString(2)

	// Check rate limit
	if !br.checkRateLimit() {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Rate limit exceeded"))
		return 2
	}

	// Insert comment
	var commentID string
	err := br.DB.QueryRow(`
		INSERT INTO profile_wall_post_comments (post_id, user_id, content)
		VALUES ($1, $2, $3)
		RETURNING id
	`, postID, br.Bot.ID, content).Scan(&commentID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to send wall comment: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	// Publish wall comment event to WebSocket
	if br.WSHub != nil {
		eventData, _ := json.Marshal(map[string]interface{}{
			"type": "new_wall_comment",
			"data": map[string]interface{}{
				"id":      commentID,
				"post_id": postID,
				"user_id": br.Bot.ID,
				"content": content,
			},
		})
		br.WSHub.BroadcastToRoom("profile_wall_"+postID, eventData)
	}

	// Update stats
	br.incrementStat("messages_sent")

	L.Push(lua.LBool(true))
	L.Push(lua.LString(commentID))
	return 2
}

// luaSendThreadPost implements bot.sendThreadPost(threadId, content, options)
func (br *BotRuntime) luaSendThreadPost(L *lua.LState) int {
	threadID := L.CheckString(1)
	content := L.CheckString(2)

	// Check rate limit
	if !br.checkRateLimit() {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Rate limit exceeded"))
		return 2
	}

	// Get server domain for the thread
	var serverDomain string
	err := br.DB.QueryRow("SELECT server_domain FROM threads WHERE id = $1", threadID).Scan(&serverDomain)
	if err != nil {
		br.logError(fmt.Sprintf("Failed to get thread: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	// Insert post
	var postID string
	err = br.DB.QueryRow(`
		INSERT INTO posts (thread_id, user_id, content, server_domain)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, threadID, br.Bot.ID, content, serverDomain).Scan(&postID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to send thread post: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	// Update thread post count
	_, err = br.DB.Exec("UPDATE threads SET post_count = post_count + 1 WHERE id = $1", threadID)
	if err != nil {
		br.logError(fmt.Sprintf("Failed to update thread post count: %v", err))
	}

	// Get bot user info for WebSocket
	var username, domain, avatarURL string
	err = br.DB.QueryRow("SELECT username, domain, COALESCE(avatar_url, '') FROM users WHERE id = $1", br.Bot.ID).Scan(&username, &domain, &avatarURL)
	if err != nil {
		username = br.Bot.Username
		domain = "localhost:8080"
		avatarURL = ""
	}

	// Publish post event to WebSocket
	if br.WSHub != nil {
		eventData, _ := json.Marshal(map[string]interface{}{
			"type": "new_post",
			"data": map[string]interface{}{
				"id":         postID,
				"thread_id":  threadID,
				"user_id":    br.Bot.ID,
				"content":    content,
				"username":   username,
				"avatar_url": avatarURL,
				"created_at": time.Now().Format(time.RFC3339),
			},
		})
		br.WSHub.BroadcastToRoom(threadID, eventData)
		// Also broadcast to feed
		br.WSHub.BroadcastToRoom("feed", eventData)
	}

	// Update stats
	br.incrementStat("messages_sent")

	L.Push(lua.LBool(true))
	L.Push(lua.LString(postID))
	return 2
}

// luaGetUser implements bot.getUser(userId)
func (br *BotRuntime) luaGetUser(L *lua.LState) int {
	userID := L.CheckString(1)

	var username, domain string
	var avatarURL, bio sql.NullString
	err := br.DB.QueryRow(`
		SELECT username, domain, avatar_url, bio
		FROM users
		WHERE id = $1
	`, userID).Scan(&username, &domain, &avatarURL, &bio)

	if err != nil {
		L.Push(lua.LNil)
		return 1
	}

	userTable := L.NewTable()
	userTable.RawSetString("id", lua.LString(userID))
	userTable.RawSetString("username", lua.LString(username))
	userTable.RawSetString("domain", lua.LString(domain))
	if avatarURL.Valid {
		userTable.RawSetString("avatar_url", lua.LString(avatarURL.String))
	}
	if bio.Valid {
		userTable.RawSetString("bio", lua.LString(bio.String))
	}

	L.Push(userTable)
	return 1
}

// luaSleep implements bot.sleep(milliseconds)
func (br *BotRuntime) luaSleep(L *lua.LState) int {
	ms := L.CheckInt(1)

	// Limit sleep to max 5 seconds
	if ms > 5000 {
		ms = 5000
	}
	if ms < 0 {
		ms = 0
	}

	time.Sleep(time.Duration(ms) * time.Millisecond)
	return 0
}

// checkRateLimit checks if bot has exceeded rate limits
func (br *BotRuntime) checkRateLimit() bool {
	ctx := br.VM.Context()
	if ctx == nil {
		return true
	}

	// Check messages sent in last minute
	key := fmt.Sprintf("bot:ratelimit:%s:minute", br.Bot.ID)
	count, err := br.Redis.Get(ctx, key).Int()
	if err == nil && count >= 10 {
		return false
	}

	// Increment counter
	br.Redis.Incr(ctx, key)
	br.Redis.Expire(ctx, key, time.Minute)

	return true
}

// incrementStat increments a bot statistic
func (br *BotRuntime) incrementStat(stat string) {
	today := time.Now().Format("2006-01-02")

	// Upsert stats
	query := fmt.Sprintf(`
		INSERT INTO bot_stats (bot_id, %s, date)
		VALUES ($1, 1, $2)
		ON CONFLICT (bot_id, date)
		DO UPDATE SET %s = bot_stats.%s + 1
	`, stat, stat, stat)

	_, err := br.DB.Exec(query, br.Bot.ID, today)
	if err != nil {
		br.logError(fmt.Sprintf("Failed to update stats: %v", err))
	}
}

// Helper function to convert Lua table to Go map
func luaTableToMap(L *lua.LState, table *lua.LTable) map[string]interface{} {
	result := make(map[string]interface{})
	table.ForEach(func(key, value lua.LValue) {
		keyStr := key.String()
		switch v := value.(type) {
		case lua.LString:
			result[keyStr] = string(v)
		case lua.LNumber:
			result[keyStr] = float64(v)
		case lua.LBool:
			result[keyStr] = bool(v)
		case *lua.LTable:
			result[keyStr] = luaTableToMap(L, v)
		}
	})
	return result
}

// Helper function to convert Go map to Lua table
func mapToLuaTable(L *lua.LState, m map[string]interface{}) *lua.LTable {
	table := L.NewTable()
	for k, v := range m {
		switch val := v.(type) {
		case string:
			table.RawSetString(k, lua.LString(val))
		case int:
			table.RawSetString(k, lua.LNumber(val))
		case int64:
			table.RawSetString(k, lua.LNumber(val))
		case float64:
			table.RawSetString(k, lua.LNumber(val))
		case bool:
			table.RawSetString(k, lua.LBool(val))
		case map[string]interface{}:
			table.RawSetString(k, mapToLuaTable(L, val))
		case []interface{}:
			arr := L.NewTable()
			for i, item := range val {
				arr.RawSetInt(i+1, interfaceToLuaValue(L, item))
			}
			table.RawSetString(k, arr)
		}
	}
	return table
}

// Helper function to convert interface{} to lua.LValue
func interfaceToLuaValue(L *lua.LState, v interface{}) lua.LValue {
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
	case map[string]interface{}:
		return mapToLuaTable(L, val)
	case []interface{}:
		arr := L.NewTable()
		for i, item := range val {
			arr.RawSetInt(i+1, interfaceToLuaValue(L, item))
		}
		return arr
	case nil:
		return lua.LNil
	default:
		// Try to marshal to JSON and back
		data, err := json.Marshal(val)
		if err != nil {
			return lua.LNil
		}
		var result interface{}
		if err := json.Unmarshal(data, &result); err != nil {
			return lua.LNil
		}
		return interfaceToLuaValue(L, result)
	}
}
