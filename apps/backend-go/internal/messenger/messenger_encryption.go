package messenger

import (
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

func EncryptContentForConversation(conversationID, plaintext string) (string, error) {
	return crypto.EncryptForConversation(conversationID, plaintext)
}

func decryptContent(encoded string) (string, error) {
	return crypto.DecryptMaster(encoded)
}

func decryptContentForConversation(conversationID, encoded string) (string, error) {
	return crypto.DecryptForConversation(conversationID, encoded)
}
