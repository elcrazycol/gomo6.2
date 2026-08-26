package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// recordWallViewsRequest is the body of POST /api/rpc/record_wall_views.
type recordWallViewsRequest struct {
	// PostIDs — wall posts whose cards became visible in the viewer's viewport.
	PostIDs []string `json:"post_ids"`
	// ViewerKey — persistent anonymous-browser id (localStorage). Ignored for
	// authenticated callers, who are deduped by their user id instead.
	ViewerKey string `json:"viewer_key"`
}

// maxWallViewsBatch caps how many post ids a single request may carry, so a
// malicious client cannot force a huge multi-row insert per request. The
// frontend sends ~20-50 ids per flush at most.
const maxWallViewsBatch = 50

// maxWallViewsBodyBytes caps the request body. A 50-id batch is ~2 KB, so
// anything beyond 64 KB is abuse — without this cap a multi-MB JSON body would
// be parsed on every request (CPU/memory DoS on a public endpoint).
const maxWallViewsBodyBytes = 64 << 10 // 64 KB

// maxViewerKeyLen bounds the client-asserted anonymous key stored in
// profile_wall_post_views.viewer_key.
const maxViewerKeyLen = 128

// Anonymous-caller anti-inflation budget: one IP may present at most
// maxAnonViewerKeysPerIP DISTINCT viewer_keys within anonViewerKeyWindow.
// A real browser presents exactly one key (localStorage, shared across tabs);
// an attacker rotating forged keys to inflate counters exhausts the cap in a
// handful of requests instead of minting views forever. Generous enough that
// many distinct visitors behind one NAT (school/office) are never blocked.
const (
	maxAnonViewerKeysPerIP = 100
	anonViewerKeyWindow    = time.Hour
)

