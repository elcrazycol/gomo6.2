package crudengine

import (
	"testing"

	"github.com/gomo6/backend/internal/websocket"
)

// The hook runs after EVERY profile_customization write, so it must stay quiet
// when there is nobody to notify: a degraded deployment without a hub and a row
// that carries no user id are both no-ops rather than panics.
//
// The delivery half — that a "profile_updated" event reaches every client in
// the public feed room — is covered by
// TestHandleRedisEvent_ProfileUpdatedReachesFeedRoom in the websocket package;
// the Redis publish itself is a thin wrapper over PublishToRedis, which that
// package tests directly. (Hub is built with a nil Redis client on purpose:
// PublishToRedis returns early instead of dialing anything.)
func TestAfterProfileCustomizationWriteIsNilSafe(t *testing.T) {
	hub := websocket.NewHub(nil, nil)

	// No hub at all (tests, degraded deployments).
	afterProfileCustomizationWrite(New(nil, nil), nil, "POST", map[string]interface{}{"user_id": "user-1"})

	// A hub is present but the row has no user id.
	afterProfileCustomizationWrite(New(nil, hub), nil, "POST", map[string]interface{}{"not_user_id": "x"})

	// A nil result must not panic either.
	afterProfileCustomizationWrite(New(nil, hub), nil, "POST", nil)
}
