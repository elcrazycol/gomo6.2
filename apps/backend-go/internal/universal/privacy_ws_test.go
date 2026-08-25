package universal

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/websocket"
)

func subscribeWS(t *testing.T, hub *websocket.Hub, userID, username, room string) *websocket.Client {
	t.Helper()
	client := &websocket.Client{
		Hub:      hub,
		Send:     make(chan []byte, 16),
		UserID:   userID,
		Username: username,
		Rooms:    make(map[string]bool),
	}
	hub.SubscribeToRoom(client, room)
	return client
}

// M1 residual edge case: flipping private_profile to true must revoke live
// wall + now-playing subscriptions of non-friend viewers (a subscription
// authorized while the profile was public must not outlive the privacy
// change), while owner and friends stay subscribed.
func TestRevokeSubscriptionsAfterPrivacyChange_PrivateProfile(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(false)

	hub := websocket.NewHub(nil, nil)
	hub.SetDB(db)
	handler := NewUniversalHandler(db, hub)

	strangerWall := subscribeWS(t, hub, "user-x", "Xavier", "profile_wall_user-a")
	friendWall := subscribeWS(t, hub, "user-f", "Frank", "profile_wall_user-a")
	ownerWall := subscribeWS(t, hub, "user-a", "Alice", "profile_wall_user-a")
	strangerNP := subscribeWS(t, hub, "user-y", "Yara", "profile_now_playing_user-a")
	friendNP := subscribeWS(t, hub, "user-g", "Grace", "profile_now_playing_user-a")

	friendShip := `SELECT EXISTS\(\s*SELECT 1 FROM friendships`
	mock.ExpectQuery(friendShip).WithArgs("user-x", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(friendShip).WithArgs("user-f", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(friendShip).WithArgs("user-y", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(friendShip).WithArgs("user-g", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	handler.revokeSubscriptionsAfterPrivacyChange("privacy_settings", map[string]interface{}{
		"user_id":         "user-a",
		"private_profile": true,
	})

	if strangerWall.Rooms["profile_wall_user-a"] {
		t.Error("non-friend stranger must lose the wall room subscription")
	}
	if !friendWall.Rooms["profile_wall_user-a"] {
		t.Error("friend must keep the wall room subscription")
	}
	if !ownerWall.Rooms["profile_wall_user-a"] {
		t.Error("owner must keep their own wall room subscription")
	}
	if strangerNP.Rooms["profile_now_playing_user-a"] {
		t.Error("non-friend stranger must lose the now-playing room subscription")
	}
	if !friendNP.Rooms["profile_now_playing_user-a"] {
		t.Error("friend must keep the now-playing room subscription")
	}
}

// private_hide_wall alone (public profile, hidden wall) revokes only the wall
// room; the now-playing room is not consulted at all.
func TestRevokeSubscriptionsAfterPrivacyChange_HideWallOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	defer db.Close()

	hub := websocket.NewHub(nil, nil)
	hub.SetDB(db)
	handler := NewUniversalHandler(db, hub)

	strangerWall := subscribeWS(t, hub, "user-x", "Xavier", "profile_wall_user-a")
	strangerNP := subscribeWS(t, hub, "user-y", "Yara", "profile_now_playing_user-a")

	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-x", "user-a").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.revokeSubscriptionsAfterPrivacyChange("privacy_settings", map[string]interface{}{
		"user_id":           "user-a",
		"private_profile":   false,
		"private_hide_wall": true,
	})

	if strangerWall.Rooms["profile_wall_user-a"] {
		t.Error("stranger must lose the wall room subscription when the wall is hidden")
	}
	if !strangerNP.Rooms["profile_now_playing_user-a"] {
		t.Error("now-playing room must be untouched when only the wall is hidden")
	}
}

// Without a hub or for unrelated tables the helper must be a no-op.
func TestRevokeSubscriptionsAfterPrivacyChange_NoopCases(t *testing.T) {
	handler, mock := setupUniversalHandler(t) // hub = nil

	handler.revokeSubscriptionsAfterPrivacyChange("privacy_settings", map[string]interface{}{
		"user_id":         "user-a",
		"private_profile": true,
	})
	handler.revokeSubscriptionsAfterPrivacyChange("profiles", map[string]interface{}{
		"user_id": "user-a",
	})
	_ = mock
}
