package messenger

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// ─── Conversation access ─────────────────────────────────────────────────────
// One query answers everything a messenger handler needs about a conversation:
// whether the caller is a member (the row is only visible to members thanks to
// the chat_conversations RLS policy), its kind (group / notes / service), its
// encryption mode and — for a 1:1 chat — the peer's user id.
//
// Before this helper the hot paths asked three separate questions
// (isMember → isNotesConversation → isE2EConversation), which is three
// round trips per message page and per send. The consolidated shape is one
// round trip and cannot disagree with itself mid-request.

type conversationAccess struct {
	ID             string
	IsMember       bool
	IsGroup        bool
	IsNotes        bool
	IsService      bool
	EncryptionMode string
	// OtherUserID is the peer in a 1:1 chat, empty for groups/notes.
	OtherUserID string
	// PeerBlockedMe is true when the 1:1 peer holds a block against the caller.
	// Such a block erases the peer for the caller: no history, no media, no
	// presence, and sends are accepted-but-dropped (never delivered, never
	// stored) so the caller cannot tell a block from a silent chat.
	PeerBlockedMe bool
}

// IsE2E reports whether the conversation stores opaque client ciphertext.
func (a *conversationAccess) IsE2E() bool { return a.EncryptionMode == encryptionModeE2E }

// IsOpaque reports whether the server must store + forward content verbatim.
func (a *conversationAccess) IsOpaque() bool { return a.IsNotes || a.IsE2E() }

// conversationAccessQuery answers the whole authorization question in one
// round trip. Membership is an EXPLICIT predicate, not an RLS side effect:
// the deployment connects as a superuser in some setups (Compose uses
// POSTGRES_USER), and a superuser bypasses row security entirely — relying on
// the policy alone would let a stranger read any conversation.
const conversationAccessQuery = `
	SELECT
		c.id,
		EXISTS(
			SELECT 1 FROM chat_members
			WHERE conversation_id = c.id AND user_id = $2
		) AS is_member,
		COALESCE(c.is_group, false),
		COALESCE(c.is_notes, false),
		COALESCE(c.is_service, false),
		COALESCE(c.encryption_mode, 'server'),
		COALESCE((
			SELECT cm2.user_id::text
			FROM chat_members cm2
			WHERE cm2.conversation_id = c.id AND cm2.user_id <> $2
			LIMIT 1
		), ''),
		COALESCE((
			SELECT EXISTS(
				SELECT 1 FROM user_blocks b
				WHERE b.blocker_id = cm2.user_id AND b.blocked_id = $2
			)
			FROM chat_members cm2
			WHERE cm2.conversation_id = c.id AND cm2.user_id <> $2
			LIMIT 1
		), false)
	FROM chat_conversations c
	WHERE c.id = $1`

// loadAccess reads the caller's view of a conversation in one query. A
// conversation the caller is not a member of is invisible under RLS, so
// ErrNoRows means "not a member" — never an error. On a database failure the
// handler response is written and ok=false is returned.
func (h *MessengerHandler) loadAccess(c *gin.Context, conversationID, userID string) (*conversationAccess, bool) {
	access := &conversationAccess{ID: conversationID, EncryptionMode: encryptionModeServer}
	err := h.dbFor(c).QueryRow(conversationAccessQuery, conversationID, userID).Scan(
		&access.ID,
		&access.IsMember,
		&access.IsGroup,
		&access.IsNotes,
		&access.IsService,
		&access.EncryptionMode,
		&access.OtherUserID,
		&access.PeerBlockedMe,
	)
	if err == sql.ErrNoRows {
		// The conversation does not exist (or is hidden by RLS when the
		// connection is NOT a superuser): treat both as "not a member".
		return access, true
	}
	if err != nil {
		httpx.ServerError(c, "load conversation access", err)
		return nil, false
	}
	return access, true
}

// requireMember loads the access and writes 403 when the caller is not a
// member. Returns nil when the request must stop.
func (h *MessengerHandler) requireMember(c *gin.Context, conversationID, userID string) *conversationAccess {
	access, ok := h.loadAccess(c, conversationID, userID)
	if !ok {
		return nil
	}
	if !access.IsMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return nil
	}
	return access
}

// enforceDirectWritePolicy applies the 1:1 gate to a mutation that changes shared
// state (send, edit, reaction, voice mark, pin). Groups and notes are exempt: a
// personal block must never silence a group, and notes have no peer.
//
// It writes the response and returns false when the request must stop.
func (h *MessengerHandler) enforceDirectWritePolicy(c *gin.Context, access *conversationAccess, userID string) bool {
	if access == nil || access.IsGroup || access.IsNotes || access.OtherUserID == "" {
		return true
	}
	allowed, reason, err := h.canSendDirect(c, userID, access.OtherUserID)
	if err != nil {
		httpx.ServerError(c, "check direct message policy", err)
		return false
	}
	if !allowed {
		c.JSON(http.StatusForbidden, models.ErrorResponse(reason))
		return false
	}
	return true
}

// ─── Block list (1:1 spam control) ──────────────────────────────────────────

// BlockedUser is one entry of the caller's block list. Only the blocker can
// read their own list; the blocked side learns nothing.
type BlockedUser struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	BlockedAt   string `json:"blocked_at"`
}

