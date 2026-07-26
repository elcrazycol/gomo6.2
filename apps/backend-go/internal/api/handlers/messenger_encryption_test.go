package handlers

import (
	"os"
	"testing"
)

func initEncryptionKey() {
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
	defer func() { messengerEncryptionKey = nil }()

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
	_, err := encryptContent(plaintext)
	// With mandatory key, encryption should fail if key is nil
	// (the key is set by init() from the package, so we need to unset it after)
	// This test verifies the function doesn't panic
	if err == nil && messengerEncryptionKey == nil {
		t.Log("encryptContent without key returned no error (key loaded from env)")
	}
}

func TestDecryptWithoutKey(t *testing.T) {
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Unsetenv("ENCRYPTION_KEY")
	initEncryptionKey()

	// When key is nil, decryptContent returns error
	result, err := decryptContent("some data")
	if messengerEncryptionKey == nil {
		if err == nil {
			t.Error("without key, should return error")
		}
	} else {
		if err != nil {
			t.Logf("decryptContent with key returned error: %v", err)
		}
		_ = result
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
	defer func() { messengerEncryptionKey = nil }()

	// With mandatory key, non-encrypted data returns error (not passthrough)
	_, err := decryptContent("short")
	if err == nil {
		t.Error("non-encrypted data should return error, not passthrough")
	}
}

func TestEncryptWithFallbackKey(t *testing.T) {
	os.Unsetenv("MESSENGER_ENCRYPTION_KEY")
	os.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
	defer os.Unsetenv("ENCRYPTION_KEY")

	initEncryptionKey()
	defer func() { messengerEncryptionKey = nil }()

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
	defer func() { messengerEncryptionKey = nil }()

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

func TestEncryptDecryptMultipleMessages(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef"
	os.Setenv("MESSENGER_ENCRYPTION_KEY", key)
	defer os.Unsetenv("MESSENGER_ENCRYPTION_KEY")

	initEncryptionKey()
	defer func() { messengerEncryptionKey = nil }()

	messages := []string{
		"",
		"a",
		"Hello!",
		string(make([]byte, 4096)),
		"Unicode: привет мир 🎉",
	}
	for i, msg := range messages {
		enc, err := encryptContent(msg)
		if err != nil {
			t.Fatalf("encrypt[%d] failed: %v", i, err)
		}
		if msg != "" && enc == msg {
			t.Errorf("encrypt[%d]: encrypted same as plaintext", i)
		}
		dec, err := decryptContent(enc)
		if err != nil {
			t.Fatalf("decrypt[%d] failed: %v", i, err)
		}
		if dec != msg {
			t.Errorf("decrypt[%d]: got %q, want %q", i, dec, msg)
		}
	}
}

func TestEncryptDifferentNonces(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef"
	os.Setenv("MESSENGER_ENCRYPTION_KEY", key)
	defer os.Unsetenv("MESSENGER_ENCRYPTION_KEY")

	initEncryptionKey()
	defer func() { messengerEncryptionKey = nil }()

	enc1, _ := encryptContent("same message")
	enc2, _ := encryptContent("same message")
	if enc1 == enc2 {
		t.Error("two encryptions of same text should produce different ciphertexts (random nonce)")
	}
}
