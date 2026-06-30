package integrations

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
)

// ─── AES-256-GCM encryption for integration tokens at rest ──────────────────

var integrationEncryptKey []byte

func init() {
	key := os.Getenv("INTEGRATION_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("ENCRYPTION_KEY") // fallback to general encryption key
	}
	if key != "" {
		k := []byte(key)
		if len(k) != 32 {
			log.Printf("[Integrations] WARNING: INTEGRATION_ENCRYPTION_KEY not 32 bytes (got %d), tokens stored as plaintext. Generate: openssl rand -hex 32", len(k))
		} else {
			integrationEncryptKey = k
		}
	} else {
		log.Printf("[Integrations] WARNING: No INTEGRATION_ENCRYPTION_KEY set — tokens stored as plaintext")
	}
}

// EncryptToken encrypts a string using AES-256-GCM.
// Returns the original plaintext if the encryption key is not configured.
func EncryptToken(plaintext string) (string, error) {
	if integrationEncryptKey == nil {
		return plaintext, nil
	}

	block, err := aes.NewCipher(integrationEncryptKey)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce gen: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

// DecryptToken decrypts an AES-256-GCM encrypted string.
// If the data is not encrypted (or key not configured), returns as-is.
func DecryptToken(encoded string) (string, error) {
	if integrationEncryptKey == nil || encoded == "" {
		return encoded, nil
	}

	ciphertext, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return encoded, nil
	}

	block, err := aes.NewCipher(integrationEncryptKey)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return encoded, nil
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}

	return string(plaintext), nil
}
