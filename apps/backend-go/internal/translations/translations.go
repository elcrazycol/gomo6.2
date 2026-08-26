// Package translations manages the community translation proposals and
// votes (translation_values + translation_votes): submit, vote, list and
// delete proposals for the frontend's translatable keys. Extracted from the
// former api/handlers god package as part of the R5 sweep — the domain is
// self-contained (its own SQL, validation regexes and moderator check), so
// it lives as a leaf package next to socialpreview/notifications/privacy
// and is wired into the router from routes.go.
package translations

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// ─── Community translations ─────────────────────────────────────────────────
//
// The canonical list of translatable keys (and their Russian source text) lives
// in the frontend bundle; this package manages the user-submitted proposals
// stored in translation_values + translation_votes. Proposals are ranked by
// net votes and the top-voted one becomes the effective translation served to
// clients for a locale.

// Service manages community translation proposals and votes.
type Service struct {
	db *sql.DB
}

// New builds the translations service.
func New(db *sql.DB) *Service {
	return &Service{db: db}
}

var (
	translationKeyRE    = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$`)
	translationLocaleRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{2,16}$`)
)

const maxTranslationValueRunes = 1000

type translationValue struct {
	ID        string  `json:"id"`
	Key       string  `json:"key"`
	Locale    string  `json:"locale"`
	Value     string  `json:"value"`
	UserID    *string `json:"user_id"`
	Username  string  `json:"username"`
	Votes     int     `json:"votes"`
	MyVote    int     `json:"my_vote"`
	CreatedAt string  `json:"created_at"`
}

// ListTranslations returns every proposal for a locale, ranked by net votes.
// Anonymous callers get my_vote=0. Query params: locale (required), key.
func (h *Service) ListTranslations(c *gin.Context) {
	locale := strings.TrimSpace(c.Query("locale"))
	if !translationLocaleRE.MatchString(locale) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("locale is required"))
		return
	}
	viewerID := httpx.AuthenticatedUserID(c)

	query := `
		SELECT v.id, v.key, v.locale, v.value, v.user_id, v.votes, v.created_at,
		       COALESCE(u.username, ''),
		       COALESCE(vo.direction, 0)
		FROM translation_values v
		LEFT JOIN users u ON u.id = v.user_id
		-- Empty viewer IDs are used for anonymous reads. Cast NULLIF first;
		-- comparing a UUID column with '' otherwise makes PostgreSQL reject the
		-- entire public endpoint with "invalid input syntax for type uuid".
		LEFT JOIN translation_votes vo ON vo.value_id = v.id AND vo.user_id = NULLIF($1, '')::uuid
		WHERE v.locale = $2`
	args := []interface{}{viewerID, locale}

	if key := strings.TrimSpace(c.Query("key")); key != "" && translationKeyRE.MatchString(key) {
		query += " AND v.key = $3"
		args = append(args, key)
	}

	query += " ORDER BY v.votes DESC, v.created_at DESC"
	if limit := c.Query("limit"); limit != "" {
		if n, err := strconv.Atoi(limit); err == nil && n > 0 && n <= 5000 {
			query += " LIMIT " + strconv.Itoa(n)
		}
	}

	rows, err := h.db.QueryContext(c.Request.Context(), query, args...)
	if err != nil {
		httpx.ServerError(c, "list translations", err)
		return
	}
	defer rows.Close()

	results := make([]translationValue, 0)
	for rows.Next() {
		var v translationValue
		if err := rows.Scan(&v.ID, &v.Key, &v.Locale, &v.Value, &v.UserID, &v.Votes, &v.CreatedAt, &v.Username, &v.MyVote); err != nil {
			httpx.ServerError(c, "scan translation", err)
			return
		}
		results = append(results, v)
	}
	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

type submitTranslationRequest struct {
	Key    string `json:"key"`
	Locale string `json:"locale"`
	Value  string `json:"value"`
}

