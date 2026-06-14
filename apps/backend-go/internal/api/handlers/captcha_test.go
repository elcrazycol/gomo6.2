package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

// =============================================================================
// hasLeadingZeroBits
// =============================================================================

func TestHasLeadingZeroBits_ZeroBits(t *testing.T) {
	// n=0 always true
	data := []byte{0xFF, 0xFF, 0xFF}
	if !hasLeadingZeroBits(data, 0) {
		t.Error("0 leading bits must always be true")
	}
}

func TestHasLeadingZeroBits_AllZeroBytes(t *testing.T) {
	data := []byte{0x00, 0x00, 0x00}
	if !hasLeadingZeroBits(data, 24) {
		t.Error("3 zero bytes must have 24 leading zero bits")
	}
}

func TestHasLeadingZeroBits_PartialByte(t *testing.T) {
	// 0x0F = 0000 1111 — first 4 bits are zero
	data := []byte{0x0F}
	if !hasLeadingZeroBits(data, 4) {
		t.Error("0x0F must have 4 leading zero bits")
	}
}

func TestHasLeadingZeroBits_PartialByteExact(t *testing.T) {
	// 0x00 0x80 = 0000 0000 1000 0000 — first 8 bits zero, bit 9 is 1
	data := []byte{0x00, 0x80}
	if !hasLeadingZeroBits(data, 8) {
		t.Error("0x00 0x80 must have 8 leading zero bits")
	}
	if hasLeadingZeroBits(data, 9) {
		t.Error("0x00 0x80 must NOT have 9 leading zero bits")
	}
}

func TestHasLeadingZeroBits_FailOnNonZeroByte(t *testing.T) {
	// 0x01 = 0000 0001 — first 7 bits zero, bit 8 is 1
	data := []byte{0x01}
	if !hasLeadingZeroBits(data, 7) {
		t.Error("0x01 must have 7 leading zero bits")
	}
	if hasLeadingZeroBits(data, 8) {
		t.Error("0x01 must NOT have 8 leading zero bits")
	}
}

func TestHasLeadingZeroBits_MultiByte(t *testing.T) {
	// 0x00 0x00 0x01 = 0000 0000 0000 0000 0000 0001
	// first 23 bits are zero, bit 24 is 1
	data := []byte{0x00, 0x00, 0x01}
	if !hasLeadingZeroBits(data, 16) {
		t.Error("0x00 0x00 0x01 must have 16 leading zero bits")
	}
	if !hasLeadingZeroBits(data, 23) {
		t.Error("0x00 0x00 0x01 must have 23 leading zero bits")
	}
	if hasLeadingZeroBits(data, 24) {
		t.Error("0x00 0x00 0x01 must NOT have 24 leading zero bits (bit 24 is 1)")
	}
}

func TestHasLeadingZeroBits_BeyondDataLength(t *testing.T) {
	data := []byte{0x00}
	// Asking for 16 bits when data is only 8 bits (1 byte)
	if hasLeadingZeroBits(data, 16) {
		t.Error("must return false when n exceeds data length")
	}
}

func TestHasLeadingZeroBits_EmptyData(t *testing.T) {
	if hasLeadingZeroBits([]byte{}, 1) {
		t.Error("must return false for empty data")
	}
	if !hasLeadingZeroBits([]byte{}, 0) {
		t.Error("must return true for empty data with 0 bits")
	}
}

func TestHasLeadingZeroBits_AllFF(t *testing.T) {
	data := []byte{0xFF, 0xFF}
	if hasLeadingZeroBits(data, 1) {
		t.Error("0xFF must NOT have 1 leading zero bit")
	}
}

func TestHasLeadingZeroBits_SHA256Examples(t *testing.T) {
	// Real-world: find a hash with N leading zero bits
	// hash of "test" doesn't have leading zeros — that's expected for most inputs
	hash := sha256.Sum256([]byte("test"))
	// Just verify the function runs without panic
	result := hasLeadingZeroBits(hash[:], 8)
	_ = result
}

// =============================================================================
// IsConfigured
// =============================================================================

