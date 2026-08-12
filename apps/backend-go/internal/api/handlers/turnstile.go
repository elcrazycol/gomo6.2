package handlers

import (
	"os"

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
//
// Local development can opt out explicitly with TURNSTILE_DISABLED=1 (set in
// apps/backend-go/.env): Cloudflare Turnstile needs a dashboard widget whose
// sitekey/secret allow the local hostname, which a fresh dev setup does not
// have. Production never sets it and keeps the fail-closed behavior — a
// missing/misconfigured secret still rejects every request.
func verifyTurnstileForRequest(c *gin.Context, token, expectedAction string) bool {
	if os.Getenv("TURNSTILE_DISABLED") == "1" {
		return true
	}
	return turnstileVerify(c, token, expectedAction)
}
