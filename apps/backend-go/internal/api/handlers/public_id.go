package handlers

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/search"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// PublicIDHandler owns the admin-only assignment of public numbers
// (docs/wiki/PUBLIC_IDS.md §9). It is the ONLY writer of users.public_id:
// public_id is deliberately absent from every writable-column allow-list and
// from the typed update structs, so nothing else can set it.
type PublicIDHandler struct {
	db            *sql.DB
	redis         *redis.Client
	hub           *websocket.Hub
	searchIndexer *search.Indexer
}

func NewPublicIDHandler(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub) *PublicIDHandler {
	return &PublicIDHandler{db: db, redis: redisClient, hub: hub}
}

// SetSearchIndexer injects the best-effort search indexer (nil disables sync).
func (h *PublicIDHandler) SetSearchIndexer(idx *search.Indexer) { h.searchIndexer = idx }

type assignPublicIDRequest struct {
	UserID   string `json:"user_id"`
	PublicID int64  `json:"public_id"`
	Note     string `json:"note"`
}

// AssignPublicID godoc
// @Summary      Assign a public number to a user (admin)
// @Description  Hands a specific public number to a user. If another user holds it, that user is re-numbered in the same transaction (they receive the target's previous number, or a fresh one from the sequence) and the movement is written to the public_id_transfers ledger.
// @Tags         Admin
// @Accept       json
// @Produce      json
// @Param        body body assignPublicIDRequest true "user_id (UUID) and public_id (number)"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /admin/public-id/assign [post]
// @Security     BearerAuth
func (h *PublicIDHandler) AssignPublicID(c *gin.Context) {
	var req assignPublicIDRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_id and public_id are required"))
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	if _, err := uuid.Parse(req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id format"))
		return
	}
	// Numbers are allocated from sequences that start at 1; zero and negatives
	// can never be a real number, and a leading-zero form is not a public id.
	if req.PublicID <= 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("public_id must be a positive number"))
		return
	}
	actorID := httpx.AuthenticatedUserID(c)

	result, status, err := h.assign(c.Request.Context(), req, actorID)
	if err != nil {
		httpx.ServerError(c, "public id assign failed", err)
		return
	}
	if status != http.StatusOK {
		c.JSON(status, models.ErrorResponse(result.Error))
		return
	}

	h.invalidate(req.UserID, result.PreviousOwnerID)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// assignResult is the response body; it is also used internally to carry a
// validation failure out of the transaction.
type assignResult struct {
	Error                    string `json:"error,omitempty"`
	UserID                   string `json:"user_id,omitempty"`
	PublicID                 int64  `json:"public_id,omitempty"`
	PreviousOwnerID          string `json:"previous_owner_id,omitempty"`
	PreviousOwnerNewPublicID *int64 `json:"previous_owner_new_public_id,omitempty"`
	Unchanged                bool   `json:"unchanged,omitempty"`
}

