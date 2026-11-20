# Messenger API v2 — client-ready contract

> Phase 1 (typed envelope + cursor sync) + Phase 2 (E2E contract + key
> directory). This document is the single entry point for writing a third-party
> messenger client (Rust, Swift, Kotlin, …). All endpoints live under
> `/api/v1/messenger`, auth via `Authorization: Bearer <JWT>`, responses wrapped
> as `{ "success": true, "data": … }`.

## 1. Concepts

| Concept | Meaning |
|---|---|
| `conversation` | 1:1 DM, group, notes self-chat or service thread. `GET /conversations` lists mine. |
| `encryption_mode` | `"server"` (server-side AES-GCM at rest, default) or `"e2e"` (opaque client ciphertext, 1:1 only). Echoed on every conversation. |
| `type` + `payload` | Typed envelope on every message: `"text" \| "media" \| "voice" \| "gift" \| "share" \| "system"`. `payload` is a JSON object (`gift_*`, `target_type/target_id`, …). Legacy `__GIFT__:` / `__SHARE__:` tokens are normalized server-side, so clients only read `type`/`payload`. |
| `event_id` | Monotonic BIGINT cursor (decimal string). Bumped on send **and** on edit/delete. The only cursor you need. |
| `enc` | `{"v": 1, "alg": "p256-aesgcm"}` on opaque E2E messages; absent on server-mode messages. |

## 2. Reading

```
GET /conversations
→ [{ id, last_message_at, last_message_preview, …, other_user_id,
      other_last_read_at, other_last_delivered_at,
      is_group, member_count, encryption_mode, is_notes }]

GET /conversations/:id/messages?limit=50
GET /conversations/:id/messages?before=<messageId>&limit=50   # backward page
GET /conversations/:id/messages?since_event_id=<cursor>       # delta sync (reconnect)
```

Rules: `before` and `since_event_id` are mutually exclusive. Delta pages come
`event_id ASC` (append directly); backward pages come newest-first and must be
reversed. Deleted messages arrive as `{ is_deleted: true, content: "" }` —
**with a fresh `event_id`**, so a delta sync never misses an edit/delete that
happened while offline.

`other_last_read_at` / `other_last_delivered_at` are the peer's cursors —
compare with `last_message_at` for `✓` / `✓✓` in the list. No per-message
receipt fetch is needed.

`client_id` is idempotency: `UNIQUE(conversation_id, client_id)`. Re-POST the
same `client_id` after a timeout and the server returns the stored row.

## 3. Writing

```
POST /conversations {"user_id"}              → { conversation_id }   # 1:1 find-or-create
POST /notes                                   → { conversation_id }   # personal self-chat
POST /conversations/:id/messages
  {"content", "client_id", "type?", "payload?", "parent_message_id?", "attachments?"}
PUT    /conversations/:id/messages/:msgId {"content"}
DELETE /conversations/:id/messages/:msgId
POST /conversations/:id/read      {"message_id"}   # read line: marks the whole prefix
POST /conversations/:id/delivered {"message_id"}   # delivery line (prefix)
POST /conversations/:id/pin       {"message_id"}   # toggle
DELETE /conversations/:id/leave
POST /conversations/:id/encryption {"mode": "server"|"e2e"}  # 1:1 only
PUT  /conversations/:id/messages/:msgId   {"content"}
DELETE /conversations/:id/messages/:msgId
```

**Deleting is real.** The row's `content`, `payload`, `notes_meta` and the `enc`
envelope are wiped, its attachments/reactions/voice-marks/receipts are removed,
the S3 objects (original + image preview derivative) are deleted, the
conversation is unpinned if it pinned this message, the chat-list preview is
recomputed from the newest surviving message (cleared when none survive) and
the peer's unread badge is recomputed. The tombstone keeps only its identity and
a fresh `event_id`, so a delta sync still sees the deletion.

**1:1 write policy.** Creating a chat or sending into one is refused with `403`
when either side has blocked the other, or when the recipient set
`allow_private_messages = false` and you are not a mutual friend. The same gate
covers every shared-state mutation of a 1:1 chat — edit, reaction, voice-listen
mark and pin — so a blocked user cannot poke the peer through a side channel.
Groups are not gated (a block does not silence group chat, like Telegram).
Service threads are read-only for users.

The block list itself is private to the blocker:

```
GET    /messenger/blocks                 → [{user_id, username, display_name, avatar_url?, blocked_at}]
POST   /messenger/blocks/:userId         → {blocked: true}   (idempotent)
DELETE /messenger/blocks/:userId         → {blocked: false}  (idempotent)
```

A block never deletes history on either side and never tells the blocked user
that it happened (the send simply fails with a generic reason). Read paths
(history, receipts) stay available, as in Telegram.

