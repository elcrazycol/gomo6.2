package bots

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	lua "github.com/yuin/gopher-lua"
)

// luaGetThread implements bot.getThread(threadId)
func (br *BotRuntime) luaGetThread(L *lua.LState) int {
	threadID := L.CheckString(1)

	var title, serverDomain string
	var postCount int
	var createdAt time.Time
	err := br.DB.QueryRow(`
		SELECT title, server_domain, post_count, created_at
		FROM threads
		WHERE id = $1
	`, threadID).Scan(&title, &serverDomain, &postCount, &createdAt)

	if err != nil {
		L.Push(lua.LNil)
		return 1
	}

	threadTable := L.NewTable()
	threadTable.RawSetString("id", lua.LString(threadID))
	threadTable.RawSetString("title", lua.LString(title))
	threadTable.RawSetString("server_domain", lua.LString(serverDomain))
	threadTable.RawSetString("post_count", lua.LNumber(postCount))
	threadTable.RawSetString("created_at", lua.LString(createdAt.Format(time.RFC3339)))

	L.Push(threadTable)
	return 1
}

// luaGetPost implements bot.getPost(postId)
func (br *BotRuntime) luaGetPost(L *lua.LState) int {
	postID := L.CheckString(1)

	var threadID, userID, content, serverDomain string
	var replyTo sql.NullString
	var createdAt time.Time
	err := br.DB.QueryRow(`
		SELECT thread_id, user_id, content, server_domain, reply_to, created_at
		FROM posts
		WHERE id = $1
	`, postID).Scan(&threadID, &userID, &content, &serverDomain, &replyTo, &createdAt)

	if err != nil {
		L.Push(lua.LNil)
		return 1
	}

	postTable := L.NewTable()
	postTable.RawSetString("id", lua.LString(postID))
	postTable.RawSetString("thread_id", lua.LString(threadID))
	postTable.RawSetString("user_id", lua.LString(userID))
	postTable.RawSetString("content", lua.LString(content))
	postTable.RawSetString("server_domain", lua.LString(serverDomain))
	if replyTo.Valid {
		postTable.RawSetString("reply_to", lua.LString(replyTo.String))
	}
	postTable.RawSetString("created_at", lua.LString(createdAt.Format(time.RFC3339)))

	L.Push(postTable)
	return 1
}

