package middleware

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// turnstileSiteverifyURL is the canonical Cloudflare Turnstile verification
// endpoint. Package-level var so tests can point it at an httptest server.
var turnstileSiteverifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// VerifyTurnstile validates a cf-turnstile-response token against Cloudflare
// Turnstile's siteverify endpoint. It requires TURNSTILE_SECRET and
// TURNSTILE_HOSTNAMES (comma-separated) to be configured; otherwise it fails
// closed (returns false). The token's action must match expectedAction and its
// hostname must be present in the TURNSTILE_HOSTNAMES allowlist.
//
// Called only from the server side — never from the browser. The response
// token is single-use, so a successful check redeems it.
func VerifyTurnstile(c *gin.Context, token, expectedAction string) bool {
	// C1 (security audit 2026-08-14): no dev bypass may live here. A token
	// value like "DEV_TEST_TOKEN" or an ENVIRONMENT=development check would
	// let any attacker skip CAPTCHA in production, and config.go defaults
	// ENVIRONMENT to "development" when unset — making the bypass active by
	// default. Local development opts out explicitly via TURNSTILE_DISABLED=1
	// in verifyTurnstileForRequest (handlers/turnstile.go); this function is
	// always fail-closed.
	secret := os.Getenv("TURNSTILE_SECRET")
	hostnames := parseHostnameAllowlist(os.Getenv("TURNSTILE_HOSTNAMES"))
	if secret == "" || token == "" || len(token) > 2048 || len(hostnames) == 0 {
		return false
	}

	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if ip := c.ClientIP(); ip != "" {
		form.Set("remoteip", ip)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.PostForm(turnstileSiteverifyURL, form)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	// Non-200 from Cloudflare (e.g. 502 with an HTML body) is not a valid
	// verification result — treat it as a failure. We fail closed either way.
	if resp.StatusCode != http.StatusOK {
		return false
	}

	var result struct {
		Success  bool   `json:"success"`
		Action   string `json:"action"`
		Hostname string `json:"hostname"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false
	}
	if !result.Success || result.Action != expectedAction {
		return false
	}
	for _, h := range hostnames {
		if h == result.Hostname {
			return true
		}
	}
	return false
}

func parseHostnameAllowlist(csv string) []string {
	var out []string
	for _, part := range strings.Split(csv, ",") {
		if h := strings.TrimSpace(part); h != "" {
			out = append(out, h)
		}
	}
	return out
}
