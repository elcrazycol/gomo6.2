package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
	"golang.org/x/crypto/nacl/box"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://gomo6:gomo6@localhost:5432/gomo6?sslmode=disable"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Get all bots
	rows, err := db.Query("SELECT id, username FROM bots")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	var updated int
	for rows.Next() {
		var botID, username string
		if err := rows.Scan(&botID, &username); err != nil {
			log.Printf("Error scanning bot: %v", err)
			continue
		}

		// Generate new key pair
		publicKey, _, err := box.GenerateKey(rand.Reader)
		if err != nil {
			log.Printf("Error generating keys for bot %s: %v", username, err)
			continue
		}

		publicKeyBase64 := base64.StdEncoding.EncodeToString(publicKey[:])

		// Update key
		_, err = db.Exec(`
			INSERT INTO chat_user_keys (user_id, public_key, created_at, updated_at)
			VALUES ($1, $2, NOW(), NOW())
			ON CONFLICT (user_id) DO UPDATE SET public_key = $2, updated_at = NOW()
		`, botID, publicKeyBase64)
		if err != nil {
			log.Printf("Error updating key for bot %s: %v", username, err)
			continue
		}

		log.Printf("Updated key for bot %s (id: %s, key: %s...)", username, botID, publicKeyBase64[:20])
		updated++
	}

	fmt.Printf("\nSuccessfully updated %d bot(s)\n", updated)
}
