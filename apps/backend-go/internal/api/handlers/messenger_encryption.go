package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/gomo6/backend/internal/crypto"
)

// AES-256-GCM helpers for legacy attachment encryption. Messenger message
// content uses crypto.EncryptForConversation/DecryptForConversation and is
// deliberately encrypted by the server before persistence; the server can decrypt it.

var messengerEncryptionKey []byte

func init() {
	loadEncryptionKey()
}

func loadEncryptionKey() {
	key := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("ENCRYPTION_KEY")
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

func encryptContentForConversation(conversationID, plaintext string) (string, error) {
	return crypto.EncryptForConversation(conversationID, plaintext)
}

func decryptContent(encoded string) (string, error) {
	return crypto.DecryptMaster(encoded)
}

func decryptContentForConversation(conversationID, encoded string) (string, error) {
	return crypto.DecryptForConversation(conversationID, encoded)
}

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
	return aesGCM.Open(nil, data[:nonceSize], data[nonceSize:], nil)
}
