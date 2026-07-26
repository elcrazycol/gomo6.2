package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/gomo6/backend/internal/crypto"
)

// ─── AES-256-GCM field-level encryption for messenger content ──────────────
// Protects against DB dumps, backups, and SQL injection data exposure.
// NOT E2EE — server holds the key. For true E2EE, client-side key exchange is needed.
//
// Key is derived per-conversation via HKDF (Phase 7) from the master key,
// providing isolation: compromise of one conversation key doesn't expose others.

var messengerEncryptionKey []byte

func init() {
	loadEncryptionKey()
}

// loadEncryptionKey loads the encryption key from environment.
// Called from init() and can be called again in tests.
func loadEncryptionKey() {
	key := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("ENCRYPTION_KEY") // fallback
	}
	if key == "" {
		log.Printf("[Messenger] WARNING: MESSENGER_ENCRYPTION_KEY not set — encryption disabled")
		return
	}
	k, err := crypto.ParseMessengerKey(key)
	if err != nil {
		log.Fatalf("[Messenger] FATAL: invalid MESSENGER_ENCRYPTION_KEY: %v. Generate with: openssl rand -hex 32", err)
	}
	messengerEncryptionKey = k
}

// encryptContentForConversation encrypts plaintext using the current
// per-conversation key derivation (HKDF v2 with legacy fallback on decrypt).
func encryptContentForConversation(conversationID, plaintext string) (string, error) {
	return crypto.EncryptForConversation(conversationID, plaintext)
}

// decryptContent decrypts AES-256-GCM encrypted content using the master key.
func decryptContent(encoded string) (string, error) {
	return crypto.DecryptMaster(encoded)
}

// decryptContentForConversation decrypts using a per-conversation key.
func decryptContentForConversation(conversationID, encoded string) (string, error) {
	return crypto.DecryptForConversation(conversationID, encoded)
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

// ─── Per-conversation key derivation ───────────────────────────────────────

// ─── Byte-level encryption (for attachments) ───────────────────────────────

// encryptBytes encrypts raw bytes using AES-256-GCM with the master key.
func encryptBytes(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(messengerEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("cipher init: %w", err)
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("GCM init: %w", err)
	}
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("nonce gen: %w", err)
	}
	return aesGCM.Seal(nonce, nonce, plaintext, nil), nil
}

// decryptBytes decrypts raw bytes using AES-256-GCM with the master key.
func decryptBytes(data []byte) ([]byte, error) {
	if messengerEncryptionKey == nil || len(data) == 0 {
		return data, nil
	}
	block, err := aes.NewCipher(messengerEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("cipher init: %w", err)
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("GCM init: %w", err)
	}
	nonceSize := aesGCM.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short (%d bytes)", len(data))
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	return aesGCM.Open(nil, nonce, ciphertext, nil)
}

// messengerEncryptionKey is loaded once from env and used by the legacy
// byte-level helpers (attachments) and master-key fallback decryption.