func TestCaptchaHandler_IsConfigured_Default(t *testing.T) {
	h := &CaptchaHandler{
		siteKey:   "",
		secret:    "",
		verifyURL: "",
	}
	if h.IsConfigured() {
		t.Error("default handler should NOT be configured as external mCaptcha")
	}
}

func TestCaptchaHandler_IsConfigured_AllFields(t *testing.T) {
	h := &CaptchaHandler{
		siteKey:   "site-key",
		secret:    "secret",
		verifyURL: "https://mcaptcha.example.com/verify",
	}
	if !h.IsConfigured() {
		t.Error("handler with all fields should be configured")
	}
}

// =============================================================================
// deriveMCaptchaWidgetURL — pure helper
// =============================================================================

func TestDeriveMCaptchaWidgetURL(t *testing.T) {
	tests := []struct {
		name       string
		verifyURL  string
		explicit   string
		wantWidget string
	}{
		{"plain verify url", "http://mcaptcha:8080/api/v1/pow/verify", "", "http://mcaptcha:8080"},
		{"trailing slash", "http://mcaptcha:8080/api/v1/pow/verify/", "", "http://mcaptcha:8080"},
		{"query string is ignored on derivation", "http://mcaptcha:8080/api/v1/pow/verify?x=1", "", "http://mcaptcha:8080"},
		{"https origin preserved", "https://mcaptcha.example.com/api/v1/pow/verify", "", "https://mcaptcha.example.com"},
		{"non-default port preserved", "https://mcaptcha.example.com:9001/api/v1/pow/verify", "", "https://mcaptcha.example.com:9001"},
		{"explicit env wins over derivation", "http://mcaptcha:8080/api/v1/pow/verify", "https://custom.example.com", "https://custom.example.com"},
		{"empty verify url → empty widget url", "", "", ""},
		{"garbage url → empty widget url", "://not a url", "", ""},
		{"scheme-only url → empty widget url", "http://", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := deriveMCaptchaWidgetURL(tt.explicit, tt.verifyURL)
			if got != tt.wantWidget {
				t.Errorf("deriveMCaptchaWidgetURL(%q, %q) = %q, want %q", tt.explicit, tt.verifyURL, got, tt.wantWidget)
			}
		})
	}
}

func TestCaptchaHandler_IsConfigured_MissingSiteKey(t *testing.T) {
	h := &CaptchaHandler{
		siteKey:   "",
		secret:    "secret",
		verifyURL: "https://mcaptcha.example.com/verify",
	}
	if h.IsConfigured() {
		t.Error("missing siteKey should NOT be configured")
	}
}

func TestCaptchaHandler_IsConfigured_MissingSecret(t *testing.T) {
	h := &CaptchaHandler{
		siteKey:   "site-key",
		secret:    "",
		verifyURL: "https://mcaptcha.example.com/verify",
	}
	if h.IsConfigured() {
		t.Error("missing secret should NOT be configured")
	}
}

func TestCaptchaHandler_IsConfigured_MissingVerifyURL(t *testing.T) {
	h := &CaptchaHandler{
		siteKey:   "site-key",
		secret:    "secret",
		verifyURL: "",
	}
	if h.IsConfigured() {
		t.Error("missing verifyURL should NOT be configured")
	}
}

// =============================================================================
// captchaErr / typed-error sentinels
// =============================================================================

func TestCaptchaError_ErrorsIs_MatchesByCode(t *testing.T) {
	err := captchaError(ErrCaptchaExpired.code, "expired")
	if !errors.Is(err, ErrCaptchaExpired) {
		t.Fatal("errors.Is must match sentinels by code")
	}
	if errors.Is(err, ErrCaptchaMissing) {
		t.Fatal("errors.Is must NOT cross-match different codes")
	}
}

func TestCaptchaError_SentinelsDistinctByCode(t *testing.T) {
	// Each sentinel must have a distinct code — otherwise errors.Is is ambiguous.
	codes := map[string]struct{}{
		ErrCaptchaMissing.code: {},
		ErrCaptchaExpired.code: {},
		ErrCaptchaOffline.code: {},
		ErrCaptchaInvalid.code: {},
	}
	if len(codes) != 4 {
		t.Fatalf("sentinel codes must be distinct, got %d distinct out of 4: %v", len(codes), codes)
	}
}

