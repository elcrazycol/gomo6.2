# Thread Attachments - Implementation & Troubleshooting Guide

## Overview
This document describes how attachments (images, audio, video, files) work in thread posts, and documents the fixes applied to make them functional.

## Architecture

### Data Flow
1. **Frontend Upload**: Files are uploaded directly to Garage S3 via presigned URLs
2. **Backend API**: Post creation goes through Go backend (`POST /rest/v1/posts`)
3. **Database**: Attachments stored as JSONB in `posts.attachments` column
4. **Display**: Frontend renders attachments from post data

### Key Components

#### Frontend (`apps/web/src/`)
- `pages/Thread.tsx` - Main thread page, handles post creation
- `utils/mediaUpload.ts` - File upload logic with presigned URLs
- `components/ThreadAttachmentUpload.tsx` - Attachment UI component

#### Backend (`apps/backend-go/`)
- `internal/api/handlers/posts.go` - Post CRUD handlers
- `internal/models/models.go` - Post and AttachmentMeta structs
- `internal/storage/handlers/upload.go` - Presigned URL generation

#### Database
- `posts` table with `attachments JSONB` column
- Migration: `017_add_posts_attachments.sql`

## Critical Implementation Details

### 1. Post Creation API Flow

**Request Format (Frontend → Backend)**:
```json
{
  "thread_id": "uuid",
  "content": "text content",
  "content_json": {"root": {...}},
  "image_urls": ["url1", "url2"],
  "attachments": [
    {
      "url": "user_id/timestamp_filename.jpg",
      "type": "image",
      "mime": "image/jpeg",
      "name": "original_filename.jpg",
      "size": 12345,
      "poster": "optional_thumbnail_url"
    }
  ],
  "reply_to": "uuid_or_null",
  "is_private": false,
  "private_recipient_id": null
}
```

**Response Format (Backend → Frontend)**:
```json
{
  "data": {
    "id": "post_uuid",
    "thread_id": "uuid",
    "content": "text",
    "attachments": [...],
    ...
  },
  "error": null
}
```

**Important**: Frontend must extract `response.data.data` (not just `response.data`)

### 2. File Upload Flow

1. User selects file in `ThreadAttachmentUpload.tsx`
2. `mediaUpload.ts` calls `uploadAttachments()`:
   - Gets presigned URL from backend: `POST /storage/v1/presign-upload`
   - Uploads file directly to Garage S3 via PUT request
   - Returns attachment metadata with S3 key
3. Attachment metadata stored in component state
4. On post submit, attachments included in POST body

### 3. Database Schema

```sql
-- Migration: 017_add_posts_attachments.sql
ALTER TABLE posts ADD COLUMN IF NOT EXISTS attachments JSONB;
```

Attachments stored as JSONB array:
```json
[
  {
    "url": "user_id/timestamp_random.jpg",
    "type": "image|video|audio|file",
    "mime": "image/jpeg",
    "name": "original_filename.jpg",
    "size": 12345,
    "poster": "thumbnail_key_or_null"
  }
]
```

### 4. Backend Go Types

```go
// models/models.go
type Post struct {
    ID                 string          `json:"id" db:"id"`
    ThreadID           string          `json:"thread_id" db:"thread_id"`
    Content            string          `json:"content" db:"content"`
    ContentJSON        json.RawMessage `json:"content_json" db:"content_json"`
    ImageURL           *string         `json:"image_url" db:"image_url"`
    ImageURLs          JSONB           `json:"image_urls" db:"image_urls"`
    Attachments        JSONB           `json:"attachments" db:"attachments"`  // ← Critical field
    ReplyTo            *string         `json:"reply_to" db:"reply_to"`
    IsPrivate          bool            `json:"is_private" db:"is_private"`
    PrivateRecipientID *string         `json:"private_recipient_id" db:"private_recipient_id"`
    ServerDomain       string          `json:"server_domain" db:"server_domain"`
    CreatedAt          time.Time       `json:"created_at" db:"created_at"`
    IsRemote           bool            `json:"is_remote" db:"is_remote"`
}

type CreatePostRequest struct {
    ThreadID           string          `json:"thread_id"`
    Content            string          `json:"content"`
    ContentJSON        json.RawMessage `json:"content_json,omitempty"`
    ImageURLs          []string        `json:"image_urls"`
    Attachments        JSONB           `json:"attachments,omitempty"`  // ← Must be included
    ReplyTo            *string         `json:"reply_to,omitempty"`
    ThreadServerDomain string          `json:"thread_server_domain,omitempty"`
}
```

### 5. Backend Handler Implementation

**CreatePost** (`posts.go`):
- Must include `attachments` in INSERT query
- Must include `attachments` in RETURNING clause
- Must include `attachments` in Scan call

