package bots

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
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

	log.Printf("[Bot %s] luaSendThreadPost called: threadID=%s, content=%s", br.Bot.Username, threadID, content)

	// Check rate limit
	if !br.checkRateLimit() {
		log.Printf("[Bot %s] Rate limit exceeded", br.Bot.Username)
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
		log.Printf("[Bot %s] Failed to insert post: %v", br.Bot.Username, err)
		br.logError(fmt.Sprintf("Failed to send thread post: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	log.Printf("[Bot %s] Post created successfully: %s", br.Bot.Username, postID)

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
		log.Printf("[Bot %s] Broadcasting post %s to WebSocket", br.Bot.Username, postID)
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
		log.Printf("[Bot %s] Broadcasted post to room %s and feed", br.Bot.Username, threadID)
	} else {
		log.Printf("[Bot %s] WARNING: WSHub is nil, cannot broadcast post", br.Bot.Username)
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

// luaReplyToThreadPost implements bot.replyToThreadPost(threadId, postId, content)
func (br *BotRuntime) luaReplyToThreadPost(L *lua.LState) int {
	threadID := L.CheckString(1)
	replyToPostID := L.CheckString(2)
	content := L.CheckString(3)

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

	// Insert post with reply_to
	var postID string
	err = br.DB.QueryRow(`
		INSERT INTO posts (thread_id, user_id, content, server_domain, reply_to)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, threadID, br.Bot.ID, content, serverDomain, replyToPostID).Scan(&postID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to send thread post reply: %v", err))
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
		log.Printf("[Bot %s] Broadcasting reply post %s to WebSocket", br.Bot.Username, postID)
		eventData, _ := json.Marshal(map[string]interface{}{
			"type": "new_post",
			"data": map[string]interface{}{
				"id":         postID,
				"thread_id":  threadID,
				"user_id":    br.Bot.ID,
				"content":    content,
				"reply_to":   replyToPostID,
				"username":   username,
				"avatar_url": avatarURL,
				"created_at": time.Now().Format(time.RFC3339),
			},
		})
		br.WSHub.BroadcastToRoom(threadID, eventData)
		br.WSHub.BroadcastToRoom("feed", eventData)
		log.Printf("[Bot %s] Broadcasted reply to room %s and feed", br.Bot.Username, threadID)
	} else {
		log.Printf("[Bot %s] WARNING: WSHub is nil, cannot broadcast reply", br.Bot.Username)
	}

	// Update stats
	br.incrementStat("messages_sent")

	L.Push(lua.LBool(true))
	L.Push(lua.LString(postID))
	return 2
}

// luaReplyToWallComment implements bot.replyToWallComment(wallOwnerId, postId, commentId, content)
func (br *BotRuntime) luaReplyToWallComment(L *lua.LState) int {
	_ = L.CheckString(1) // wallOwnerID - not used but kept for API consistency
	postID := L.CheckString(2)
	replyToCommentID := L.CheckString(3)
	content := L.CheckString(4)

	// Check rate limit
	if !br.checkRateLimit() {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Rate limit exceeded"))
		return 2
	}

	// Insert comment with reply_to
	var commentID string
	err := br.DB.QueryRow(`
		INSERT INTO profile_wall_post_comments (post_id, user_id, content, reply_to)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, postID, br.Bot.ID, content, replyToCommentID).Scan(&commentID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to send wall comment reply: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	// Publish wall comment event to WebSocket
	if br.WSHub != nil {
		eventData, _ := json.Marshal(map[string]interface{}{
			"type": "new_wall_comment",
			"data": map[string]interface{}{
				"id":       commentID,
				"post_id":  postID,
				"user_id":  br.Bot.ID,
				"content":  content,
				"reply_to": replyToCommentID,
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

// luaSendChatMessage implements bot.sendChatMessage(conversationId, content)
func (br *BotRuntime) luaSendChatMessage(L *lua.LState) int {
	conversationID := L.CheckString(1)
	content := L.CheckString(2)

	// Check rate limit
	if !br.checkRateLimit() {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Rate limit exceeded"))
		return 2
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
		br.logError(fmt.Sprintf("Failed to check conversation membership: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	if !isMember {
		br.logError("Bot is not a member of this conversation")
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Bot is not a member of this conversation"))
		return 2
	}

	// Get bot's public key for encryption
	var senderPublicKey string
	err = br.DB.QueryRow(`
		SELECT public_key FROM chat_user_keys WHERE user_id = $1
	`, br.Bot.ID).Scan(&senderPublicKey)

	if err != nil {
		br.logError(fmt.Sprintf("Bot does not have encryption keys set up: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Bot does not have encryption keys set up"))
		return 2
	}

	// Get recipient's public key (the other member of the conversation)
	var recipientPublicKey string
	err = br.DB.QueryRow(`
		SELECT k.public_key
		FROM chat_conversation_members cm
		INNER JOIN chat_user_keys k ON cm.user_id = k.user_id
		WHERE cm.conversation_id = $1 AND cm.user_id != $2 AND cm.archived_at IS NULL
		LIMIT 1
	`, conversationID, br.Bot.ID).Scan(&recipientPublicKey)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to get recipient public key: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Failed to get recipient public key"))
		return 2
	}

	// For bot messages, we'll store plaintext in a special format
	// Real implementation would encrypt, but bots need to read messages
	// So we use a marker format that frontend can detect
	ciphertext := "BOT_PLAINTEXT:" + content
	nonce := "bot_nonce_placeholder_12345678901234567890123="
	clientMessageID := fmt.Sprintf("bot_%s_%d", br.Bot.ID, time.Now().UnixNano())

	// Insert message
	var messageID string
	err = br.DB.QueryRow(`
		INSERT INTO chat_messages (
			conversation_id, sender_user_id, ciphertext, nonce,
			sender_public_key, recipient_public_key, client_message_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, conversationID, br.Bot.ID, ciphertext, nonce, senderPublicKey, recipientPublicKey, clientMessageID).Scan(&messageID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to send chat message: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	// Publish to WebSocket
	if br.WSHub != nil {
		eventData, _ := json.Marshal(map[string]interface{}{
			"type": "new_chat_message",
			"data": map[string]interface{}{
				"id":                   messageID,
				"conversation_id":      conversationID,
				"sender_user_id":       br.Bot.ID,
				"ciphertext":           ciphertext,
				"nonce":                nonce,
				"sender_public_key":    senderPublicKey,
				"recipient_public_key": recipientPublicKey,
				"client_message_id":    clientMessageID,
				"sent_at":              time.Now().Format(time.RFC3339),
			},
		})
		br.WSHub.BroadcastToRoom("chat_"+conversationID, eventData)
	}

	// Update stats
	br.incrementStat("messages_sent")

	L.Push(lua.LBool(true))
	L.Push(lua.LString(messageID))
	return 2
}

// luaLikePost implements bot.likePost(postId)
func (br *BotRuntime) luaLikePost(L *lua.LState) int {
	postID := L.CheckString(1)

	// Check if already liked
	var exists bool
	err := br.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2)", postID, br.Bot.ID).Scan(&exists)
	if err != nil || exists {
		L.Push(lua.LBool(false))
		if exists {
			L.Push(lua.LString("Already liked"))
		} else {
			L.Push(lua.LString(err.Error()))
		}
		return 2
	}

	// Create like
	var likeID string
	err = br.DB.QueryRow(`
		INSERT INTO post_likes (post_id, user_id)
		VALUES ($1, $2)
		RETURNING id
	`, postID, br.Bot.ID).Scan(&likeID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to like post: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	L.Push(lua.LBool(true))
	L.Push(lua.LString(likeID))
	return 2
}

// luaUnlikePost implements bot.unlikePost(postId)
func (br *BotRuntime) luaUnlikePost(L *lua.LState) int {
	postID := L.CheckString(1)

	result, err := br.DB.Exec("DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2", postID, br.Bot.ID)
	if err != nil {
		br.logError(fmt.Sprintf("Failed to unlike post: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Like not found"))
		return 2
	}

	L.Push(lua.LBool(true))
	return 1
}

// luaLikeThread implements bot.likeThread(threadId)
func (br *BotRuntime) luaLikeThread(L *lua.LState) int {
	threadID := L.CheckString(1)

	// Check if already liked
	var exists bool
	err := br.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM thread_likes WHERE thread_id = $1 AND user_id = $2)", threadID, br.Bot.ID).Scan(&exists)
	if err != nil || exists {
		L.Push(lua.LBool(false))
		if exists {
			L.Push(lua.LString("Already liked"))
		} else {
			L.Push(lua.LString(err.Error()))
		}
		return 2
	}

	// Create like
	var likeID string
	err = br.DB.QueryRow(`
		INSERT INTO thread_likes (thread_id, user_id)
		VALUES ($1, $2)
		RETURNING id
	`, threadID, br.Bot.ID).Scan(&likeID)

	if err != nil {
		br.logError(fmt.Sprintf("Failed to like thread: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	L.Push(lua.LBool(true))
	L.Push(lua.LString(likeID))
	return 2
}

// luaUnlikeThread implements bot.unlikeThread(threadId)
func (br *BotRuntime) luaUnlikeThread(L *lua.LState) int {
	threadID := L.CheckString(1)

	result, err := br.DB.Exec("DELETE FROM thread_likes WHERE thread_id = $1 AND user_id = $2", threadID, br.Bot.ID)
	if err != nil {
		br.logError(fmt.Sprintf("Failed to unlike thread: %v", err))
		L.Push(lua.LBool(false))
		L.Push(lua.LString(err.Error()))
		return 2
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		L.Push(lua.LBool(false))
		L.Push(lua.LString("Like not found"))
		return 2
	}

	L.Push(lua.LBool(true))
	return 1
}
func (br *BotRuntime) luaGetChatConversation(L *lua.LState) int {
	conversationID := L.CheckString(1)

	// Check if bot is a member
	var isMember bool
	err := br.DB.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM chat_conversation_members
			WHERE conversation_id = $1 AND user_id = $2 AND archived_at IS NULL
		)
	`, conversationID, br.Bot.ID).Scan(&isMember)

	if err != nil || !isMember {
		L.Push(lua.LNil)
		return 1
	}

	// Get conversation info
	var createdAt time.Time
	err = br.DB.QueryRow(`
		SELECT created_at FROM chat_conversations WHERE id = $1
	`, conversationID).Scan(&createdAt)

	if err != nil {
		L.Push(lua.LNil)
		return 1
	}

	// Get members
	rows, err := br.DB.Query(`
		SELECT user_id FROM chat_conversation_members
		WHERE conversation_id = $1 AND archived_at IS NULL
	`, conversationID)
	if err != nil {
		L.Push(lua.LNil)
		return 1
	}
	defer rows.Close()

	members := L.NewTable()
	i := 1
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			continue
		}
		members.RawSetInt(i, lua.LString(userID))
		i++
	}

	convTable := L.NewTable()
	convTable.RawSetString("id", lua.LString(conversationID))
	convTable.RawSetString("created_at", lua.LString(createdAt.Format(time.RFC3339)))
	convTable.RawSetString("members", members)

	L.Push(convTable)
	return 1
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