// anonymousViewerKeyAllowed tracks the distinct viewer_keys an anonymous IP
// has presented and rejects new keys once the per-IP cap is exceeded. Fails
// open when Redis is unavailable (the request is then bounded only by the
// route's per-IP rate limiter).
func (h *RPCHandler) anonymousViewerKeyAllowed(c *gin.Context, viewerKey string) bool {
	if h.redis == nil || viewerKey == "" {
		return true
	}
	ip := c.ClientIP()
	if ip == "" {
		return true
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	k := "views:anonkeys:" + ip
	added, err := h.redis.SAdd(ctx, k, viewerKey).Result()
	if err != nil {
		return true // fail open: a Redis hiccup must not drop legitimate views
	}
	if added > 0 {
		if n, err := h.redis.SCard(ctx, k).Result(); err == nil && n > maxAnonViewerKeysPerIP {
			h.redis.Expire(ctx, k, anonViewerKeyWindow)
			return false
		}
	}
	h.redis.Expire(ctx, k, anonViewerKeyWindow)
	return true
}

// RecordWallViews records one "view" per unique visitor for wall posts whose
// cards became visible on screen. POST /api/rpc/record_wall_views — public,
// rides the RPC group's OptionalAuth + rate limiter.
//
// Counting semantics (per unique visitor):
//   - authenticated callers dedupe on viewer_id — one view per user per post,
//     forever (revisits and re-scrolls never inflate the counter);
//   - anonymous browsers dedupe on viewer_key — one view per browser per post;
//   - when a previously anonymous browser authenticates, its anonymous rows
//     under the same viewer_key are migrated to the account, so a person who
//     browsed anonymously and then logged in still counts as ONE viewer.
//
// The visible views_count is a correlated COUNT(*) subquery in the wall GET /
// feed, so this endpoint only writes to profile_wall_post_views — there is no
// denormalized counter to keep in sync.
//
// RecordWallViews godoc
// @Summary      Record wall post views
// @Description  Record unique-visitor views for wall posts that became visible
// @Tags         RPC
// @Accept       json
// @Produce      json
// @Param        request body recordWallViewsRequest true "Post IDs + anonymous viewer key"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      429 {object} models.APIResponse
// @Router       /rpc/record_wall_views [post]
func (h *RPCHandler) RecordWallViews(c *gin.Context) {
	// Cap the request body BEFORE parsing — the endpoint is public.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxWallViewsBodyBytes)

	var req recordWallViewsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	// Dedupe, validate and cap the requested ids (silently skipping garbage).
	seen := make(map[string]bool, len(req.PostIDs))
	var ids []string
	for _, raw := range req.PostIDs {
		raw = strings.TrimSpace(raw)
		if raw == "" || seen[raw] {
			continue
		}
		if _, err := uuid.Parse(raw); err != nil {
			continue
		}
		seen[raw] = true
		ids = append(ids, raw)
		if len(ids) >= maxWallViewsBatch {
			break
		}
	}
	if len(ids) == 0 {
		c.JSON(http.StatusOK, models.SuccessResponse(0))
		return
	}

	viewerID := rpcLikesViewerID(c) // "" for anonymous callers
	viewerKey := strings.TrimSpace(req.ViewerKey)
	if viewerID == "" && viewerKey == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("viewer_key is required for anonymous requests"))
		return
	}
	if len(viewerKey) > maxViewerKeyLen {
		viewerKey = viewerKey[:maxViewerKeyLen]
	}

	// Anonymous callers: bound how many distinct forged viewer_keys one IP may
	// present per window (see anonymousViewerKeyAllowed). Authenticated
	// callers need no cap — they dedupe on their user id (1 view/post/user).
	if viewerID == "" && !h.anonymousViewerKeyAllowed(c, viewerKey) {
		c.JSON(http.StatusTooManyRequests, models.ErrorResponse("Rate limit exceeded. Please slow down."))
		return
	}

	// SQL bind values: nil for the column a caller is not identified by, so the
	// corresponding UNIQUE constraint stays out of the way (NULLs are distinct
	// in Postgres unique constraints).
	//
	// Authenticated rows are keyed ONLY by viewer_id: storing the browser key
	// alongside the user id would make two accounts on one shared browser
	// collide on UNIQUE (post_id, viewer_key) — the second account's view
	// would be silently dropped by ON CONFLICT DO NOTHING. The key is still
	// used for the anonymous→account merge UPDATE below.
	var viewerIDArg interface{}
	if viewerID != "" {
		viewerIDArg = viewerID
	}
	var viewerKeyArg interface{}
	if viewerID == "" && viewerKey != "" {
		viewerKeyArg = viewerKey
	}

	// Anonymous→authenticated migration in ONE statement: a view recorded
	// earlier under this browser key belongs to the same person now that they
	// logged in — attribute it to the account so the person counts once.
	// (UPDATE, not the old per-post DELETE+INSERT: atomic, count-preserving —
	// it never drops a view if the INSERT below is gated out — and one round
	// trip instead of two per post.)
	if viewerID != "" && viewerKey != "" {
		if _, err := h.db.Exec(
			`UPDATE profile_wall_post_views
			 SET viewer_id = $1, viewer_key = NULL
			 WHERE viewer_id IS NULL AND viewer_key = $2 AND post_id::text = ANY($3)`,
			viewerID, viewerKey, pq.Array(ids),
		); err != nil {
			// Fall through — the INSERT below still counts this person.
		}
	}

	// The visibility gate mirrors the wall read predicate (owner, public
	// profile with a visible wall, or mutual friend — profile_wall.go) and is
	// applied inside the INSERT..SELECT, so a private wall's counter cannot be
	// inflated by guessing post ids. ON CONFLICT DO NOTHING dedupes re-views
	// AND the rows just migrated above (they now carry the viewer's user id).
	// All uuid columns are compared via ::text so the empty viewer string
	// (anonymous — never seen by Postgres as a uuid) cannot fail the cast.
	res, err := h.db.Exec(`
INSERT INTO profile_wall_post_views (post_id, viewer_id, viewer_key)
SELECT p.id, $1, $2
FROM profile_wall_posts p
LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
WHERE p.id::text = ANY($3)
  AND (p.user_id::text = $4
       OR (COALESCE(ps.private_profile, false) = false AND COALESCE(ps.private_hide_wall, false) = false)
       OR EXISTS (SELECT 1 FROM friendships f
                  WHERE (f.user1_id::text = p.user_id::text AND f.user2_id::text = $4)
                     OR (f.user1_id::text = $4 AND f.user2_id::text = p.user_id::text)))
ON CONFLICT DO NOTHING`, viewerIDArg, viewerKeyArg, pq.Array(ids), viewerID)
	if err != nil {
		httpx.ServerError(c, "failed to record wall views", err)
		return
	}

	inserted := 0
	if n, err := res.RowsAffected(); err == nil {
		inserted = int(n)
	}
	c.JSON(http.StatusOK, models.SuccessResponse(inserted))
}
