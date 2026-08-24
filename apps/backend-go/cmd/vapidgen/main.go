// Command vapidgen generates a VAPID key pair for Web Push (PWA) notifications.
// Paste the output into the backend .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// The pair must be stable across restarts — existing subscriptions are bound to
// the public key they were created with.
package main

import (
	"fmt"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func main() {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatalf("generate VAPID keys: %v", err)
	}
	fmt.Println("Add these to the backend .env:")
	fmt.Println("VAPID_PUBLIC_KEY=" + publicKey)
	fmt.Println("VAPID_PRIVATE_KEY=" + privateKey)
	// VAPID_SUBJECT is a contact email, WITHOUT a mailto: prefix — webpush-go
	// prepends "mailto:" itself, and a double prefix is rejected by Apple as
	// BadJwtToken.
	fmt.Println("VAPID_SUBJECT=admin@gomo6.wtf")
	fmt.Println("")
	fmt.Println("The frontend pulls the public key at runtime from /api/v1/push/vapid-public-key,")
	fmt.Println("so only the backend needs these values.")
}
