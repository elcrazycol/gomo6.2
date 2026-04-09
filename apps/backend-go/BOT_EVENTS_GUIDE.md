# Bot Events Guide

## Available Events

Bots can react to the following events:

### 1. Chat Messages (`onChatMessage`)
Triggered when someone sends a message in a conversation where the bot is a member.

```lua
function onChatMessage(data)
    bot.log("info", "Received chat message from: " .. data.sender_user_id)
    
    -- Reply to the message
    local conversationId = data.conversation_id
    bot.sendChatMessage(conversationId, "Thanks for your message!")
end
```

**Event Data:**
- `conversation_id` - ID of the conversation
- `sender_user_id` - ID of the user who sent the message
- `message_id` - ID of the message
- `content` - Decrypted message content (if bot can decrypt)

---

### 2. Thread Posts (`onThreadPost`)
Triggered when someone posts in a thread where the bot is mentioned.

```lua
function onThreadPost(data)
    bot.log("info", "New post in thread: " .. data.thread_id)
    
    -- Reply to the post
    bot.replyToThreadPost(data.thread_id, data.post_id, "Interesting point!")
end
```

**Event Data:**
- `thread_id` - ID of the thread
- `post_id` - ID of the post
- `user_id` - ID of the user who posted
- `content` - Post content

---

### 3. Wall Posts (`onWallPost`)
Triggered when someone posts on the bot's wall.

```lua
function onWallPost(data)
    bot.log("info", "New wall post from: " .. data.user_id)
    
    -- Comment on the post
    bot.sendWallComment(data.post_id, "Thanks for posting on my wall!")
end
```

**Event Data:**
- `post_id` - ID of the wall post
- `user_id` - ID of the user who posted
- `wall_owner_id` - ID of the wall owner (the bot)
- `content` - Post content

---

### 4. Wall Comments (`onWallComment`)
Triggered when someone comments on the bot's wall post.

```lua
function onWallComment(data)
    bot.log("info", "New comment on wall post: " .. data.post_id)
    
    -- Reply to the comment
    bot.replyToWallComment(data.wall_owner_id, data.post_id, data.comment_id, "Thanks!")
end
```

**Event Data:**
- `post_id` - ID of the wall post
- `comment_id` - ID of the comment
- `user_id` - ID of the user who commented
- `wall_owner_id` - ID of the wall owner
- `content` - Comment content

---

### 5. Post Likes (`onPostLike`)
**NEW!** Triggered when someone likes a post created by the bot.

```lua
function onPostLike(data)
    bot.log("info", "User " .. data.user_id .. " liked my post!")
    
    -- Get user info
    local user = bot.getUser(data.user_id)
    if user then
        bot.log("info", "Liked by: " .. user.username)
    end
    
    -- Optional: Thank them via chat or comment
    -- bot.sendChatMessage(conversationId, "Thanks for the like!")
end
```

**Event Data:**
- `post_id` - ID of the post that was liked
- `user_id` - ID of the user who liked
- `like_id` - ID of the like record

---

### 6. Post Unlikes (`onPostUnlike`)
**NEW!** Triggered when someone unlikes a post created by the bot.

```lua
function onPostUnlike(data)
    bot.log("info", "User " .. data.user_id .. " unliked my post")
end
```

**Event Data:**
- `post_id` - ID of the post that was unliked
- `user_id` - ID of the user who unliked

---

### 7. Thread Likes (`onThreadLike`)
**NEW!** Triggered when someone likes a thread created by the bot.

```lua
function onThreadLike(data)
    bot.log("info", "User " .. data.user_id .. " liked my thread!")
    
    -- Get thread info
    local thread = bot.getThread(data.thread_id)
    if thread then
        bot.log("info", "Thread: " .. thread.title)
    end
end
```

**Event Data:**
- `thread_id` - ID of the thread that was liked
- `user_id` - ID of the user who liked
- `like_id` - ID of the like record

---

### 8. Thread Unlikes (`onThreadUnlike`)
**NEW!** Triggered when someone unlikes a thread created by the bot.

```lua
function onThreadUnlike(data)
    bot.log("info", "User " .. data.user_id .. " unliked my thread")
end
```

**Event Data:**
- `thread_id` - ID of the thread that was unliked
- `user_id` - ID of the user who unliked

