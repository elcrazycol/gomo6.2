package middleware

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	AccessTokenCookie  = "gomo6_access_token"
	RefreshTokenCookie = "gomo6_refresh_token"
	RefreshUserCookie  = "gomo6_refresh_user"
	CSRFTokenCookie    = "gomo6_csrf"
	CSRFHeader         = "X-CSRF-Token"
)

func CookieAuthToken(c *gin.Context) string {
	value, err := c.Cookie(AccessTokenCookie)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func IsCookieAuthRequest(c *gin.Context) bool {
	// An explicit Bearer token remains the API/bot contract and is not subject
	// to browser CSRF, even if the same browser still has an old access cookie.
	accessCookie, _ := c.Cookie(AccessTokenCookie)
	refreshCookie, _ := c.Cookie(RefreshTokenCookie)
	return (strings.TrimSpace(accessCookie) != "" || strings.TrimSpace(refreshCookie) != "") && strings.TrimSpace(c.GetHeader("Authorization")) == ""
}

func ValidateCSRFMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if ValidateCSRF(c) {
			c.Next()
		}
	}
}

func SetAuthCookies(c *gin.Context, userID, accessToken, refreshToken string, maxAge int) {
	secure := os.Getenv("ENVIRONMENT") == "production" || os.Getenv("ENVIRONMENT") == "prod" || c.Request.TLS != nil
	sameSite := http.SameSiteStrictMode
	csrf := randomCSRFToken()

	http.SetCookie(c.Writer, &http.Cookie{Name: AccessTokenCookie, Value: accessToken, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: secure, SameSite: sameSite})
	http.SetCookie(c.Writer, &http.Cookie{Name: RefreshTokenCookie, Value: refreshToken, Path: "/api/v1/auth", MaxAge: 7 * 24 * 60 * 60, HttpOnly: true, Secure: secure, SameSite: sameSite})
	http.SetCookie(c.Writer, &http.Cookie{Name: RefreshUserCookie, Value: userID, Path: "/api/v1/auth", MaxAge: 7 * 24 * 60 * 60, HttpOnly: true, Secure: secure, SameSite: sameSite})
	http.SetCookie(c.Writer, &http.Cookie{Name: CSRFTokenCookie, Value: csrf, Path: "/", MaxAge: maxAge, HttpOnly: false, Secure: secure, SameSite: sameSite})
}

func ClearAuthCookies(c *gin.Context) {
	secure := os.Getenv("ENVIRONMENT") == "production" || os.Getenv("ENVIRONMENT") == "prod" || c.Request.TLS != nil
	sameSite := http.SameSiteStrictMode
	http.SetCookie(c.Writer, &http.Cookie{Name: AccessTokenCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: sameSite})
	http.SetCookie(c.Writer, &http.Cookie{Name: RefreshTokenCookie, Value: "", Path: "/api/v1/auth", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: sameSite})
	http.SetCookie(c.Writer, &http.Cookie{Name: RefreshUserCookie, Value: "", Path: "/api/v1/auth", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: sameSite})
	http.SetCookie(c.Writer, &http.Cookie{Name: CSRFTokenCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: false, Secure: secure, SameSite: sameSite})
}

func ValidateCSRF(c *gin.Context) bool {
	if !IsCookieAuthRequest(c) || c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
		return true
	}
	cookie, err := c.Cookie(CSRFTokenCookie)
	if err != nil || cookie == "" || cookie != c.GetHeader(CSRFHeader) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "CSRF token required"})
		return false
	}
	return true
}

func randomCSRFToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "csrf-unavailable"
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}