// assign performs the swap in one transaction. Order matters: the number is
// released before it is assigned, otherwise the UNIQUE index on
// users(public_id) fires mid-transaction.
func (h *PublicIDHandler) assign(ctx context.Context, req assignPublicIDRequest, actorID string) (assignResult, int, error) {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return assignResult{}, 0, err
	}
	defer func() { _ = tx.Rollback() }()

	// Who holds the requested number right now? Lock that row first so two
	// concurrent assignments of the same number serialise instead of racing.
	var holderID sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM users WHERE public_id = $1 FOR UPDATE`, req.PublicID).Scan(&holderID)
	if err != nil && err != sql.ErrNoRows {
		return assignResult{}, 0, err
	}

	// The target must exist; lock it too.
	var currentID sql.NullInt64
	err = tx.QueryRowContext(ctx,
		`SELECT public_id FROM users WHERE id = $1 FOR UPDATE`, req.UserID).Scan(&currentID)
	if err == sql.ErrNoRows {
		return assignResult{Error: "User not found"}, http.StatusNotFound, nil
	}
	if err != nil {
		return assignResult{}, 0, err
	}

	if holderID.Valid && holderID.String == req.UserID {
		// Already holds it — idempotent, nothing to record.
		if err := tx.Commit(); err != nil {
			return assignResult{}, 0, err
		}
		return assignResult{UserID: req.UserID, PublicID: req.PublicID, Unchanged: true}, http.StatusOK, nil
	}

	res := assignResult{UserID: req.UserID, PublicID: req.PublicID}
	if holderID.Valid {
		res.PreviousOwnerID = holderID.String

		// Release the number. The previous holder takes the target's old number
		// when there is one — a clean exchange that burns no sequence value —
		// otherwise a fresh one.
		//
		// A two-way exchange has no valid intermediate state (each number is still
		// held by the other row), so the target is parked on a temporary
		// out-of-band value first. The sentinel is negative: the API rejects
		// non-positive numbers and Parse never produces one, so it is unreachable
		// through URLs, and it never escapes this transaction.
		var newNumber int64
		if currentID.Valid && currentID.Int64 != req.PublicID {
			newNumber = currentID.Int64
			if _, err := tx.ExecContext(ctx,
				`UPDATE users SET public_id = -1 WHERE id = $1`, req.UserID); err != nil {
				return assignResult{}, 0, err
			}
		} else {
			if err := tx.QueryRowContext(ctx,
				`SELECT nextval('users_public_id_seq')`).Scan(&newNumber); err != nil {
				return assignResult{}, 0, err
			}
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE users SET public_id = $1, updated_at = NOW() WHERE id = $2`,
			newNumber, holderID.String); err != nil {
			return assignResult{}, 0, err
		}
		res.PreviousOwnerNewPublicID = &newNumber

		// Ledger: the compensating move for the previous holder.
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO public_id_transfers (public_id, from_user_id, to_user_id, actor_id, note)
			 VALUES ($1, $2, $3, $4, $5)`,
			newNumber, req.UserID, holderID.String, nullIfEmpty(actorID), "released by transfer"); err != nil {
			return assignResult{}, 0, err
		}
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE users SET public_id = $1, updated_at = NOW() WHERE id = $2`,
		req.PublicID, req.UserID); err != nil {
		return assignResult{}, 0, err
	}

	// Ledger: the requested move. from_user_id is NULL when the number was not
	// held by anyone (a reserved band number handed out for the first time).
	var from interface{}
	if holderID.Valid {
		from = holderID.String
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO public_id_transfers (public_id, from_user_id, to_user_id, actor_id, note)
		 VALUES ($1, $2, $3, $4, $5)`,
		req.PublicID, from, req.UserID, nullIfEmpty(actorID), strings.TrimSpace(req.Note)); err != nil {
		return assignResult{}, 0, err
	}

	if err := tx.Commit(); err != nil {
		return assignResult{}, 0, err
	}
	return res, http.StatusOK, nil
}

// invalidate drops the server-side caches that embedded either user's number and
// tells connected clients to drop their copy of both profiles.
//
// The whole /profiles prefix is cleared on purpose: a response is cached both by
// UUID query (data:/api/v1/profiles?id=eq.<uuid>) and by the numeric path
// (data:/api/v1/profiles/42), and after a transfer BOTH forms change owner. A
// transfer is a rare admin action, so clearing the surface wholesale is cheaper
// than enumerating the four affected keys correctly.
//
// The crawler-side OG card cannot be busted — it is Cache-Control on the
// response — so a shared link can keep showing the previous owner for up to the
// renderer's 15-minute TTL.
func (h *PublicIDHandler) invalidate(targetID, previousOwnerID string) {
	for _, id := range []string{targetID, previousOwnerID} {
		if id == "" {
			continue
		}
		// public_id is part of the indexed user document.
		h.searchIndexer.SyncUser(id)
		if h.redis != nil {
			cache.InvalidateCacheForProfileWall(h.redis, id)
		}
		if h.hub != nil {
			if err := h.hub.PublishProfileUpdated(id); err != nil {
				log.Printf("[public-id] failed to publish profile_updated for %s: %v", id, err)
			}
		}
	}
	// Numbers appear in the profile rows, the wall lists, the feed and the random
	// sidebar, so every one of those surfaces is stale for every viewer.
	if h.redis != nil {
		cache.InvalidateByPattern(h.redis, "data:/api/v1/profiles*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/profile_wall_posts*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/random*")
		cache.InvalidateCacheForFeed(h.redis)
	}
}

// nullIfEmpty keeps an optional actor as SQL NULL instead of an empty uuid.
func nullIfEmpty(v string) interface{} {
	if v == "" {
		return nil
	}
	return v
}
