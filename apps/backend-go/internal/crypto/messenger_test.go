package crypto

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

// testKeyHex is a valid 64-char hex key (openssl rand -hex 32 format).
const testKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestMain(m *testing.M) {
	os.Setenv("MESSENGER_ENCRYPTION_KEY", testKeyHex)
	code := m.Run()
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Exit(code)
}

// ─── ParseMessengerKey ───────────────────────────────────────────────────────

func TestParseMessengerKey_Hex64(t *testing.T) {
	key, err := ParseMessengerKey(testKeyHex)
	if err != nil {
		t.Fatalf("ParseMessengerKey failed: %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("expected a 32-byte key, got %d bytes", len(key))
	}
	if key[0] != 0x01 {
		t.Fatalf("expected first byte 0x01, got %x", key[0])
	}
}

func TestParseMessengerKey_Raw32(t *testing.T) {
	raw := strings.Repeat("k", 32)
	key, err := ParseMessengerKey(raw)
	if err != nil {
		t.Fatalf("ParseMessengerKey failed: %v", err)
	}
	if !bytes.Equal(key, []byte(raw)) {
		t.Fatalf("expected raw key passthrough, got %x", key)
	}
}

func TestParseMessengerKey_Errors(t *testing.T) {
	cases := []struct {
		name string
		key  string
	}{
		{"empty", ""},
		{"too short", "short"},
		{"31 bytes", strings.Repeat("x", 31)},
		{"33 bytes", strings.Repeat("x", 33)},
		{"63 hex chars", strings.Repeat("a", 63)},
		{"invalid hex", strings.Repeat("z", 64)},
		{"64 chars not decodable to 32 bytes", strings.Repeat("a", 64) + strings.Repeat("b", 64)}, // 128
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ParseMessengerKey(tc.key); err == nil {
				t.Fatalf("expected error for key %q", tc.key)
			}
		})
	}
}

// ─── Key derivation ──────────────────────────────────────────────────────────

func TestDeriveConversationKey_DeterministicAndVersioned(t *testing.T) {
	v2a := DeriveConversationKey(KeyVersionHKDF, "conv-1")
	v2b := DeriveConversationKey(KeyVersionHKDF, "conv-1")
	if !bytes.Equal(v2a, v2b) {
		t.Error("HKDF derivation must be deterministic")
	}
	if len(v2a) != 32 {
		t.Fatalf("expected 32-byte key, got %d", len(v2a))
	}

	legacy := DeriveConversationKey(KeyVersionLegacy, "conv-1")
	if bytes.Equal(v2a, legacy) {
		t.Error("HKDF (v2) and HMAC (v1) keys must differ for the same conversation")
	}

	other := DeriveConversationKey(KeyVersionHKDF, "conv-2")
	if bytes.Equal(v2a, other) {
		t.Error("keys for different conversations must differ")
	}
}

func TestDeriveConversationKey_DefaultIsLegacy(t *testing.T) {
	got := DeriveConversationKey(0, "conv-1")
	legacy := DeriveConversationKey(KeyVersionLegacy, "conv-1")
	if !bytes.Equal(got, legacy) {
		t.Error("unknown version must fall back to legacy derivation")
	}
}

// ─── Encrypt / Decrypt ───────────────────────────────────────────────────────

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	key := DeriveConversationKey(KeyVersionHKDF, "conv-rt")
	for _, plaintext := range []string{"", "hello world", "привет мир 🌍", strings.Repeat("x", 100_000)} {
		enc, err := Encrypt(key, plaintext)
		if err != nil {
			t.Fatalf("Encrypt failed: %v", err)
		}
		dec, err := Decrypt(key, enc)
		if err != nil {
			t.Fatalf("Decrypt failed: %v", err)
		}
		if dec != plaintext {
			t.Errorf("round trip mismatch: got %q, want %q", dec, plaintext)
		}
	}
}

func TestEncrypt_ProducesUniqueCiphertexts(t *testing.T) {
	key := DeriveConversationKey(KeyVersionHKDF, "conv-unique")
	a, err := Encrypt(key, "same plaintext")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	b, err := Encrypt(key, "same plaintext")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	if a == b {
		t.Error("GCM nonces must make ciphertexts unique")
	}
}

func TestDecrypt_WrongKeyFails(t *testing.T) {
	keyA := DeriveConversationKey(KeyVersionHKDF, "conv-a")
	keyB := DeriveConversationKey(KeyVersionHKDF, "conv-b")
	enc, err := Encrypt(keyA, "secret")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	if _, err := Decrypt(keyB, enc); err == nil {
		t.Fatal("expected decryption with a wrong key to fail")
	}
}

func TestDecrypt_EmptyString(t *testing.T) {
	out, err := Decrypt([]byte(strings.Repeat("k", 32)), "")
	if err != nil || out != "" {
		t.Fatalf("empty input must return empty output without error, got %q, %v", out, err)
	}
}