---

## Bot API Functions

### Like Management

#### `bot.likePost(postId)`
Like a post.

```lua
local success, likeId = bot.likePost("post-uuid-here")
if success then
    bot.log("info", "Liked post: " .. likeId)
else
    bot.log("error", "Failed to like: " .. likeId)
end
```

**Returns:** `(success: boolean, result: string)`
- On success: `(true, likeId)`
- On failure: `(false, errorMessage)`

---

#### `bot.unlikePost(postId)`
Unlike a post.

```lua
local success, error = bot.unlikePost("post-uuid-here")
if success then
    bot.log("info", "Unliked post")
end
```

**Returns:** `(success: boolean, error?: string)`

---

#### `bot.likeThread(threadId)`
Like a thread.

```lua
local success, likeId = bot.likeThread("thread-uuid-here")
if success then
    bot.log("info", "Liked thread: " .. likeId)
end
```

**Returns:** `(success: boolean, result: string)`

---

#### `bot.unlikeThread(threadId)`
Unlike a thread.

```lua
local success = bot.unlikeThread("thread-uuid-here")
```

**Returns:** `(success: boolean, error?: string)`

---

## Example: Like Counter Bot

```lua
-- Track likes received
local likeCount = 0

function onPostLike(data)
    likeCount = likeCount + 1
    bot.log("info", "Total likes received: " .. likeCount)
    
    -- Get user who liked
    local user = bot.getUser(data.user_id)
    if user then
        -- Thank them in the post comments
        local post = bot.getPost(data.post_id)
        if post then
            bot.sendThreadPost(
                post.thread_id,
                "Thanks @" .. user.username .. " for the like! 💙"
            )
        end
    end
end

function onThreadPost(data)
    -- Auto-like posts that mention the bot
    if string.find(data.content, "@" .. bot.username) then
        bot.log("info", "Mentioned in post, liking it")
        bot.likePost(data.post_id)
    end
end
```

---

## Example: Engagement Bot

```lua
function onPostLike(data)
    -- When someone likes our post, like their recent posts back
    bot.log("info", "User " .. data.user_id .. " liked our post, returning the favor")
    
    -- Note: You'd need to implement getRecentPosts or similar
    -- This is just a conceptual example
end

function onThreadLike(data)
    -- Track thread popularity
    local thread = bot.getThread(data.thread_id)
    if thread then
        bot.log("info", "Thread '" .. thread.title .. "' received a like!")
    end
end

function onPostUnlike(data)
    -- Log when someone unlikes
    bot.log("warn", "Post " .. data.post_id .. " was unliked by " .. data.user_id)
end
```

---

## Event Triggering Rules

### When Bot Receives Events:

1. **Chat Messages**: Bot must be a member of the conversation
2. **Thread Posts**: Bot must be mentioned (`@botname.bot`) in the post content
3. **Wall Posts/Comments**: Event must be on the bot's own wall
4. **Post Likes**: The liked post must be authored by the bot
5. **Thread Likes**: The liked thread must be authored by the bot

### Rate Limits:

- Maximum 10 actions per minute per bot
- Enforced via Redis rate limiting
- Applies to: sending messages, creating posts, liking/unliking

---

## Best Practices

1. **Always check return values** from bot API functions
2. **Use `bot.log()` liberally** for debugging
3. **Handle errors gracefully** - don't crash on failed operations
4. **Respect rate limits** - use `bot.sleep()` if needed
5. **Be mindful of spam** - don't auto-like everything
6. **Test thoroughly** before activating your bot

---

## Security Notes

- Bots cannot decrypt user messages (they receive plaintext with `BOT_PLAINTEXT:` prefix)
- Bots can only interact with content they have access to
- Bots are sandboxed - no file system or network access (except via bot API)
- Bot code is limited to 10KB
- Execution timeout: 5 seconds per event

---

## Debugging

Check bot logs via API:
```bash
GET /api/v1/bots/:id/logs
```

Or in the web interface: Bots → Your Bot → Logs tab

Common issues:
- "Rate limit exceeded" - Bot is making too many requests
- "Bot is not a member" - Bot needs to be added to conversation
- "Already liked" - Bot already liked this content
- "Like not found" - Trying to unlike something not liked
