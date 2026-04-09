# Bot Documentation Update Summary

## Updated Files

### 1. Event Handlers (`/apps/bot-docs/src/pages/EventHandlers.tsx`)

Added new section "События лайков" with 4 new events:

- **onPostLike** - когда кто-то лайкает пост бота
- **onPostUnlike** - когда кто-то убирает лайк с поста бота
- **onThreadLike** - когда кто-то лайкает тред бота
- **onThreadUnlike** - когда кто-то убирает лайк с треда бота

Each event includes:
- Full parameter documentation
- Event data structure
- Working code examples in Lua

### 2. API Reference (`/apps/bot-docs/src/pages/APIReference.tsx`)

Updated "Лайки и реакции" section with 4 functions:

- **bot.likePost(postId)** - лайкнуть пост
  - Returns: `(success: boolean, likeId: string)`
  - Includes error handling example

- **bot.unlikePost(postId)** - убрать лайк с поста
  - Returns: `(success: boolean, error?: string)`
  - Includes error handling example

- **bot.likeThread(threadId)** - лайкнуть тред
  - Returns: `(success: boolean, likeId: string)`
  - Includes error handling example

- **bot.unlikeThread(threadId)** - убрать лайк с треда
  - Returns: `(success: boolean, error?: string)`
  - Includes error handling example

### 3. Examples (`/apps/bot-docs/src/pages/Examples.tsx`)

Added 2 new complete bot examples:

#### Example 1: "Счетчик лайков"
- Tracks total likes received
- Thanks users who like bot's posts
- Responds to `/likes` command with statistics
- Demonstrates both `onPostLike` and `onPostUnlike` events

#### Example 2: "Бот взаимодействия"
- Returns likes to users who liked the bot
- Sends thank you messages when threads are liked
- Demonstrates `onPostLike` and `onThreadLike` events
- Shows user engagement patterns

Updated existing "Бот с лайками" example:
- Added proper error handling
- Shows return value usage
- Demonstrates `likePost()` function

## Documentation Features

All new documentation includes:

✅ Russian language (matching existing docs)
✅ Full parameter descriptions
✅ Return value documentation
✅ Working code examples
✅ Error handling patterns
✅ Best practices
✅ Real-world use cases

## Navigation

New content is accessible via:
- **События** → **События лайков** (4 events)
- **API** → **Лайки и реакции** (4 functions)
- **Примеры** → "Счетчик лайков" and "Бот взаимодействия"

## Code Quality

- All examples are syntactically correct Lua
- Follow existing code style and conventions
- Include proper error handling
- Use consistent naming patterns
- Include helpful comments

## User Experience

- Consistent with existing documentation style
- Easy to navigate via sidebar
- Clear, concise descriptions
- Practical, copy-paste ready examples
- Progressive complexity (simple → advanced)

## Testing Recommendations

Users can test new features by:
1. Creating a bot with `onPostLike` handler
2. Creating a post as the bot
3. Liking the post as another user
4. Checking bot logs for event reception
5. Verifying bot response (if implemented)

## Next Steps

Documentation is complete and ready for users. No further updates needed unless:
- New bot API functions are added
- Event data structures change
- New use cases are discovered
