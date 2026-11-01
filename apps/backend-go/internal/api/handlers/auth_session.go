package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
)

// Refresh exchanges a valid refresh token for a ROTATED token pair.
// POST /api/v1/auth/refresh
//
// Rotation (see auth.RefreshAccessToken): every refresh mints a new opaque
// refresh token and kills the presented one. Concurrent refreshes from several
// tabs converge via a 90s grace window; a rotated-out token presented past the
// grace window is treated as theft and revokes ALL sessions of the user.
//
// The fresh refresh token is delivered in the HttpOnly cookie ONLY — never in
// the JSON body (an XSS reading a login/refresh response must not harvest a
// 3-day session). Cookieless API clients may opt into JSON tokens with
// {"include_tokens": true} in the refresh body.
//
// Refresh godoc
// @Summary      Refresh access token
// @Description  Exchange a valid refresh token for a rotated token pair
// @Tags         Auth
// @Accept       json
// @Produce      json
// @Param        request body object true "Refresh token request"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/refresh [post]
// @Security     BearerAuth
func (h *AuthHandler) Refresh(c *gin.Context) {
	// Refresh is cookie-authenticated in browsers, so it must enforce the same
	// synchronizer-token check as other state-changing cookie requests.
	if !middleware.ValidateCSRF(c) {
		return
	}

	var req struct {
		RefreshToken  string `json:"refresh_token"`
		IncludeTokens bool   `json:"include_tokens,omitempty"`
	}
	// Browser clients use the HttpOnly refresh cookie. Keep the JSON field as a
	// compatibility path for non-browser API clients during the migration.
	_ = c.ShouldBindJSON(&req)
	if cookieToken, err := c.Cookie(middleware.RefreshTokenCookie); err == nil && cookieToken != "" {
		req.RefreshToken = cookieToken
	}
	if req.RefreshToken == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("refresh_token is required"))
		return
	}

	// Prefer claims established by middleware. A browser may refresh after the
	// short-lived access cookie has expired, so resolve the user from the
	// HttpOnly refresh-user cookie in that case.
	var claims *auth.Claims
	if claimsI, exists := c.Get("claims"); exists {
		claims, _ = claimsI.(*auth.Claims)
	}
	if claims == nil {
		if header := c.GetHeader("Authorization"); header != "" {
			parts := strings.Fields(header)
			if len(parts) == 2 && parts[0] == "Bearer" {
				claims, _ = h.authService.ValidateToken(parts[1])
			}
		}
	}
	if claims == nil {
		userID, err := c.Cookie(middleware.RefreshUserCookie)
		if err != nil || userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return
		}
		claims = &auth.Claims{UserID: userID}
		if err := h.db.QueryRow(`SELECT username, domain FROM users WHERE id = $1`, userID).Scan(&claims.Username, &claims.Domain); err != nil {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return
		}
	}

	oldHash := sha256hex(req.RefreshToken)
	row, rowErr := findSessionByRefreshHash(h.db, claims.UserID, oldHash)

	// presentedAccessJTI is the access token the caller authenticated with
	// (Bearer/API clients). Cookie refreshes present none (claims.ID == "") —
	// the superseded cookie is replaced below and dies with its short TTL.
	presentedJTI := ""
	if claims.ID != "" {
		presentedJTI = claims.ID
	}

	revokeEverything := func() {
		h.authService.RevokeAllRefreshTokens(claims.UserID)
		middleware.InvalidateAuthCache(h.redis, claims.UserID)
		h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1`, claims.UserID)
	}

	var pair *auth.TokenPair
	if rowErr == nil {
		// Winner path: this session still holds the presented token — rotate.
		var err error
		pair, err = h.authService.RefreshAccessToken(claims.UserID, claims.Username, claims.Domain, row.ID, req.RefreshToken)
		if err != nil {
			if errors.Is(err, auth.ErrRefreshTokenReused) {
				// Theft signature: a dead token replayed past the grace
				// window. Kill every session; the legitimate owner re-logs in.
				revokeEverything()
			} else if !errors.Is(err, auth.ErrRefreshTokenNotFound) {
				// Rotation failed after the token was found (Redis died
				// mid-rotation) — fail closed on everything, like theft.
				revokeEverything()
			}
			// ErrRefreshTokenNotFound with a matching row means the Redis record
			// is gone (flush/restart) but possession of the token preimage is
			// proven by the row match itself: re-mint instead of bricking the
			// session.
			if pair == nil && errors.Is(err, auth.ErrRefreshTokenNotFound) {
				fresh, genErr := h.authService.GenerateTokenPair(claims.UserID, claims.Username, claims.Domain, row.ID)
				if genErr != nil {
					c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
					return
				}
				pair = fresh
			} else if pair == nil {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
				return
			}
		}
		// Blacklist the superseded access token captured BEFORE the row update.
		// Both concurrent winners (if any) blacklist the same old JTI — never
		// each other's fresh one (see the race note in auth.RefreshAccessToken).
		if row.AccessJTI != "" {
			h.authService.BlacklistToken(row.AccessJTI, time.Now().Add(time.Hour))
		}
		if presentedJTI != "" && presentedJTI != row.AccessJTI {
			h.authService.BlacklistToken(presentedJTI, time.Now().Add(time.Hour))
		}
		res, execErr := h.db.Exec(`UPDATE user_sessions
			SET refresh_hash = $1, access_jti = $2, user_agent = $3,
				ip_address = NULLIF($4, '')::inet, last_active_at = NOW()
			WHERE id = $5 AND user_id = $6`,
			sha256hex(pair.RefreshToken), pair.AccessJTI, c.GetHeader("User-Agent"), c.ClientIP(), row.ID, claims.UserID)
		if execErr == nil {
			if n, _ := res.RowsAffected(); n == 0 {
				// The row vanished between lookup and rotation — the session was
				// revoked concurrently. Fail closed instead of handing out a fresh
				// identity for a dead device.
				h.authService.DeleteRefreshTokenByHash(claims.UserID, sha256hex(pair.RefreshToken))
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Session has been revoked. Please log in again."))
				return
			}
		}
	} else {
		// No session holds the presented token. Three sub-cases:
		//  1. grace window (concurrent tab): converge on the current token;
		//  2. tombstone (replay past grace): theft → revoke everything;
		//  3. legacy rowless session or unknown token.
		if current, ok := h.authService.GraceReplacement(claims.UserID, req.RefreshToken); ok {
			currentHash := sha256hex(current)
			grow, growErr := findSessionByRefreshHash(h.db, claims.UserID, currentHash)
			if growErr != nil {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
				return
			}
			issued, err := h.authService.IssueAccessToken(claims.UserID, claims.Username, claims.Domain, grow.ID)
			if err != nil {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
				return
			}
			pair = &auth.TokenPair{
				AccessToken:  issued.AccessToken,
				RefreshToken: current,
				SessionID:    grow.ID,
				AccessJTI:    issued.AccessJTI,
				ExpiresIn:    issued.ExpiresIn,
			}
			// Never blacklist the row's current JTI here: it may have been
			// written by the winning concurrent refresh a millisecond ago —
			// blacklisting it would kill a live session (the exact race the
			// old code hit on prod). Only the presented Bearer token dies.
			if presentedJTI != "" {
				h.authService.BlacklistToken(presentedJTI, time.Now().Add(time.Hour))
			}
			h.db.Exec(`UPDATE user_sessions
				SET access_jti = $1, last_active_at = NOW()
				WHERE id = $2 AND user_id = $3`, pair.AccessJTI, grow.ID, claims.UserID)
		} else if h.authService.IsRefreshTokenReused(claims.UserID, req.RefreshToken) {
			revokeEverything()
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
			return
		} else {
			// Legacy rowless session (Redis record exists, DB row predates
			// stable session ids): possession MUST be proven by the Redis
			// record for the PRESENTED token — minting a session for an
			// unknown token would be session forging via the user cookie.
			if !h.authService.ValidateRefreshToken(claims.UserID, req.RefreshToken) {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
				return
			}
			rotated, err := h.authService.RefreshAccessToken(claims.UserID, claims.Username, claims.Domain, newSessionID(), req.RefreshToken)
			if err != nil {
				if errors.Is(err, auth.ErrRefreshTokenReused) {
					revokeEverything()
				}
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
				return
			}
			pair = rotated
			insertSessionRow(h.db, claims.UserID, pair.SessionID, sha256hex(pair.RefreshToken), pair.AccessJTI, c.GetHeader("User-Agent"), c.ClientIP())
			cleanupOldSessions(h.db, h.redis, h.authService, claims.UserID)
		}
	}
	if err := middleware.SetAuthCookies(c, claims.UserID, pair.AccessToken, pair.RefreshToken, 3600); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to establish session"))
		return
	}

	// The refresh token travels in the HttpOnly cookie only. It is echoed in
	// JSON solely for cookieless API clients that explicitly opt in — browser
	// JS must never see it (XSS would harvest a 3-day session).
	resp := gin.H{
		"token":      pair.AccessToken,
		"expires_in": pair.ExpiresIn,
	}
	if req.IncludeTokens {
		resp["refresh_token"] = pair.RefreshToken
	}
	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}

// Logout blacklists the access token and revokes the CURRENT session (this
// device only). Other devices stay logged in.
// POST /api/v1/auth/logout
//
// Logout godoc
// @Summary      Log out
// @Description  Blacklist access token and revoke the current session
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/logout [post]
// @Security     BearerAuth
func (h *AuthHandler) Logout(c *gin.Context) {
	if !middleware.ValidateCSRF(c) {
		return
	}

	claimsI, exists := c.Get("claims")
	var claims *auth.Claims
	if exists {
		claims, _ = claimsI.(*auth.Claims)
	}
	if claims == nil {
		// Preserve the legacy Bearer contract for API clients now that this
		// route is also callable with only the refresh cookie.
		if header := c.GetHeader("Authorization"); header != "" {
			parts := strings.Fields(header)
			if len(parts) == 2 && parts[0] == "Bearer" {
				claims, _ = h.authService.ValidateToken(parts[1])
			}
		}
	}
	if claims == nil {
		// Browser reloads may retain only the HttpOnly refresh cookie. The
		// companion user-id cookie is not an identity proof by itself: bind it
		// to the opaque refresh token that exists server-side in Redis.
		refreshToken, refreshErr := c.Cookie(middleware.RefreshTokenCookie)
		userID, userErr := c.Cookie(middleware.RefreshUserCookie)
		// ResolveRefreshToken also accepts a just-rotated cookie inside the
		// grace window (the other tab already rotated): without it a stale
		// tab could not log its own session out.
		if refreshErr == nil && userErr == nil {
			if _, ok := h.authService.ResolveRefreshToken(userID, refreshToken); ok {
				claims = &auth.Claims{UserID: userID}
			}
		}
	}
	if claims == nil {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	// Blacklist the current access token
	if claims.ExpiresAt != nil {
		h.authService.BlacklistToken(claims.ID, claims.ExpiresAt.Time)
	}

	// Identify the current session: prefer the sid claim, fall back to the
	// HttpOnly refresh cookie for browser reloads after the access cookie
	// expired. Logout only ever kills THIS device.
	currentSessionID := claims.SessionID
	if currentSessionID == "" {
		if rt, err := c.Cookie(middleware.RefreshTokenCookie); err == nil && rt != "" {
			if s, err := findSessionByRefreshHash(h.db, claims.UserID, sha256hex(rt)); err == nil {
				currentSessionID = s.ID
			}
		}
	}

	if currentSessionID != "" {
		if row, err := fetchSessionByID(h.db, claims.UserID, currentSessionID); err == nil {
			revokeSession(h.db, h.redis, h.authService, claims.UserID, row)
		}
	} else {
		// No identifiable session row (pure bearer/API client): revoke everything.
		h.authService.RevokeAllRefreshTokens(claims.UserID)
		h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1`, claims.UserID)
		publishUserRevoke(h.redis, claims.UserID)
	}
	middleware.InvalidateAuthCache(h.redis, claims.UserID)
	middleware.ClearAuthCookies(c)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// GetMe returns the authenticated user's profile.
//
// GetMe godoc
// @Summary      Get current user
// @Description  Returns the authenticated user's profile
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/me [get]
// @Security     BearerAuth
func (h *AuthHandler) GetMe(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// REMOVED: RecomputeUserProfileStats - too expensive for every auth check
	// Stats should be updated only when actual changes occur (new post, like, etc.)

	// Get user from database
	// public_id is part of the payload so the client can link its own profile
	// with the human-readable number (/profile/42) instead of the UUID.
	query := `
		SELECT id, public_id, username, display_name, email, domain, avatar_url, bio, garma, post_count, thread_count, created_at, is_remote
		FROM users
		WHERE id = $1
	`

	var user models.User
	err := h.db.QueryRow(query, userClaims.UserID).Scan(
		&user.ID, &user.PublicID, &user.Username, &user.DisplayName, &user.Email, &user.Domain,
		&user.AvatarURL, &user.Bio, &user.Garma, &user.PostCount, &user.ThreadCount,
		&user.CreatedAt, &user.IsRemote,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(user))
}
