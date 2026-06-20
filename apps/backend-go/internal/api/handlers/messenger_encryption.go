package handlers

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

// ─── AES-256-GCM field-level encryption for messenger content ──────────────
// Protects against DB dumps, backups, and SQL injection data exposure.
// NOT E2EE — server holds the key. For true E2EE, client-side key exchange is needed.

var messengerEncryptionKey []byte

func init() {
	key := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("ENCRYPTION_KEY") // fallback
	}
	if key != "" {
		k := []byte(key)
		if len(k) < 32 {
			log.Printf("[Messenger] WARNING: MESSENGER_ENCRYPTION_KEY is %d bytes, zero-padded to 32", len(k))
			padded := make([]byte, 32)
			copy(padded, k)
			messengerEncryptionKey = padded
		} else if len(k) > 32 {
			log.Printf("[Messenger] WARNING: MESSENGER_ENCRYPTION_KEY is %d bytes, truncated to 32", len(k))
			messengerEncryptionKey = k[:32]
		} else {
			messengerEncryptionKey = k
		}
	} else {
		log.Printf("[Messenger] WARNING: No MESSENGER_ENCRYPTION_KEY set — messages stored as plaintext")
	}
}

// encryptContent encrypts plaintext using AES-256-GCM.
// Returns the original plaintext if encryption key is not configured.
func encryptContent(plaintext string) (string, error) {
	if messengerEncryptionKey == nil {
		return plaintext, nil
	}

	block, err := aes.NewCipher(messengerEncryptionKey)
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

// decryptContent decrypts AES-256-GCM encrypted content.
// If the content is not encrypted (or key is not configured), returns as-is.
func decryptContent(encoded string) (string, error) {
	if messengerEncryptionKey == nil || encoded == "" {
		return encoded, nil
	}

	ciphertext, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return encoded, nil // data may not be encrypted (migration period)
	}

	block, err := aes.NewCipher(messengerEncryptionKey)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return encoded, nil // not encrypted
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		log.Printf("[Messenger] decrypt failed: %v", err)
		return "", nil
	}

	return string(plaintext), nil
}
