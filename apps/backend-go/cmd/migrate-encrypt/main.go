package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"github.com/gomo6/backend/internal/crypto"

	_ "github.com/lib/pq"
)

// This script encrypts existing plaintext messages in the database.
// Run BEFORE deploying the new backend that requires MESSENGER_ENCRYPTION_KEY.
//
// Usage:
//   DATABASE_URL=postgres://... MESSENGER_ENCRYPTION_KEY=$(openssl rand -hex 32) go run cmd/migrate-encrypt/main.go
//
// Or with an existing key:
//   DATABASE_URL=postgres://... MESSENGER_ENCRYPTION_KEY=<existing-key> go run cmd/migrate-encrypt/main.go

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	keyHex := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if keyHex == "" {
		keyHex = os.Getenv("ENCRYPTION_KEY")
	}
	if keyHex == "" {
		log.Fatal("MESSENGER_ENCRYPTION_KEY is required")
	}
	key, err := crypto.ParseMessengerKey(keyHex)
	if err != nil {
		log.Fatalf("invalid MESSENGER_ENCRYPTION_KEY: %v", err)
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping: %v", err)
	}

	log.Println("Starting plaintext → ciphertext migration...")

	// Migrate chat_messages.content
	migrated, skipped, errors := encryptTable(db, key,
		"chat_messages", "id", "content",
		"WHERE content IS NOT NULL AND content != ''",
	)
	log.Printf("chat_messages: migrated=%d skipped=%d errors=%d", migrated, skipped, errors)

	// Migrate chat_conversations.last_message_preview
	migrated, skipped, errors = encryptTable(db, key,
		"chat_conversations", "id", "last_message_preview",
		"WHERE last_message_preview IS NOT NULL AND last_message_preview != ''",
	)
	log.Printf("chat_conversations: migrated=%d skipped=%d errors=%d", migrated, skipped, errors)

	log.Println("Migration complete!")
}

// isEncrypted checks if content is already encrypted (valid base64 that decodes to >= nonceSize).
func isEncrypted(content string, key []byte) bool {
	ciphertext, err := base64.RawStdEncoding.DecodeString(content)
	if err != nil {
		return false
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return false
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return false
	}
	return len(ciphertext) >= aesGCM.NonceSize()
}

func encryptPlaintext(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func encryptTable(db *sql.DB, key []byte, table, idCol, contentCol, whereClause string) (migrated, skipped, errors int) {
	batchSize := 1000
	offset := 0

	for {
		query := fmt.Sprintf("SELECT %s, %s FROM %s %s ORDER BY %s LIMIT %d OFFSET %d",
			idCol, contentCol, table, whereClause, idCol, batchSize, offset)

		rows, err := db.Query(query)
		if err != nil {
			log.Printf("Query error: %v", err)
			errors++
			return
		}

		type row struct {
			id      string
			content string
		}
		var batch []row

		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.content); err != nil {
				log.Printf("Scan error: %v", err)
				errors++
				continue
			}
			batch = append(batch, r)
		}
		rows.Close()

		if len(batch) == 0 {
			break
		}

		// Process batch
		tx, err := db.Begin()
		if err != nil {
			log.Printf("Transaction error: %v", err)
			errors++
			return
		}

		for _, r := range batch {
			if isEncrypted(r.content, key) {
				skipped++
				continue
			}

			encrypted, err := encryptPlaintext(key, r.content)
			if err != nil {
				log.Printf("Encrypt error for %s %s: %v", idCol, r.id, err)
				errors++
				continue
			}

			updateQuery := fmt.Sprintf("UPDATE %s SET %s = $1 WHERE %s = $2", table, contentCol, idCol)
			if _, err := tx.Exec(updateQuery, encrypted, r.id); err != nil {
				log.Printf("Update error for %s %s: %v", idCol, r.id, err)
				errors++
				continue
			}
			migrated++
		}

		if err := tx.Commit(); err != nil {
			log.Printf("Commit error: %v", err)
			errors++
		}

		offset += batchSize
		if len(batch) < batchSize {
			break
		}

		// Progress log every batch
		if migrated > 0 && strings.HasSuffix(fmt.Sprintf("%d", migrated), "000") {
			log.Printf("Progress: %d migrated, %d skipped, %d errors", migrated, skipped, errors)
		}
	}

	return
}
