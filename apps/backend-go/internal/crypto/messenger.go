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

	"golang.org/x/crypto/hkdf"
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
// Per-conversation keys are derived via HMAC-SHA256 (legacy) or HKDF (v2).

var (
	masterKey     []byte
	masterKeyOnce sync.Once
)

// Key derivation versions.
const (
	// KeyVersionLegacy uses the original HMAC-SHA256 derivation.
	// Kept for decrypting existing messages.
	KeyVersionLegacy = 1
	// KeyVersionHKDF uses RFC-5869 HKDF-SHA256 for deriving per-conversation keys.
	KeyVersionHKDF = 2
)

// hkdfKeyCache caches derived per-conversation keys to avoid recomputing HKDF.
// Only v2 keys are cached; legacy keys are cheap to compute.
var hkdfKeyCache sync.Map // key: "convID", value: []byte

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

// DeriveConversationKey derives a 32-byte key for a conversation using the
// requested KDF version. New encryption always uses KeyVersionHKDF; legacy
// messages can still be decrypted with KeyVersionLegacy.
func DeriveConversationKey(version int, conversationID string) []byte {
	switch version {
	case KeyVersionHKDF:
		return deriveConversationKeyHKDF(conversationID)
	default:
		return deriveConversationKeyLegacy(conversationID)
	}
}

func deriveConversationKeyLegacy(conversationID string) []byte {
	mac := hmac.New(sha256.New, GetMasterKey())
	mac.Write([]byte("gomo6-messenger-v1"))
	mac.Write([]byte(conversationID))
	mac.Write([]byte{0x01})
	return mac.Sum(nil)
}

func deriveConversationKeyHKDF(conversationID string) []byte {
	if cached, ok := hkdfKeyCache.Load(conversationID); ok {
		return cached.([]byte)
	}

	salt := []byte("gomo6-messenger-hkdf-v2")
	info := []byte(conversationID)
	r := hkdf.New(sha256.New, GetMasterKey(), salt, info)
	key := make([]byte, 32)
	if _, err := io.ReadFull(r, key); err != nil {
		// HKDF-Extract/Expand with SHA-256 cannot fail in practice for 32 bytes,
		// but if it ever does, fall back to the legacy derivation so we don't
		// lose data. Log loudly because this should be investigated.
		log.Printf("[Crypto] FATAL: HKDF key derivation failed for conversation %s: %v", conversationID, err)
		return deriveConversationKeyLegacy(conversationID)
	}

	hkdfKeyCache.Store(conversationID, key)
	return key
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

// EncryptForConversation encrypts using the current v2 per-conversation key (HKDF).
func EncryptForConversation(conversationID, plaintext string) (string, error) {
	return Encrypt(DeriveConversationKey(KeyVersionHKDF, conversationID), plaintext)
}

// DecryptForConversation decrypts using the per-conversation key.
// It tries the modern HKDF key first, then falls back to the legacy HMAC key
// for messages written before the HKDF migration.
func DecryptForConversation(conversationID, encoded string) (string, error) {
	decrypted, err := Decrypt(DeriveConversationKey(KeyVersionHKDF, conversationID), encoded)
	if err == nil {
		return decrypted, nil
	}
	return Decrypt(DeriveConversationKey(KeyVersionLegacy, conversationID), encoded)
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
