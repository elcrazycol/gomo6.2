package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/middleware"
)

// turnstileVerify is the server-side Cloudflare Turnstile siteverify check
// used by write handlers (register, login).
//
// It is a package-level variable so unit tests can stub it (no network, no
// Cloudflare credentials). Production code never reassigns it.
var turnstileVerify = middleware.VerifyTurnstile

// verifyTurnstileForRequest runs the turnstile check for a human browser
// request. Kept as a thin wrapper so unit tests can stub turnstileVerify.
func verifyTurnstileForRequest(c *gin.Context, token, expectedAction string) bool {
	return turnstileVerify(c, token, expectedAction)
}
