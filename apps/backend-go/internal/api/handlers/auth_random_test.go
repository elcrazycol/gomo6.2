package handlers

import (
	"errors"
	"fmt"
	"regexp"
	"testing"
)

var (
	hexCharsRe    = regexp.MustCompile(`^[0-9a-f]+$`)
	base36CharsRe = regexp.MustCompile(`^[0-9A-Z]+$`)
	// walletAddressRegex mirrors the client-side check in
	// apps/web/src/components/TransferDialog.tsx — generated addresses must
	// keep matching it.
	walletAddressRegex = regexp.MustCompile(`^GM6-[A-Z0-9]{4}-[A-Z0-9]{4}$`)
)

func TestSecureHex_LengthAndCharset(t *testing.T) {
	for _, n := range []int{1, 4, 32, 64} {
		s, err := secureHex(n)
		if err != nil {
			t.Fatalf("secureHex(%d): %v", n, err)
		}
		if len(s) != n {
			t.Fatalf("secureHex(%d) length = %d", n, len(s))
		}
		if !hexCharsRe.MatchString(s) {
			t.Fatalf("secureHex(%d) = %q, not lowercase hex", n, s)
		}
	}
}

func TestSecureHex_RejectsNonPositiveLength(t *testing.T) {
	if _, err := secureHex(0); err == nil {
		t.Fatal("expected an error for length 0")
	}
	if _, err := secureHex(-3); err == nil {
		t.Fatal("expected an error for a negative length")
	}
}

func TestSecureBase36_LengthAndCharset(t *testing.T) {
	for i := 0; i < 100; i++ {
		s, err := secureBase36(4)
		if err != nil {
			t.Fatalf("secureBase36(4): %v", err)
		}
		if len(s) != 4 {
			t.Fatalf("length = %d, want 4", len(s))
		}
		if !base36CharsRe.MatchString(s) {
			t.Fatalf("secureBase36(4) = %q, not base36", s)
		}
	}
}

func TestRandomHex_PanicsWhenCSPRNGUnavailable(t *testing.T) {
	orig := randRead
	randRead = func([]byte) (int, error) { return 0, errors.New("csprng down") }
	t.Cleanup(func() { randRead = orig })

	defer func() {
		if recover() == nil {
			t.Fatal("randomHex must fail closed when the CSPRNG is unavailable")
		}
	}()
	_ = randomHex(32)
}

func TestRandomBase36_PanicsWhenCSPRNGUnavailable(t *testing.T) {
	orig := randRead
	randRead = func([]byte) (int, error) { return 0, errors.New("csprng down") }
	t.Cleanup(func() { randRead = orig })

	defer func() {
		if recover() == nil {
			t.Fatal("randomBase36 must fail closed when the CSPRNG is unavailable")
		}
	}()
	_ = randomBase36(4)
}

func TestWalletAddressFormat_MatchesFrontendAndColumn(t *testing.T) {
	for i := 0; i < 100; i++ {
		addr := fmt.Sprintf("GM6-%s-%s", randomBase36(4), randomBase36(4))
		if !walletAddressRegex.MatchString(addr) {
			t.Fatalf("address %q does not match the frontend regex", addr)
		}
		if len(addr) > 14 {
			t.Fatalf("address %q exceeds users.wallet_address VARCHAR(14)", addr)
		}
	}
}

func TestRandomBase36_UsesFullAlphabet(t *testing.T) {
	// With 8 characters over 100 draws, hex-only output would be a strong signal
	// that the alphabet was not widened (expected hex-only chance is nil).
	letters := 0
	for i := 0; i < 100; i++ {
		s, err := secureBase36(8)
		if err != nil {
			t.Fatalf("secureBase36: %v", err)
		}
		for _, r := range s {
			if r >= 'A' && r <= 'Z' {
				letters++
			}
		}
	}
	if letters == 0 {
		t.Fatal("no letters produced — base36 alphabet is not being used")
	}
}