// ListBlockedUsers godoc
// @Summary      List blocked users
// @Router       /messenger/blocks [get]
func (h *MessengerHandler) ListBlockedUsers(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	rows, err := h.dbFor(c).Query(`
		SELECT b.blocked_id,
		       COALESCE(u.username, ''),
		       COALESCE(u.display_name, ''),
		       COALESCE(u.avatar_url, ''),
		       b.created_at
		FROM user_blocks b
		LEFT JOIN users u ON u.id = b.blocked_id
		WHERE b.blocker_id = $1
		ORDER BY b.created_at DESC
	`, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "list blocked users", err)
		return
	}
	defer rows.Close()

	blocked := make([]BlockedUser, 0, 8)
	for rows.Next() {
		var entry BlockedUser
		var blockedAt time.Time
		if err := rows.Scan(&entry.UserID, &entry.Username, &entry.DisplayName, &entry.AvatarURL, &blockedAt); err != nil {
			httpx.ServerError(c, "scan blocked user", err)
			return
		}
		entry.BlockedAt = blockedAt.UTC().Format(time.RFC3339)
		blocked = append(blocked, entry)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "iterate blocked users", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(blocked))
}

// BlockUser godoc
// @Summary      Block a user for direct messages
// @Router       /messenger/blocks/{userId} [post]
func (h *MessengerHandler) BlockUser(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	targetID := c.Param("userId")
	if !isUUID(targetID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user id"))
		return
	}
	if targetID == claims.UserID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("You cannot block yourself"))
		return
	}

	var exists bool
	if err := h.dbFor(c).QueryRow(
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, targetID,
	).Scan(&exists); err != nil {
		httpx.ServerError(c, "check block target", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
		return
	}

	res, err := h.dbFor(c).Exec(`
		INSERT INTO user_blocks (blocker_id, blocked_id)
		VALUES ($1, $2)
		ON CONFLICT (blocker_id, blocked_id) DO NOTHING
	`, claims.UserID, targetID)
	if err != nil {
		httpx.ServerError(c, "block user", err)
		return
	}
	if affected, _ := res.RowsAffected(); affected > 0 {
		h.publishBlockState(claims.UserID, targetID, true)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"blocked": true}))
}

// UnblockUser godoc
// @Summary      Unblock a user
// @Router       /messenger/blocks/{userId} [delete]
func (h *MessengerHandler) UnblockUser(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	targetID := c.Param("userId")
	if !isUUID(targetID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user id"))
		return
	}

	res, err := h.dbFor(c).Exec(
		`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
		claims.UserID, targetID,
	)
	if err != nil {
		httpx.ServerError(c, "unblock user", err)
		return
	}
	if affected, _ := res.RowsAffected(); affected > 0 {
		h.publishBlockState(claims.UserID, targetID, false)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"blocked": false}))
}

// publishBlockState pushes a block/unblock through every realtime surface that
// has to react without a reload:
//
//   - the blocked user's live presence subscriptions to the blocker are revoked
//     (a block can never be outrun by an already-open chat);
//   - the blocked user instantly receives a presence snapshot: long-gone
//     offline on block, the real state on unblock;
//   - both sides refetch their conversation lists (avatar/preview/presence move
//     in one sweep) and the blocker's profile is invalidated everywhere, so a
//     profile page open on the blocked user's screen empties itself.
//
// Everything is best effort: the database is already authoritative and the
// next REST read heals any missed event. No payload here says "blocked" — the
// blocked side only ever sees neutral "refetch"/"presence" signals.
func (h *MessengerHandler) publishBlockState(blockerID, blockedID string, blocked bool) {
	if h.hub == nil || blockerID == "" || blockedID == "" {
		return
	}
	go func() {
		if blocked {
			h.hub.RevokeProfileVisibility(blockedID, blockerID)
			// «был(а) давно» — the same threshold the REST paths use.
			h.hub.SendPresenceSnapshotToUser(blockedID, blockerID, false, time.Now().UTC().Add(-30*24*time.Hour))
		} else {
			online, lastSeen := h.hub.GetPresenceStatus(blockerID)
			h.hub.SendPresenceSnapshotToUser(blockedID, blockerID, online, lastSeen)
		}
		_ = h.hub.PublishMessengerRefresh(blockedID)
		_ = h.hub.PublishMessengerRefresh(blockerID)
		_ = h.hub.PublishProfileUpdated(blockerID)
	}()
}

// ─── 1:1 send policy (blocks, privacy, friendship) ───────────────────────────

// directMessageDecision is the result of the 1:1 write gate.
type directMessageDecision struct {
	Blocked        bool
	Friends        bool
	AllowPrivateDM bool
}

// canSendDirect reports whether senderID may write to recipientID, plus a
// human-readable reason when not. It is one query:
//
//   - a block in EITHER direction forbids the message;
//   - a recipient who disabled allow_private_messages accepts only friends.
//
// A missing privacy row means the defaults (DM allowed).
func (h *MessengerHandler) canSendDirect(c *gin.Context, senderID, recipientID string) (bool, string, error) {
	if senderID == "" || recipientID == "" || senderID == recipientID {
		return false, "Invalid recipient", nil
	}
	var d directMessageDecision
	err := h.dbFor(c).QueryRow(`
		SELECT
			EXISTS(
				SELECT 1 FROM user_blocks
				WHERE (blocker_id = $1 AND blocked_id = $2)
				   OR (blocker_id = $2 AND blocked_id = $1)
			),
			EXISTS(
				SELECT 1 FROM friendships
				WHERE (user1_id = $1 AND user2_id = $2)
				   OR (user1_id = $2 AND user2_id = $1)
			),
			COALESCE((
				SELECT allow_private_messages FROM privacy_settings WHERE user_id = $2
			), true)
	`, senderID, recipientID).Scan(&d.Blocked, &d.Friends, &d.AllowPrivateDM)
	if err != nil {
		return false, "", err
	}
	if d.Blocked {
		return false, "Messaging is not available", nil
	}
	if !d.AllowPrivateDM && !d.Friends {
		return false, "This user accepts messages from friends only", nil
	}
	return true, "", nil
}