```go
query := `
    INSERT INTO posts (thread_id, user_id, content, content_json, image_url, image_urls, attachments, reply_to, server_domain)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, thread_id, user_id, content, content_json, image_url, image_urls, attachments, reply_to, is_private, private_recipient_id, server_domain, created_at, is_remote
`

err = h.db.QueryRow(query,
    req.ThreadID, userClaims.UserID, req.Content, insertContentJSON, imageURL,
    imageURLs, req.Attachments, req.ReplyTo, "localhost:8080",
).Scan(
    &post.ID, &post.ThreadID, &post.UserID, &post.Content, &retContentJSON,
    &post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
    &post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
)
```

### 6. Frontend Implementation

**Post Submission** (`Thread.tsx`):
```typescript
const response = await fetch('http://localhost:8080/rest/v1/posts', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
  },
  body: JSON.stringify({
    thread_id: threadId,
    content: content.trim(),
    content_json: contentJson,
    image_urls: imageUrlsJson,
    attachments: attachments.length > 0 ? attachments : null,
    reply_to: replyingTo,
    is_private: isPrivateMessage,
    private_recipient_id: isPrivateMessage ? privateRecipientId : null,
  }),
});

const data = await response.json();
// IMPORTANT: Extract post from SupabaseResponse wrapper
const postData = data.data || data;
```

## Common Issues & Fixes

### Issue: Attachments not displaying in posts

**Causes:**
1. Missing `attachments` column in database
2. Backend not including `attachments` in SQL SELECT/INSERT/RETURNING
3. Backend not including `attachments` in Scan call
4. Frontend not sending attachments in request body
5. Frontend not extracting `data.data` from response

**Fixes Applied:**
1. Created migration `017_add_posts_attachments.sql`
2. Updated `CreatePost` handler to include attachments in all SQL operations
3. Updated frontend to use backend API instead of direct Supabase insert
4. Fixed frontend response parsing (`data.data` not `data`)

### Issue: "Presign failed: 500" error

**Cause:** Garage S3 not accessible from nginx proxy

**Fix:** 
- Changed `garage.toml` to bind to `0.0.0.0:3900` instead of `[::]:3900`
- Restarted garage-proxy container

### Issue: Duplicate posts appearing

**Cause:** Frontend adding response wrapper to state instead of actual post

**Fix:** Changed `setPosts(data)` to `setPosts(data.data || data)`

### Issue: "Invalid time value" error

**Cause:** `post.created_at` undefined due to incorrect response parsing

**Fix:** Added null checks and fallback in date formatting

## Testing Checklist

- [ ] Upload image to post
- [ ] Verify image displays in thread
- [ ] Check database has attachments JSONB
- [ ] Verify no duplicate posts
- [ ] Test empty post prevention (should fail with no text AND no attachments)
- [ ] Test audio/video file upload
- [ ] Check multiple attachments in single post

## Related Files

### Critical Files (must check if issues occur)
- `/apps/backend-go/migrations/017_add_posts_attachments.sql`
- `/apps/backend-go/internal/api/handlers/posts.go` (CreatePost, GetPosts, GetPost)
- `/apps/backend-go/internal/models/models.go` (Post struct, CreatePostRequest)
- `/apps/web/src/pages/Thread.tsx` (handleSubmitPost)
- `/apps/web/src/utils/mediaUpload.ts` (uploadAttachments)

### Configuration
- `/apps/backend-go/garage.toml` - S3 binding configuration
- `/apps/backend-go/garage-nginx-proxy.conf` - Proxy settings
- `/apps/backend-go/docker-compose.yml` - Service orchestration

## Debugging Commands

```bash
# Check if attachments column exists
docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -c "\d posts"

# Check recent posts with attachments
docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -c "SELECT id, attachments FROM posts ORDER BY created_at DESC LIMIT 5;"

# Check backend logs for attachment processing
docker logs backend-go-backend-1 --tail 50 | grep -i "attachments\|createpost"

# Verify S3/Garage is accessible
curl http://localhost:3900/content

# Test presign endpoint
curl -X POST http://localhost:8080/storage/v1/presign-upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"bucket":"content","key":"test.jpg","content_type":"image/jpeg"}'
```

## Migration from Direct Supabase to Backend API

The frontend was changed from direct Supabase insertion to backend API:

**Before (broken)**:
```typescript
await supabase.from("posts").insert({
  thread_id: threadId,
  user_id: user.id,
  content: content.trim(),
  attachments: attachments,
  ...
})
```

**After (working)**:
```typescript
await fetch('http://localhost:8080/rest/v1/posts', {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({
    thread_id: threadId,
    content: content.trim(),
    attachments: attachments,
    ...
  })
})
```

This was necessary because:
1. Backend API handles all database columns correctly
2. Backend validates empty posts (no text + no attachments)
3. Backend returns proper SupabaseResponse format
4. Frontend can properly parse the response

## Date: April 4, 2026
## Status: ✅ WORKING
