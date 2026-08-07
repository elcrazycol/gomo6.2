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

// Refresh exchanges a valid refresh token for a new token pair.
// POST /api/v1/auth/refresh
//
// Refresh godoc
// @Summary      Refresh access token
// @Description  Exchange a valid refresh token for a new token pair
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
		RefreshToken string `json:"refresh_token"`
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

	// Compute the hash of the refresh token so the session row can be located
	// and updated in place (stable device identity). The refresh token itself is
	// NOT rotated — see RefreshAccessToken.
	oldHash := sha256hex(req.RefreshToken)
	row, rowErr := findSessionByRefreshHash(h.db, claims.UserID, oldHash)
	hasSession := rowErr == nil
	sessionID := ""
	if hasSession {
		sessionID = row.ID
	} else {
		// Legacy session without a row — mint a fresh identity.
		sessionID = newSessionID()
	}

	// Validate and issue a fresh access token. The opaque refresh token is NOT
	// rotated (stable session identity): concurrent refreshes from multiple
	// tabs/components all succeed instead of racing each other into a 401.
	tokenPair, err := h.authService.RefreshAccessToken(claims.UserID, claims.Username, claims.Domain, sessionID, req.RefreshToken)
	if err != nil {
		// Only revoke all sessions if the refresh token was found but generation
		// failed (potential token theft). "Not found" is benign (already used, expired).
		if !errors.Is(err, auth.ErrRefreshTokenNotFound) {
			h.authService.RevokeAllRefreshTokens(claims.UserID)
			middleware.InvalidateAuthCache(h.redis, claims.UserID)
			// Also clean up all sessions from DB
			h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1`, claims.UserID)
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
		return
	}

	if hasSession {
		// The previous access token is superseded: blacklist it so a revoked or
		// rotated session can never hold two live access tokens at once.
		if row.AccessJTI != "" {
			h.authService.BlacklistToken(row.AccessJTI, time.Now().Add(time.Hour))
		}
		// Rotate the session row in place — the id NEVER changes.
		res, execErr := h.db.Exec(`UPDATE user_sessions
			SET refresh_hash = $1, access_jti = $2, user_agent = $3,
				ip_address = NULLIF($4, '')::inet, last_active_at = NOW()
			WHERE id = $5 AND user_id = $6`,
			sha256hex(tokenPair.RefreshToken), tokenPair.AccessJTI, c.GetHeader("User-Agent"), c.ClientIP(), row.ID, claims.UserID)
		if execErr == nil {
			if n, _ := res.RowsAffected(); n == 0 {
				// The row vanished between lookup and rotation — the session was
				// revoked concurrently. Fail closed instead of handing out a fresh
				// identity for a dead device.
				h.authService.DeleteRefreshTokenByHash(claims.UserID, sha256hex(tokenPair.RefreshToken))
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Session has been revoked. Please log in again."))
				return
			}
		}
	} else {
		// Legacy session whose row predates stable session ids — mint a fresh one.
		insertSessionRow(h.db, claims.UserID, tokenPair.SessionID, sha256hex(tokenPair.RefreshToken), tokenPair.AccessJTI, c.GetHeader("User-Agent"), c.ClientIP())
		cleanupOldSessions(h.db, h.redis, h.authService, claims.UserID)
	}
	middleware.SetAuthCookies(c, claims.UserID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
	}))
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
		if refreshErr == nil && userErr == nil &&
			h.authService.ValidateRefreshToken(userID, refreshToken) {
			claims = &auth.Claims{UserID: userID}
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
	query := `
		SELECT id, username, display_name, email, domain, avatar_url, bio, garma, post_count, thread_count, created_at, is_remote
		FROM users
		WHERE id = $1
	`

	var user models.User
	err := h.db.QueryRow(query, userClaims.UserID).Scan(
		&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.Domain,
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
