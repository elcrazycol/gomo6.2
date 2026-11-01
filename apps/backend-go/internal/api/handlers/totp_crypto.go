package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	"github.com/gomo6/backend/internal/auth"
)

const totpEncryptedPrefix = "enc1:"

// totpEncryptionKey returns the 32-byte key for TOTP secret encryption.
// Priority: explicit TOTP_ENCRYPTION_KEY (hex or base64, 32 bytes) for
// deployments that rotate it independently; otherwise derived from the JWT
// secret ("totp-encryption:"+JWT_SECRET), which is required-and-stable in
// production and process-scoped in dev — exactly like the JWTs themselves.
func totpEncryptionKey(authService *auth.AuthService) ([32]byte, error) {
	var out [32]byte
	if raw := strings.TrimSpace(os.Getenv("TOTP_ENCRYPTION_KEY")); raw != "" {
		b, err := decodeHexOrB64(raw)
		if err != nil {
			return out, fmt.Errorf("TOTP_ENCRYPTION_KEY is not valid hex/base64: %v", err)
		}
		if len(b) != 32 {
			return out, fmt.Errorf("TOTP_ENCRYPTION_KEY must decode to 32 bytes, got %d", len(b))
		}
		copy(out[:], b)
		return out, nil
	}
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		// Dev fallback: the process-generated JWT secret. Restarting the dev
		// server invalidates 2FA secrets exactly like it already invalidates
		// JWTs — acceptable in dev, impossible in prod (JWT_SECRET required).
		secret = auth.GetJWTSecret()
	}
	_ = authService // reserved: per-service key separation if ever needed
	return sha256.Sum256([]byte("gomo6-totp-v1:" + secret)), nil
}

// decodeHexOrB64 accepts hex or base64 encodings for key material.
func decodeHexOrB64(s string) ([]byte, error) {
	const hextable = "0123456789abcdefABCDEF"
	isHex := len(s)%2 == 0 && len(s) > 0
	if isHex {
		for i := 0; i < len(s); i++ {
			if !strings.ContainsRune(hextable, rune(s[i])) {
				isHex = false
				break
			}
		}
	}
	if isHex {
		out := make([]byte, len(s)/2)
		for i := 0; i < len(out); i++ {
			var v byte
			for j := 0; j < 2; j++ {
				c := s[i*2+j]
				var d byte
				switch {
				case c >= '0' && c <= '9':
					d = c - '0'
				case c >= 'a' && c <= 'f':
					d = c - 'a' + 10
				case c >= 'A' && c <= 'F':
					d = c - 'A' + 10
				}
				v = v*16 + d
			}
			out[i] = v
		}
		return out, nil
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawURLEncoding.DecodeString(s)
}

// encryptTOTPSecret seals a TOTP secret with AES-256-GCM (random nonce per
// seal). Output format: "enc1:<base64(nonce||ciphertext)>".
func encryptTOTPSecret(key [32]byte, secret string) (string, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("crypto/rand unavailable: %w", err)
	}
	sealed := gcm.Seal(nonce, nonce, []byte(secret), []byte("gomo6-totp"))
	return totpEncryptedPrefix + base64.RawURLEncoding.EncodeToString(sealed), nil
}

// decryptTOTPSecret opens a sealed secret. Legacy plaintext rows (created
// before encryption) are returned as-is so existing 2FA keeps working; the
// next SetupTOTP overwrites them with a sealed value.
func decryptTOTPSecret(key [32]byte, stored string) (string, error) {
	if !strings.HasPrefix(stored, totpEncryptedPrefix) {
		return stored, nil // legacy plaintext row
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(stored, totpEncryptedPrefix))
	if err != nil {
		return "", fmt.Errorf("totp secret: bad encoding")
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("totp secret: truncated")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, []byte("gomo6-totp"))
	if err != nil {
		return "", fmt.Errorf("totp secret: decryption failed")
	}
	return string(plain), nil
}

// sealTOTPSecret encrypts with the process key; on CSPRNG/key failure it
// FAILS CLOSED (error) — a 2FA secret must never be persisted less-protected.
func sealTOTPSecret(authService *auth.AuthService, secret string) (string, error) {
	key, err := totpEncryptionKey(authService)
	if err != nil {
		return "", err
	}
	return encryptTOTPSecret(key, secret)
}

// openTOTPSecret decrypts a stored secret (legacy plaintext passes through).
func openTOTPSecret(authService *auth.AuthService, stored string) (string, error) {
	key, err := totpEncryptionKey(authService)
	if err != nil {
		return "", err
	}
	return decryptTOTPSecret(key, stored)
}

// sealTOTP encrypts with the process key (AuthHandler convenience wrapper).
func (h *AuthHandler) sealTOTP(secret string) (string, error) {
	return sealTOTPSecret(h.authService, secret)
}

// openTOTP decrypts a stored secret (AuthHandler convenience wrapper).
func (h *AuthHandler) openTOTP(stored string) (string, error) {
	return openTOTPSecret(h.authService, stored)
}