// luaGetThreadPosts implements bot.getThreadPosts(threadId, limit)
func (br *BotRuntime) luaGetThreadPosts(L *lua.LState) int {
	threadID := L.CheckString(1)
	limit := L.OptInt(2, 20)

	if limit > 100 {
		limit = 100
	}

	rows, err := br.DB.Query(`
		SELECT id, user_id, content, created_at
		FROM posts
		WHERE thread_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, threadID, limit)
	if err != nil {
		L.Push(lua.LNil)
		return 1
	}
	defer rows.Close()

	postsTable := L.NewTable()
	i := 1
	for rows.Next() {
		var postID, userID, content string
		var createdAt time.Time
		if err := rows.Scan(&postID, &userID, &content, &createdAt); err != nil {
			continue
		}

		postTable := L.NewTable()
		postTable.RawSetString("id", lua.LString(postID))
		postTable.RawSetString("user_id", lua.LString(userID))
		postTable.RawSetString("content", lua.LString(content))
		postTable.RawSetString("created_at", lua.LString(createdAt.Format(time.RFC3339)))

		postsTable.RawSetInt(i, postTable)
		i++
	}

	L.Push(postsTable)
	return 1
}

// luaCreateThread implements bot.createThread(title, content, serverDomain)
func (br *BotRuntime) luaCreateThread(L *lua.LState) int {
	title := L.CheckString(1)
	content := L.CheckString(2)
	serverDomain := L.OptString(3, "localhost:8080")

	// Check rate limit
	if !br.checkRateLimit() {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Rate limit exceeded"))
		return 2
	}

	// Create thread
	var threadID string
	err := br.DB.QueryRow(`
		INSERT INTO threads (title, user_id, server_domain, post_count)
		VALUES ($1, $2, $3, 1)
		RETURNING id
	`, title, br.Bot.ID, serverDomain).Scan(&threadID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to create thread: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	// Create first post
	var postID string
	err = br.DB.QueryRow(`
		INSERT INTO posts (thread_id, user_id, content, server_domain)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, threadID, br.Bot.ID, content, serverDomain).Scan(&postID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to create first post: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	// Broadcast to WebSocket
	if br.WSHub != nil {
		eventData, _ := json.Marshal(map[string]interface{}{
			"type": "new_thread",
			"data": map[string]interface{}{
				"id":            threadID,
				"title":         title,
				"user_id":       br.Bot.ID,
				"server_domain": serverDomain,
				"created_at":    time.Now().Format(time.RFC3339),
			},
		})
		br.WSHub.BroadcastToRoom("feed", eventData)
	}

	br.incrementStat("messages_sent")

	L.Push(lua.LBool(true))
	L.Push(lua.LString(threadID))
	return 2
}

// luaLikePost implements bot.likePost(postId)
func (br *BotRuntime) luaLikePost(L *lua.LState) int {
	postID := L.CheckString(1)

	// Check rate limit
	if !br.checkRateLimit() {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Rate limit exceeded"))
		return 2
	}

	// Insert like
	_, err := br.DB.Exec(`
		INSERT INTO post_likes (post_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT (post_id, user_id) DO NOTHING
	`, postID, br.Bot.ID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to like post: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	L.Push(lua.LBool(true))
	return 1
}

// luaUnlikePost implements bot.unlikePost(postId)
func (br *BotRuntime) luaUnlikePost(L *lua.LState) int {
	postID := L.CheckString(1)

	_, err := br.DB.Exec(`
		DELETE FROM post_likes
		WHERE post_id = $1 AND user_id = $2
	`, postID, br.Bot.ID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to unlike post: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	L.Push(lua.LBool(true))
	return 1
}

// luaSetData implements bot.setData(key, value)
func (br *BotRuntime) luaSetData(L *lua.LState) int {
	key := L.CheckString(1)
	value := L.CheckString(2)

	// Store in Redis with bot-specific prefix
	redisKey := fmt.Sprintf("bot:data:%s:%s", br.Bot.ID, key)
	ctx := br.VM.Context()
	if ctx == nil {
		L.Push(lua.LBool(false))
		return 1
	}

	err := br.Redis.Set(ctx, redisKey, value, 0).Err()
	if err != nil {
		br.logError(fmt.Sprintf("Failed to set data: %v", err))
		L.Push(lua.LBool(false))
		return 1
	}

	L.Push(lua.LBool(true))
	return 1
}

// luaGetData implements bot.getData(key)
func (br *BotRuntime) luaGetData(L *lua.LState) int {
	key := L.CheckString(1)

	redisKey := fmt.Sprintf("bot:data:%s:%s", br.Bot.ID, key)
	ctx := br.VM.Context()
	if ctx == nil {
		L.Push(lua.LNil)
		return 1
	}

	value, err := br.Redis.Get(ctx, redisKey).Result()
	if err != nil {
		L.Push(lua.LNil)
		return 1
	}

	L.Push(lua.LString(value))
	return 1
}

// luaDeleteData implements bot.deleteData(key)
func (br *BotRuntime) luaDeleteData(L *lua.LState) int {
	key := L.CheckString(1)

	redisKey := fmt.Sprintf("bot:data:%s:%s", br.Bot.ID, key)
	ctx := br.VM.Context()
	if ctx == nil {
		L.Push(lua.LBool(false))
		return 1
	}

	err := br.Redis.Del(ctx, redisKey).Err()
	if err != nil {
		L.Push(lua.LBool(false))
		return 1
	}

	L.Push(lua.LBool(true))
	return 1
}

// luaHttpGet implements bot.httpGet(url)
func (br *BotRuntime) luaHttpGet(L *lua.LState) int {
	url := L.CheckString(1)

	// Whitelist check - only allow certain domains
	if !br.isURLAllowed(url) {
		L.Push(lua.LNil)
		L.Push(lua.LString("URL not allowed"))
		return 2
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		br.logError(fmt.Sprintf("HTTP GET failed: %v", err))
		L.Push(lua.LNil)
		L.Push(lua.LString(err.Error()))
		return 2
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		L.Push(lua.LNil)
		L.Push(lua.LString(err.Error()))
		return 2
	}

	responseTable := L.NewTable()
	responseTable.RawSetString("status", lua.LNumber(resp.StatusCode))
	responseTable.RawSetString("body", lua.LString(string(body)))

	L.Push(responseTable)
	L.Push(lua.LNil)
	return 2
}

// luaHttpPost implements bot.httpPost(url, body)
func (br *BotRuntime) luaHttpPost(L *lua.LState) int {
	url := L.CheckString(1)
	body := L.CheckString(2)

	if !br.isURLAllowed(url) {
		L.Push(lua.LNil)
		L.Push(lua.LString("URL not allowed"))
		return 2
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		br.logError(fmt.Sprintf("HTTP POST failed: %v", err))
		L.Push(lua.LNil)
		L.Push(lua.LString(err.Error()))
		return 2
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		L.Push(lua.LNil)
		L.Push(lua.LString(err.Error()))
		return 2
	}

	responseTable := L.NewTable()
	responseTable.RawSetString("status", lua.LNumber(resp.StatusCode))
	responseTable.RawSetString("body", lua.LString(string(respBody)))

	L.Push(responseTable)
	L.Push(lua.LNil)
	return 2
}

// isURLAllowed checks if URL is in whitelist
func (br *BotRuntime) isURLAllowed(url string) bool {
	// Allow only specific domains for security
	allowedDomains := []string{
		"api.github.com",
		"jsonplaceholder.typicode.com",
		"httpbin.org",
		"api.openweathermap.org",
	}

	for _, domain := range allowedDomains {
		if strings.Contains(url, domain) {
			return true
		}
	}

	return false
}
