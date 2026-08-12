# Thread Attachments - Implementation & Troubleshooting Guide

## Overview
This document describes how attachments (images, audio, video, files) work in thread posts, and documents the fixes applied to make them functional.

## Architecture

### Data Flow
1. **Frontend Upload**: Browser sends the file to the backend (`POST /storage/v1/upload`), backend uploads to Garage S3 server-side (no browser-facing presigned URLs / CORS)
2. **Backend API**: Post creation goes through Go backend (`POST /rest/v1/posts`)
3. **Database**: Attachments stored as JSONB in `posts.attachments` column
4. **Display**: Frontend renders attachments via the Go proxy `/storage/v1/object/<bucket>/<key>` (bucket `uploads` requires auth)

### Key Components

#### Frontend (`apps/web/src/`)
- `pages/Thread.tsx` - Main thread page, handles post creation
- `utils/mediaUpload.ts` - File upload logic (server-side upload)
- `utils/storage.ts` - URL helpers for `/storage/v1/object/...`
- `components/ThreadAttachmentUpload.tsx` - Attachment UI component

#### Backend (`apps/backend-go/`)
- `internal/api/handlers/posts.go` - Post CRUD handlers
- `internal/models/models.go` - Post and AttachmentMeta structs
- `internal/storage/handlers/upload.go` - Server-side upload to Garage (`UploadFileWithKey`); old `presign-upload` replaced by this flow

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
   - `POST /storage/v1/upload` (multipart, with `Authorization` header) — backend streams the file to Garage S3 (`UploadFileWithKey`)
   - Backend returns attachment metadata with the S3 key (`/storage/v1/object/<bucket>/<key>`)
3. Attachment metadata stored in component state
4. On post submit, attachments included in POST body

> The previous flow (`POST /storage/v1/presign-upload` + direct browser PUT to Garage) was **removed**: browser-facing presigned URLs leaked the S3 endpoint and required CORS. All files now go through the authenticated Go proxy.

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
    // Auth is handled via HttpOnly cookies — the fetch inherits the session
    // automatically, no token needs to be read from storage.
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
// IMPORTANT: Extract post from the API response wrapper
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
3. Updated frontend to use backend API instead of direct database insert
4. Fixed frontend response parsing (`data.data` not `data`)

### Issue: "Presign failed: 500" error

**Historical note:** This issue belongs to the removed `presign-upload` flow
(browser → presigned PUT to Garage). That flow was deleted — all files now go
through the authenticated Go proxy (`POST /storage/v1/upload`, see "File
Upload Flow" above), so this error can no longer occur.

**Old cause:** Garage S3 not accessible from the nginx proxy

**Old fix:**
- Changed `garage.toml` to bind to `0.0.0.0:3900` instead of `[::]:3900`
- Restarted the garage-proxy container

**Current equivalent:** if attachments fail to display, verify Garage is
reachable through the authenticated Go proxy (`curl .../storage/v1/object/...`,
see Debugging Commands below). Public reads go Browser → Caddy → Garage
directly; private `uploads`/`wall` reads go through the Go proxy with access
checks.

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
- `/apps/backend-go/garage.toml` - **шаблон** S3-конфига (плейсхолдеры `__GARAGE_RPC_SECRET__` / `__GARAGE_ADMIN_TOKEN__`, секретов в Git нет)
- `scripts/generate-garage-config.sh` - рендер runtime `.garage.toml` из `.env` (mode 600)
- `docker-compose.yml` - Service orchestration (порты Garage/DB/Redis наружу не публикуются)

## Debugging Commands

```bash
# Check if attachments column exists
docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -c "\d posts"

# Check recent posts with attachments
docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -c "SELECT id, attachments FROM posts ORDER BY created_at DESC LIMIT 5;"

# Check backend logs for attachment processing
docker logs backend-go-backend-1 --tail 50 | grep -i "attachments\|createpost"

# Verify S3/Garage is accessible (through the authenticated Go proxy)
curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/storage/v1/object/post-images/avatar_placeholder.svg  # 200 — Garage доступен

# Test server-side upload endpoint
curl -X POST http://localhost:8080/storage/v1/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@test.jpg" \
  -F "bucket=uploads"
```## Historical: migration from direct DB access to Backend API
> Historical context only. The project previously talked to a hosted PostgREST
> backend (whose SDK was branded "Supabase"); it now runs its own backend and
> the frontend uses `@/integrations/api/client` (PostgREST-compatible) with auth
> via HttpOnly cookies. The snippet below is the OLD approach, kept for reference.

The frontend was changed from direct insertion to backend API:

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
3. Backend returns proper API response wrapper format
4. Frontend can properly parse the response

## Date: April 4, 2026
## Status: ✅ WORKING
