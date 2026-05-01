package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// SecurityConfig holds security-related configuration
type SecurityConfig struct {
	// ContentSecurityPolicy defines the CSP header value
	ContentSecurityPolicy string
	// XFrameOptions defines clickjacking protection
	XFrameOptions string
	// XSSProtection defines XSS filter header
	XSSProtection string
	// ContentTypeNosniff prevents MIME type sniffing
	ContentTypeNosniff string
	// ReferrerPolicy controls referrer information
	ReferrerPolicy string
	// PermissionsPolicy controls browser features
	PermissionsPolicy string
	// HSTSMaxAge defines max-age for HSTS (0 disables)
	HSTSMaxAge time.Duration
	// AllowedHosts for host header validation (empty = all allowed)
	AllowedHosts []string
}

// DefaultSecurityConfig returns a secure default configuration
func DefaultSecurityConfig() SecurityConfig {
	return SecurityConfig{
		ContentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: http://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
		XFrameOptions:         "DENY",
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		ReferrerPolicy:        "strict-origin-when-cross-origin",
		PermissionsPolicy:     "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
		HSTSMaxAge:            365 * 24 * time.Hour, // 1 year
		AllowedHosts:          []string{},
	}
}

// SecurityMiddleware applies security headers and validations
func SecurityMiddleware(config SecurityConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Validate Host header if allowed hosts configured
		if len(config.AllowedHosts) > 0 {
			host := c.Request.Host
			if idx := strings.Index(host, ":"); idx != -1 {
				host = host[:idx]
			}
			allowed := false
			for _, allowedHost := range config.AllowedHosts {
				if strings.EqualFold(host, allowedHost) {
					allowed = true
					break
				}
			}
			if !allowed {
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
					"error": "Invalid host header",
				})
				return
			}
		}

		// Set security headers
		c.Header("Content-Security-Policy", config.ContentSecurityPolicy)
		c.Header("X-Frame-Options", config.XFrameOptions)
		c.Header("X-XSS-Protection", config.XSSProtection)
		c.Header("X-Content-Type-Options", config.ContentTypeNosniff)
		c.Header("Referrer-Policy", config.ReferrerPolicy)
		c.Header("Permissions-Policy", config.PermissionsPolicy)

		// HSTS (only in production)
		if config.HSTSMaxAge > 0 && strings.ToLower(c.GetHeader("X-Forwarded-Proto")) == "https" {
			c.Header("Strict-Transport-Security", fmt.Sprintf("max-age=%d; includeSubDomains", int(config.HSTSMaxAge.Seconds())))
		}

		c.Next()
	}
}

// ApplySecurityHeaders applies default security headers
func ApplySecurityHeaders() gin.HandlerFunc {
	return SecurityMiddleware(DefaultSecurityConfig())
}

// NoCacheMiddleware prevents caching of responses
func NoCacheMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
		c.Next()
	}
}