// SubmitTranslation stores a new proposal for (key, locale). Identical
// proposals by the same author are deduped (returns the existing row).
func (h *Service) SubmitTranslation(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	var req submitTranslationRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid JSON body"))
		return
	}
	req.Key = strings.TrimSpace(req.Key)
	req.Locale = strings.TrimSpace(req.Locale)
	req.Value = strings.TrimSpace(req.Value)

	if !translationKeyRE.MatchString(req.Key) || len(req.Key) > 255 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid key"))
		return
	}
	if !translationLocaleRE.MatchString(req.Locale) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid locale"))
		return
	}
	if req.Value == "" || utf8.RuneCountInString(req.Value) > maxTranslationValueRunes {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Value must be 1-1000 characters"))
		return
	}

	// Dedupe: the same author re-submitting an identical proposal returns the
	// existing row instead of creating a duplicate vote split.
	var existing translationValue
	err := h.db.QueryRowContext(c.Request.Context(), `
		SELECT v.id, v.key, v.locale, v.value, v.user_id, v.votes, v.created_at,
		       COALESCE(u.username, ''), 0
		FROM translation_values v
		LEFT JOIN users u ON u.id = v.user_id
		WHERE v.key = $1 AND v.locale = $2 AND v.user_id = $3 AND v.value = $4`,
		req.Key, req.Locale, userID, req.Value).
		Scan(&existing.ID, &existing.Key, &existing.Locale, &existing.Value, &existing.UserID, &existing.Votes, &existing.CreatedAt, &existing.Username, &existing.MyVote)
	if err == nil {
		c.JSON(http.StatusOK, models.SuccessResponse(existing))
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		httpx.ServerError(c, "dedupe translation", err)
		return
	}

	row := h.db.QueryRowContext(c.Request.Context(), `
		INSERT INTO translation_values (key, locale, value, user_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, key, locale, value, user_id, votes, created_at`,
		req.Key, req.Locale, req.Value, userID)

	var v translationValue
	if err := row.Scan(&v.ID, &v.Key, &v.Locale, &v.Value, &v.UserID, &v.Votes, &v.CreatedAt); err != nil {
		httpx.ServerError(c, "insert translation", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(v))
}

type voteTranslationRequest struct {
	Direction int `json:"direction"`
}

// VoteTranslation casts/updates/removes the caller's vote on a proposal.
// Voting the same direction again toggles the vote off; the opposite direction
// flips it. The denormalized votes counter is kept consistent atomically.
func (h *Service) VoteTranslation(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	valueID := c.Param("id")
	if valueID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("id is required"))
		return
	}

	var req voteTranslationRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid JSON body"))
		return
	}
	if req.Direction != 1 && req.Direction != -1 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("direction must be 1 or -1"))
		return
	}

	tx, err := h.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		httpx.ServerError(c, "begin vote tx", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	var existing sql.NullInt64
	if err := tx.QueryRowContext(c.Request.Context(),
		`SELECT direction FROM translation_votes WHERE value_id = $1 AND user_id = $2 FOR UPDATE`,
		valueID, userID).Scan(&existing); err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.ServerError(c, "read vote", err)
		return
	}

	delta := 0
	myVote := 0
	switch {
	case !existing.Valid:
		if _, err := tx.ExecContext(c.Request.Context(),
			`INSERT INTO translation_votes (value_id, user_id, direction) VALUES ($1, $2, $3)`,
			valueID, userID, req.Direction); err != nil {
			httpx.ServerError(c, "insert vote", err)
			return
		}
		delta = req.Direction
		myVote = req.Direction
	case int(existing.Int64) == req.Direction:
		if _, err := tx.ExecContext(c.Request.Context(),
			`DELETE FROM translation_votes WHERE value_id = $1 AND user_id = $2`,
			valueID, userID); err != nil {
			httpx.ServerError(c, "delete vote", err)
			return
		}
		delta = -req.Direction
	default:
		if _, err := tx.ExecContext(c.Request.Context(),
			`UPDATE translation_votes SET direction = $3, created_at = NOW() WHERE value_id = $1 AND user_id = $2`,
			valueID, userID, req.Direction); err != nil {
			httpx.ServerError(c, "update vote", err)
			return
		}
		delta = 2 * req.Direction // from -dir to +dir
		myVote = req.Direction
	}

	var votes int
	if err := tx.QueryRowContext(c.Request.Context(),
		`UPDATE translation_values SET votes = votes + $2, updated_at = NOW() WHERE id = $1 RETURNING votes`,
		valueID, delta).Scan(&votes); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Translation not found"))
			return
		}
		httpx.ServerError(c, "apply vote", err)
		return
	}

	if err := tx.Commit(); err != nil {
		httpx.ServerError(c, "commit vote tx", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(map[string]interface{}{"id": valueID, "votes": votes, "my_vote": myVote}))
}

// DeleteTranslation removes the caller's own proposal (admins/moderators may
// remove any proposal).
func (h *Service) DeleteTranslation(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("id is required"))
		return
	}

	isMod := userIsPlatformModerator(c, h.db)
	var res sql.Result
	var err error
	if isMod {
		res, err = h.db.ExecContext(c.Request.Context(), `DELETE FROM translation_values WHERE id = $1`, id)
	} else {
		res, err = h.db.ExecContext(c.Request.Context(), `DELETE FROM translation_values WHERE id = $1 AND user_id = $2`, id, userID)
	}
	if err != nil {
		httpx.ServerError(c, "delete translation", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Translation not found"))
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(map[string]interface{}{"deleted": true}))
}

// userIsPlatformModerator reports whether the caller holds the admin or
// moderator platform role. Best-effort: a lookup failure returns false.
func userIsPlatformModerator(c *gin.Context, db *sql.DB) bool {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		return false
	}
	var role string
	if err := db.QueryRowContext(c.Request.Context(),
		`SELECT role FROM user_roles WHERE user_id = $1 AND role IN ('admin','moderator') LIMIT 1`,
		userID).Scan(&role); err != nil {
		return false
	}
	return true
}
