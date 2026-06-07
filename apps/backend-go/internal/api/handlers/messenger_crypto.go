package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"os"
)

// getMessengerEncryptionKey returns the AES-256 key from env (32 bytes, base64).
// Falls back to a hardcoded dev key if env is not set.
func getMessengerEncryptionKey() ([]byte, error) {
	keyB64 := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if keyB64 == "" {
		// Development fallback key (exactly 32 bytes) — DO NOT use in production
		return []byte("0123456789abcdef0123456789abcdef"), nil
	}
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, fmt.Errorf("invalid MESSENGER_ENCRYPTION_KEY: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("MESSENGER_ENCRYPTION_KEY must be 32 bytes (AES-256)")
	}
	return key, nil
}

// encryptMessageContent encrypts plaintext with AES-256-GCM.
// Returns base64(nonce || ciphertext).
func encryptMessageContent(plaintext string) (string, error) {
	key, err := getMessengerEncryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// Seal appends ciphertext to nonce: nonce || ciphertext || tag
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// decryptMessageContent decrypts base64(nonce || ciphertext) with AES-256-GCM.
func decryptMessageContent(encryptedB64 string) (string, error) {
	key, err := getMessengerEncryptionKey()
	if err != nil {
		return "", err
	}

	encrypted, err := base64.StdEncoding.DecodeString(encryptedB64)
	if err != nil {
		return "", fmt.Errorf("invalid base64: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(encrypted) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := encrypted[:nonceSize], encrypted[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %w", err)
	}

	return string(plaintext), nil
}