func TestCaptchaError_ErrorsIs_DirectSentinelEquality(t *testing.T) {
	// Returning a sentinel directly should also be matchable.
	if !errors.Is(ErrCaptchaOffline, ErrCaptchaOffline) {
		t.Fatal("a sentinel must match itself")
	}
}

func TestCaptchaError_Code_ReturnsLabel(t *testing.T) {
	e := captchaError(ErrCaptchaInvalid.code, "x")
	var c *captchaErr
	if !errors.As(e, &c) {
		t.Fatal("expected captchaErr concrete type")
	}
	if c.Code() != "captcha_invalid" {
		t.Fatalf("Code() = %q, want %q", c.Code(), "captcha_invalid")
	}
}

// =============================================================================
// GetChallenge — nil-Redis guard
// =============================================================================

// We don't have a miniredis dependency wired into this package, so the
// max_difficulty branch is only testable in integration. The unit-level guard
// here is just that GetChallenge returns 503 cleanly when h.redis is nil
// and a max_difficulty is supplied.
func TestGetChallenge_RedisNil_ReturnsServiceUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &CaptchaHandler{
		redis:         nil,
		powDifficulty: 16,
	}
	c, w := newGETContext("/api/v1/auth/captcha-challenge", map[string]string{"max_difficulty": "8"})
	h.GetChallenge(c)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 with nil redis, got %d body=%s", w.Code, w.Body.String())
	}
}

// =============================================================================
// applyMaxDifficulty — clamp client-requested difficulty cap
// =============================================================================

func TestApplyMaxDifficulty(t *testing.T) {
	tests := []struct {
		name          string
		raw           string
		serverDefault int
		want          int
	}{
		{"empty falls back to default", "", 12, 12},
		{"non-numeric falls back to default", "abc", 12, 12},
		{"below min keeps default", "4", 12, 12},
		{"above 32 keeps default", "40", 12, 12},
		{"equal to default keeps default", "12", 12, 12},
		{"above default keeps default", "20", 12, 12},
		{"valid value below default is honored", "10", 12, 10},
		{"min boundary", "8", 12, 8},
		{"max boundary", "32", 33, 32},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := applyMaxDifficulty(tt.raw, tt.serverDefault); got != tt.want {
				t.Errorf("applyMaxDifficulty(%q, %d) = %d, want %d", tt.raw, tt.serverDefault, got, tt.want)
			}
		})
	}
}

// =============================================================================
// hasLeadingZeroBits — hex helper for readability
// =============================================================================

func TestHasLeadingZeroBits_HexExamples(t *testing.T) {
	tests := []struct {
		hexStr string
		bits   int
		want   bool
	}{
		{"00", 8, true},
		{"80", 0, true},
		{"80", 1, false},
		{"40", 1, true},  // 0100 0000 — 1 leading zero
		{"40", 2, false}, // 0100 0000 — bit 2 is 1
		{"C0", 0, true},
		{"C0", 1, false}, // 1100 0000 — bit 1 is 1
		{"00", 8, true},
		{"01", 7, true},  // 0000 0001 — 7 leading zeros
		{"01", 8, false}, // 0000 0001 — bit 8 is 1
		{"F0", 5, false}, // 1111 0000 — 4 leading ones, so 5th bit is 1 → fail
		{"000000", 24, true},
		{"0000FF", 16, true},
		{"0000FF", 17, false},
		{"000080", 16, true},
		{"000080", 17, false},
		{"000040", 17, true}, // 0000 0000 0000 0000 0100 0000 — 17 bits zero
		{"000040", 18, false},
		{"FFFF", 1, false},
		{"0001", 15, true},
		{"0001", 16, false},
	}
	for _, tt := range tests {
		data, err := hex.DecodeString(tt.hexStr)
		if err != nil {
			t.Fatalf("invalid hex %q: %v", tt.hexStr, err)
		}
		got := hasLeadingZeroBits(data, tt.bits)
		if got != tt.want {
			t.Errorf("hasLeadingZeroBits(%q, %d) = %v, want %v", tt.hexStr, tt.bits, got, tt.want)
		}
	}
}
