package handlers

import (
	"os"
	"testing"
)

func initEncryptionKey() {
	// Re-run the init logic to pick up env changes for testing
	key := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("ENCRYPTION_KEY")
	}
	if key != "" {
		k := []byte(key)
		if len(k) < 32 {
			padded := make([]byte, 32)
			copy(padded, k)
			messengerEncryptionKey = padded
		} else if len(k) > 32 {
			messengerEncryptionKey = k[:32]
		} else {
			messengerEncryptionKey = k
		}
	} else {
		messengerEncryptionKey = nil
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef" // 32 bytes
	os.Setenv("MESSENGER_ENCRYPTION_KEY", key)
	defer os.Unsetenv("MESSENGER_ENCRYPTION_KEY")

	initEncryptionKey()

	plaintext := "Hello, World! Привет мир! 🎉"
	encrypted, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent failed: %v", err)
	}
	if encrypted == plaintext {
		t.Fatal("encrypted text should differ from plaintext")
	}

	decrypted, err := decryptContent(encrypted)
	if err != nil {
		t.Fatalf("decryptContent failed: %v", err)
	}
	if decrypted != plaintext {
		t.Errorf("decrypted %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptWithoutKey(t *testing.T) {
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Unsetenv("ENCRYPTION_KEY")

	initEncryptionKey()

	plaintext := "plaintext message"
	result, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent failed: %v", err)
	}
	if result != plaintext {
		t.Errorf("without key, should return plaintext, got %q", result)
	}
}

func TestDecryptWithoutKey(t *testing.T) {
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Unsetenv("ENCRYPTION_KEY")

	initEncryptionKey()

	result, err := decryptContent("some data")
	if err != nil {
		t.Fatalf("decryptContent failed: %v", err)
	}
	if result != "some data" {
		t.Errorf("without key, should return as-is, got %q", result)
	}
}

func TestDecryptEmptyString(t *testing.T) {
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Unsetenv("ENCRYPTION_KEY")

	initEncryptionKey()

	result, err := decryptContent("")
	if err != nil {
		t.Fatalf("decryptContent failed: %v", err)
	}
	if result != "" {
		t.Errorf("empty string should return empty, got %q", result)
	}
}

func TestDecryptNonEncryptedData(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef"
	os.Setenv("MESSENGER_ENCRYPTION_KEY", key)
	defer os.Unsetenv("MESSENGER_ENCRYPTION_KEY")

	initEncryptionKey()

	result, err := decryptContent("short")
	if err != nil {
		t.Fatalf("decryptContent failed: %v", err)
	}
	if result != "short" {
		t.Errorf("non-encrypted data should return as-is, got %q", result)
	}
}

func TestEncryptWithFallbackKey(t *testing.T) {
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
	defer os.Unsetenv("ENCRYPTION_KEY")

	initEncryptionKey()

	plaintext := "fallback key test"
	encrypted, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent failed: %v", err)
	}
	if encrypted == plaintext {
		t.Fatal("encrypted text should differ from plaintext")
	}
}

func TestEncryptKeyPadding(t *testing.T) {
	os.Setenv("MESSENGER_ENCRYPTION_KEY", "0123456789abcdef")
	defer os.Unsetenv("MESSENGER_ENCRYPTION_KEY")

	initEncryptionKey()

	plaintext := "pad test"
	encrypted, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent failed: %v", err)
	}

	decrypted, err := decryptContent(encrypted)
	if err != nil {
		t.Fatalf("decryptContent failed: %v", err)
	}
	if decrypted != plaintext {
		t.Errorf("decrypted %q, want %q", decrypted, plaintext)
	}
}
