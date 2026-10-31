package rpc

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"

	"github.com/gin-gonic/gin"
)

// ─── GomoSub member list ─────────────────────────────────────────────────────
// Discord-like roster: role names, colors and hierarchy for the server's
// right rail. Visible to board members and the owner only (regular members
// cannot enumerate memberships through the generic CRUD surface, which is
// user-scoped by design).

// GomoSubMemberRow is one roster entry.
type GomoSubMemberRow struct {
	UserID        string     `json:"user_id"`
	Username      string     `json:"username"`
	AvatarURL     *string    `json:"avatar_url"`
	RoleIDs       []string   `json:"role_ids"`
	LegacyRoleID  *string    `json:"role_id"`
	TimedOut      bool       `json:"timed_out"`
	TimedOutUntil *time.Time `json:"timed_out_until"`
	IsOwner       bool       `json:"is_owner"`
}

// GomoSubRoleRow is the role side of the roster payload.
type GomoSubRoleRow struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Position   int    `json:"position"`
	IsEveryone bool   `json:"is_everyone"`
}

// GomoSubMembersResponse bundles the roster with its roles so the client can
// group by top role without extra round-trips.
type GomoSubMembersResponse struct {
	Members []GomoSubMemberRow `json:"members"`
	Roles   []GomoSubRoleRow   `json:"roles"`
}

// ListGomoSubMembers returns the board roster.
// GET /api/rpc/gomosub_members?_board_id=
func (h *RPCHandler) ListGomoSubMembers(c *gin.Context) {
	claims, ok := httpx.BearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}
	boardID := c.Query("_board_id")
	if boardID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_board_id is required"))
		return
	}
	var ownerID string
	if err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1 AND COALESCE(is_gomosub, false) = TRUE`, boardID).Scan(&ownerID); err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	} else if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if claims.UserID != ownerID {
		var member bool
		if err := h.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2)`,
			boardID, claims.UserID).Scan(&member); err != nil || !member {
			if err != nil {
				httpx.ServerError(c, "handler error", err)
				return
			}
			c.JSON(http.StatusForbidden, models.ErrorResponse("You are not a member of this gomosub"))
			return
		}
	}

	rows, err := h.db.Query(`
		SELECT m.user_id, COALESCE(u.username, ''), u.avatar_url, m.role_id,
		       (m.timed_out_until IS NOT NULL AND m.timed_out_until > NOW()),
		       m.timed_out_until
		FROM gomosub_memberships m LEFT JOIN users u ON u.id = m.user_id
		WHERE m.board_id = $1`, boardID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()
	members := []GomoSubMemberRow{}
	for rows.Next() {
		var r GomoSubMemberRow
		if err := rows.Scan(&r.UserID, &r.Username, &r.AvatarURL, &r.LegacyRoleID, &r.TimedOut, &r.TimedOutUntil); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		r.IsOwner = r.UserID == ownerID
		r.RoleIDs = []string{}
		members = append(members, r)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	roleRows, err := h.db.Query(`
		SELECT id, name, COALESCE(color, '#99aab5'), COALESCE(position, 0), COALESCE(is_everyone, false)
		FROM gomosub_roles WHERE board_id = $1 ORDER BY position DESC`, boardID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer roleRows.Close()
	roles := []GomoSubRoleRow{}
	for roleRows.Next() {
		var r GomoSubRoleRow
		if err := roleRows.Scan(&r.ID, &r.Name, &r.Color, &r.Position, &r.IsEveryone); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		roles = append(roles, r)
	}
	if err := roleRows.Err(); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	// Multi-role grants plus the legacy single role_id, merged per user.
	grantRows, err := h.db.Query(`
		SELECT user_id, role_id FROM gomosub_member_roles WHERE board_id = $1
		UNION
		SELECT user_id, role_id FROM gomosub_memberships WHERE board_id = $1 AND role_id IS NOT NULL`, boardID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer grantRows.Close()
	byUser := map[string][]string{}
	for grantRows.Next() {
		var uid, rid string
		if err := grantRows.Scan(&uid, &rid); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		byUser[uid] = append(byUser[uid], rid)
	}
	if err := grantRows.Err(); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	for i := range members {
		if ids, found := byUser[members[i].UserID]; found {
			members[i].RoleIDs = ids
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(GomoSubMembersResponse{Members: members, Roles: roles}))
}
