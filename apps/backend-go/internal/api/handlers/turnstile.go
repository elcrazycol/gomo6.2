package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/middleware"
)

// turnstileVerify is the server-side Cloudflare Turnstile siteverify check
// used by write handlers (register, login, create_post, create_thread).
//
// It is a package-level variable so unit tests can stub it (no network, no
// Cloudflare credentials). Production code never reassigns it.
var turnstileVerify = middleware.VerifyTurnstile

// verifyTurnstileForRequest runs the turnstile check for a human browser
// request. Authenticated bot SDK calls (gomo6_bot_ tokens) carry the is_bot
// context flag set by BotAuthMiddleware and are exempt from the browser
// challenge — they are trusted service accounts.
func verifyTurnstileForRequest(c *gin.Context, token, expectedAction string) bool {
	if c.GetBool("is_bot") {
		return true
	}
	return turnstileVerify(c, token, expectedAction)
}