`ids=` exists for the notes pinned strip: pins live in client-encrypted metadata,
so the server cannot list them, and the device asks for the handful of ids it
knows instead of walking the whole history page by page.

**Client reading model.** The messenger opens a chat on one page (the notes
self-chat included) and paginates with `before`. The last five opened chats are
kept decrypted in an in-memory LRU, so switching back paints the messages in the
same frame while the network refresh runs; hovering a row warms that LRU from
IndexedDB without a request. Message timestamps are laid out by an invisible
inline twin of the pill (reserving its exact width during normal line breaking),
not by measuring the DOM.

**Membership is explicit.** Every messenger handler asks
`chat_members` whether the caller belongs to the conversation instead of relying
on row-level security: the deployment connects with a superuser role in the
standard Compose setup, and a superuser bypasses RLS entirely.

Server-mode content is validated as plaintext (≤4000 runes, no HTML tags);
opaque conversations (notes / `e2e`) must send the client envelope verbatim
(see §5) and get a generic push body so ciphertext never lands in a push.

Delete wipes `content`, `payload`, `notes_meta` and the `enc` envelope and
bumps `event_id` — no recoverable blob remains.

## 4. Realtime (WebSocket `/ws`)

1. Open WS, send `{"type":"auth","data":{"token":"<JWT>"}}` as the first frame.
2. The server auto-subscribes you to `messenger_user_<yourId>` — **every**
   messenger event for **every** conversation arrives there. No per-chat
   `chat_<id>` subscription loop is needed (only the open chat subscribes for
   ephemeral `chat_typing`).
3. Strip the routing-only `recipient_ids` key if present (never render it).

Events (all carry `conversation_id`):

| type | payload |
|---|---|
| `new_chat_message` | full message (`content` **or** `encrypted_content` for server mode; `content` verbatim for opaque; `type`/`payload`/`enc`/`attachments`/`event_id`) |
| `message_edited` | `{id, content\|encrypted_content, enc?, edited_at}` |
| `message_deleted` | `{id}` |
| `message_reaction` | delta `{message_id, emoji, user_id, username, action: add\|remove}` — fold into your own chips |
| `message_voice_listened` | `{message_id, user_id}` |
| `read_receipt` | `{message_id, user_id, read_at}` — advance `other_last_read_at` + open-chat chips, no `GET /receipts` needed |
| `delivery_receipt` | `{message_id, user_id, delivered_at}` — same for `✓✓` |
| `conversation_updated` | `{encryption_mode?}` or `{preview_changed: true}` — refetch `/conversations` (authoritative: decrypts notes/e2e previews, picks up unpins) |
| `chat_typing` | `{user_id, username, is_typing}` (open-chat room only) |
| `member_left`, `group_updated`, `message_notes_meta` | housekeeping, same room routing |

`encrypted_content` (server mode) must be decrypted client-side with the
per-conversation key only if you hold it — the reference web client never does:
it receives `content` plaintext over the user stream because the hub decrypts
with the server key before fan-out. Opaque payloads are never decrypted
server-side.

## 5. E2E 1:1 (Phase 2 contract)

Opt-in per 1:1 conversation via `POST …/encryption {"mode":"e2e"}` (groups,
notes and service threads are rejected). History stays readable (old
server-mode rows keep decrypting); only new rows are opaque.

Wire format: `e2e1:<alg>:<base64(iv || ciphertext)>`, `alg = p256-aesgcm`.

Crypto (all standard WebCrypto / Rust `p256` + `aes-gcm`):

1. Generate ECDH P-256 device keypair per device; publish the public JWK:
   `PUT /keys {"device_id", "public_key": "<JWK JSON string>", "alg"}`.
2. Fetch the peer's key: `GET /users/:userId/keys` (also `GET /keys` for own,
   `DELETE /keys/:deviceId` to revoke).
3. Shared secret = ECDH(priv_self, pub_peer) → HKDF-SHA256
   (`salt = "gomo6:e2e-hkdf:<conversationId>"`, `info = "aes-256-gcm"`) →
   AES-256-GCM key.
4. AAD = `gomo6:e2e:<conversationId>:<senderId>` (binds conversation + author).
   12-byte random IV prepended to the ciphertext, standard base64.

The server validates only the shape (`e2e1:` prefix, known alg, size cap) and
stores/forwards the blob verbatim, including previews and realtime frames.
**Current limits (by design, Phase 2–3):** attachment bytes are *not* encrypted
end-to-end (files live in S3 as uploaded); device identity keys are static (no
prekey bundles / rotation yet, so no forward secrecy); E2E is opt-in per 1:1 chat
and has no UI toggle yet.

Reference implementation: `apps/web/src/utils/messengerCrypto.ts`
(`encryptE2EMessage` / `decryptE2EMessage`); Go validators:
`parseE2EEnvelope` / `validateE2EPayload` in `messenger_e2e.go`.
