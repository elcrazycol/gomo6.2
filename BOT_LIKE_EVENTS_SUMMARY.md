# Bot Like Events - Implementation Summary

## Changes Made (2026-04-08)

### 1. New Bot Events Added

Added 4 new event types that bots can react to:

- **`post_like`** - Triggered when someone likes a bot's post
- **`post_unlike`** - Triggered when someone unlikes a bot's post  
- **`thread_like`** - Triggered when someone likes a bot's thread
- **`thread_unlike`** - Triggered when someone unlikes a bot's thread

### 2. Event Handlers in Runtime

**File**: `/apps/backend-go/internal/bots/runtime.go`

- Added event type handling in `HandleEvent()` switch statement
- Added event filtering logic in `shouldHandleEvent()` to check if liked content belongs to the bot
- Events only fire if the bot is the author of the liked/unliked content

### 3. Event Publishing in Likes Handler

**File**: `/apps/backend-go/internal/api/handlers/likes.go`

- Added Redis client to `LikesHandler` struct
- Updated `NewLikesHandler()` to accept Redis client parameter
- Added event publishing after successful like/unlike operations:
  - `LikeThread()` - publishes `thread_like` event
  - `UnlikeThread()` - publishes `thread_unlike` event
  - `LikePost()` - publishes `post_like` event
  - `UnlikePost()` - publishes `post_unlike` event

### 4. New Lua API Functions

**File**: `/apps/backend-go/internal/bots/lua_api.go`

Added 4 new bot API functions:

```lua
-- Like a post
success, likeId = bot.likePost(postId)

-- Unlike a post
success = bot.unlikePost(postId)

-- Like a thread
success, likeId = bot.likeThread(threadId)

-- Unlike a thread
success = bot.unlikeThread(threadId)
```

Features:
- Check for existing likes before creating
- Return like ID on success
- Proper error handling and logging
- Return meaningful error messages

### 5. Function Registration

**File**: `/apps/backend-go/internal/bots/runtime.go`

Registered new functions in `registerBotAPI()`:
```go
botTable.RawSetString("likePost", br.VM.NewFunction(br.luaLikePost))
botTable.RawSetString("unlikePost", br.VM.NewFunction(br.luaUnlikePost))
botTable.RawSetString("likeThread", br.VM.NewFunction(br.luaLikeThread))
botTable.RawSetString("unlikeThread", br.VM.NewFunction(br.luaUnlikeThread))
```

### 6. Routes Update

**File**: `/apps/backend-go/internal/api/routes/routes.go`

Updated `LikesHandler` initialization to pass Redis client:
```go
likesHandler := handlers.NewLikesHandler(db, redis)
```

### 7. Code Cleanup

**File**: `/apps/backend-go/internal/bots/lua_api_extended.go`

- Removed duplicate `luaLikePost()` and `luaUnlikePost()` functions
- Kept improved versions in `lua_api.go` with better error handling

### 8. Documentation

**File**: `/apps/backend-go/BOT_EVENTS_GUIDE.md`

Created comprehensive guide with:
- Event descriptions and data structures
- API function documentation
- Example bot implementations
- Best practices and security notes
- Debugging tips

## Event Flow

1. User likes/unlikes a post or thread via API
2. `LikesHandler` processes the request
3. Database is updated
4. Event is published to Redis `bot:events` channel
5. `BotManager` receives event via pub/sub
6. Event is dispatched to all active bots
7. Each bot checks if it should handle the event (via `shouldHandleEvent()`)
8. If bot is the author, corresponding Lua function is called (`onPostLike`, etc.)
9. Bot can react by logging, sending messages, or performing other actions

## Example Bot Usage

```lua
function onPostLike(data)
    bot.log("info", "User " .. data.user_id .. " liked my post!")
    
    -- Get user info
    local user = bot.getUser(data.user_id)
    if user then
        -- Thank them
        bot.log("info", "Thanks " .. user.username .. "!")
    end
end

function onThreadPost(data)
    -- Auto-like posts that mention the bot
    if string.find(data.content, "@" .. bot.username) then
        bot.likePost(data.post_id)
    end
end
```

## Testing

To test the new functionality:

1. Create a bot that implements `onPostLike` or `onThreadLike`
2. Create a post or thread as the bot
3. Like the content as a different user
4. Check bot logs to see if event was received
5. Bot can respond by liking back, commenting, or logging

## Technical Details

- Events are published via Redis pub/sub for real-time delivery
- Bot event handlers have 5-second timeout
- Rate limiting: 10 actions per minute per bot
- Events only fire for content authored by the bot
- All bot actions are logged to `bot_logs` table

## Files Modified

1. `/apps/backend-go/internal/bots/runtime.go` - Event handling
2. `/apps/backend-go/internal/bots/lua_api.go` - New API functions
3. `/apps/backend-go/internal/bots/lua_api_extended.go` - Removed duplicates
4. `/apps/backend-go/internal/api/handlers/likes.go` - Event publishing
5. `/apps/backend-go/internal/api/routes/routes.go` - Handler initialization

## Files Created

1. `/apps/backend-go/BOT_EVENTS_GUIDE.md` - Complete documentation

## Deployment

- Docker backend rebuilt with new code
- All containers running successfully
- No database migrations required (uses existing tables)
- Backward compatible - existing bots continue to work
