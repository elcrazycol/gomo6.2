package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
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
