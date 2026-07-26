package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
)

// ParseMessengerKey parses the messenger encryption key from either a raw
// 32-byte string or a 64-character hex-encoded string (as produced by
// `openssl rand -hex 32`). It returns the decoded 32-byte key.
func ParseMessengerKey(key string) ([]byte, error) {
	if len(key) == 64 {
		decoded, err := hex.DecodeString(key)
		if err == nil && len(decoded) == 32 {
			return decoded, nil
		}
		if err != nil {
			return nil, fmt.Errorf("invalid hex key: %w", err)
		}
		return nil, fmt.Errorf("invalid hex key length after decode: %d", len(decoded))
	}
	if len(key) == 32 {
		return []byte(key), nil
	}
	return nil, fmt.Errorf("key must be exactly 32 bytes or 64 hex chars, got %d", len(key))
}

// Messenger encryption provides AES-256-GCM field-level encryption for messenger content.
// The master key is loaded from MESSENGER_ENCRYPTION_KEY env var.
// Per-conversation keys are derived via HMAC-SHA256.

var (
	masterKey     []byte
	masterKeyOnce sync.Once
)

// Init loads the master encryption key from environment.
// Must be called once at startup. Fatal if key is missing or wrong length.
func Init() {
	masterKeyOnce.Do(func() {
		key := os.Getenv("MESSENGER_ENCRYPTION_KEY")
		if key == "" {
			key = os.Getenv("ENCRYPTION_KEY")
		}
		if key == "" {
			log.Fatalf("[Crypto] FATAL: MESSENGER_ENCRYPTION_KEY is required. Generate with: openssl rand -hex 32")
		}
		k, err := ParseMessengerKey(key)
		if err != nil {
			log.Fatalf("[Crypto] FATAL: invalid MESSENGER_ENCRYPTION_KEY: %v", err)
		}
		masterKey = k
	})
}

// GetMasterKey returns the loaded master key. Panics if Init() was not called.
func GetMasterKey() []byte {
	Init()
	return masterKey
}

// DeriveConversationKey derives a unique 32-byte AES key for a conversation
// using HMAC-SHA256 from the master key + conversation ID.
func DeriveConversationKey(conversationID string) []byte {
	mac := hmac.New(sha256.New, GetMasterKey())
	mac.Write([]byte("gomo6-messenger-v1"))
	mac.Write([]byte(conversationID))
	mac.Write([]byte{0x01})
	return mac.Sum(nil)
}

// Encrypt encrypts plaintext using AES-256-GCM with the given key.
func Encrypt(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
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

// Decrypt decrypts AES-256-GCM encrypted content using the given key.
func Decrypt(key []byte, encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("not encrypted (base64 decode failed)")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}
	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short (%d bytes)", len(ciphertext))
	}
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed")
	}
	return string(plaintext), nil
}

// EncryptMaster encrypts using the master key.
func EncryptMaster(plaintext string) (string, error) {
	return Encrypt(GetMasterKey(), plaintext)
}

// DecryptMaster decrypts using the master key.
func DecryptMaster(encoded string) (string, error) {
	return Decrypt(GetMasterKey(), encoded)
}

// EncryptForConversation encrypts using a per-conversation key.
func EncryptForConversation(conversationID, plaintext string) (string, error) {
	return Encrypt(DeriveConversationKey(conversationID), plaintext)
}

// DecryptForConversation decrypts using a per-conversation key.
func DecryptForConversation(conversationID, encoded string) (string, error) {
	return Decrypt(DeriveConversationKey(conversationID), encoded)
}

// ComputeHMAC computes HMAC-SHA256 over plaintext using the master key.
func ComputeHMAC(plaintext string) string {
	mac := hmac.New(sha256.New, GetMasterKey())
	mac.Write([]byte(plaintext))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyHMAC checks if the HMAC matches the plaintext.
func VerifyHMAC(plaintext, expectedHMAC string) bool {
	return ComputeHMAC(plaintext) == expectedHMAC
}

// EncryptBytes encrypts raw bytes using AES-256-GCM with the master key.
func EncryptBytes(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(GetMasterKey())
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

// DecryptBytes decrypts raw bytes using AES-256-GCM with the master key.
func DecryptBytes(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return data, nil
	}
	block, err := aes.NewCipher(GetMasterKey())
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