func TestDecrypt_CorruptedCiphertextFails(t *testing.T) {
	key := DeriveConversationKey(KeyVersionHKDF, "conv-corrupt")
	enc, err := Encrypt(key, "integrity matters")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	// Flip a character in the base64 payload — GCM auth must reject it.
	last := enc[len(enc)-1]
	var flip byte = 'A'
	if last == 'A' {
		flip = 'B'
	}
	corrupted := enc[:len(enc)-1] + string(flip)
	if _, err := Decrypt(key, corrupted); err == nil {
		t.Fatal("expected tampered ciphertext to fail GCM authentication")
	}
}

func TestDecrypt_NotBase64Fails(t *testing.T) {
	key := DeriveConversationKey(KeyVersionHKDF, "conv-notb64")
	if _, err := Decrypt(key, "!!! not base64 !!!"); err == nil {
		t.Fatal("expected non-base64 input to fail")
	}
}

// ─── Conversation-level helpers ──────────────────────────────────────────────

func TestEncryptDecryptForConversation_RoundTrip(t *testing.T) {
	enc, err := EncryptForConversation("conv-e2e", "hi there")
	if err != nil {
		t.Fatalf("EncryptForConversation failed: %v", err)
	}
	dec, err := DecryptForConversation("conv-e2e", enc)
	if err != nil {
		t.Fatalf("DecryptForConversation failed: %v", err)
	}
	if dec != "hi there" {
		t.Errorf("got %q, want %q", dec, "hi there")
	}
}

func TestDecryptForConversation_LegacyFallback(t *testing.T) {
	// A message encrypted with the legacy v1 key must still decrypt via the
	// fallback path inside DecryptForConversation.
	legacyKey := DeriveConversationKey(KeyVersionLegacy, "conv-legacy")
	enc, err := Encrypt(legacyKey, "old message")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	dec, err := DecryptForConversation("conv-legacy", enc)
	if err != nil {
		t.Fatalf("legacy fallback failed: %v", err)
	}
	if dec != "old message" {
		t.Errorf("got %q, want %q", dec, "old message")
	}
}

func TestEncryptMaster_DecryptMaster(t *testing.T) {
	enc, err := EncryptMaster("master secret")
	if err != nil {
		t.Fatalf("EncryptMaster failed: %v", err)
	}
	dec, err := DecryptMaster(enc)
	if err != nil {
		t.Fatalf("DecryptMaster failed: %v", err)
	}
	if dec != "master secret" {
		t.Errorf("got %q, want %q", dec, "master secret")
	}
}

// ─── Byte-level helpers ──────────────────────────────────────────────────────

func TestEncryptBytes_DecryptBytes_RoundTrip(t *testing.T) {
	payload := []byte{0x00, 0x01, 0x02, 0xfe, 0xff}
	enc, err := EncryptBytes(payload)
	if err != nil {
		t.Fatalf("EncryptBytes failed: %v", err)
	}
	dec, err := DecryptBytes(enc)
	if err != nil {
		t.Fatalf("DecryptBytes failed: %v", err)
	}
	if !bytes.Equal(dec, payload) {
		t.Errorf("got %x, want %x", dec, payload)
	}
}

func TestDecryptBytes_Empty(t *testing.T) {
	out, err := DecryptBytes(nil)
	if err != nil || len(out) != 0 {
		t.Fatalf("empty bytes must pass through, got %x, %v", out, err)
	}
}

func TestDecryptBytes_TooShortFails(t *testing.T) {
	if _, err := DecryptBytes([]byte{0x01, 0x02}); err == nil {
		t.Fatal("expected an error for ciphertext shorter than the nonce")
	}
}

// The master key is re-read from the environment on every Init/GetMasterKey
// call — test binaries set and clear MESSENGER_ENCRYPTION_KEY around cases,
// and the loaded key must follow the environment instead of being cached for
// the whole process (that made the handlers suite order-dependent).
func TestInitReloadsMasterKeyPerEnv(t *testing.T) {
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Unsetenv("ENCRYPTION_KEY")

	Init()
	if masterKey != nil {
		t.Fatalf("expected no master key with env unset, got %d bytes", len(masterKey))
	}

	os.Setenv("MESSENGER_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
	defer os.Unsetenv("MESSENGER_ENCRYPTION_KEY")

	Init()
	if len(masterKey) != 32 {
		t.Fatalf("expected 32-byte master key after env set, got %d bytes", len(masterKey))
	}

	m := GetMasterKey()
	if len(m) != 32 {
		t.Fatalf("GetMasterKey must return the reloaded key, got %d bytes", len(m))
	}

	os.Setenv("MESSENGER_ENCRYPTION_KEY", "too-short") // invalid: must clear the key, not keep the old one
	Init()
	if masterKey != nil {
		t.Fatalf("expected key cleared on invalid env value, got %d bytes", len(masterKey))
	}
}
