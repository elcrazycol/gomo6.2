package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
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
		if len(k) != 32 {
			log.Fatalf("[Messenger] FATAL: MESSENGER_ENCRYPTION_KEY must be exactly 32 bytes, got %d. Generate with: openssl rand -hex 32", len(k))
		}
		messengerEncryptionKey = k
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

// marshalCiphertexts converts CiphertextEntries to JSON for storage
func marshalCiphertexts(entries []CiphertextEntry) (string, error) {
	b, err := json.Marshal(entries)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// unmarshalCiphertexts parses stored ciphertexts JSON
func unmarshalCiphertexts(raw string) ([]CiphertextEntry, error) {
	if raw == "" {
		return nil, nil
	}
	var entries []CiphertextEntry
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil, err
	}
	return entries, nil
}
