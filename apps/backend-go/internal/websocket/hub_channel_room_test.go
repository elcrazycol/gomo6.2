package websocket

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// canAccessRoom must gate channel_<id> rooms behind the same read predicate as
// the REST history path — a private channel's chat stream may never leak
// through a websocket subscription.
func TestCanAccessRoom_ChannelRoom(t *testing.T) {
	const chanID = "10000000-0000-0000-0000-0000000000aa"

	t.Run("allowed member", func(t *testing.T) {
		hub, mock := setupHubWithDB(t)
		mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM channels ch`).
			WithArgs(chanID, "user-1").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

		if !hub.canAccessRoom("user-1", "channel_"+chanID) {
			t.Error("expected channel room access")
		}
	})

	t.Run("denied stranger", func(t *testing.T) {
		hub, mock := setupHubWithDB(t)
		mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM channels ch`).
			WithArgs(chanID, "user-2").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

		if hub.canAccessRoom("user-2", "channel_"+chanID) {
			t.Error("stranger must not subscribe to the channel room")
		}
	})

	t.Run("empty channel id", func(t *testing.T) {
		hub, _ := setupHubWithDB(t)
		if hub.canAccessRoom("user-1", "channel_") {
			t.Error("room without an id must be denied before any DB query")
		}
	})
}

// All three channel chat events must reach subscribers of the room derived
// from payload.channel_id — same contract as messenger chat events.
func TestHandleRedisEvent_ChannelChatEvents(t *testing.T) {
	const chanID = "10000000-0000-0000-0000-0000000000ab"

	for _, tc := range []struct {
		eventType string
		mustMatch string
	}{
		{MessageTypeNewChannelMessage, "new_channel_message"},
		{MessageTypeChannelMessageEdited, "channel_message_edited"},
		{MessageTypeChannelMessageDeleted, "channel_message_deleted"},
	} {
		t.Run(tc.eventType, func(t *testing.T) {
			hub := NewHub(nil, nil)
			client := newTestClient(hub, "user-1", "Alice")
			hub.SubscribeToRoom(client, "channel_"+chanID)

			event := RealtimeEvent{
				Type: tc.eventType,
				Payload: map[string]interface{}{
					"id":         float64(1),
					"channel_id": chanID,
					"content":    "hello",
				},
			}
			hub.handleRedisEvent(event)
			waitForBuffer()

			select {
			case msg := <-client.Send:
				if !containsStr(string(msg), tc.mustMatch) {
					t.Errorf("expected %q, got: %s", tc.mustMatch, string(msg))
				}
			default:
				t.Errorf("%s must reach subscribers of channel_%s", tc.eventType, chanID)
			}
		})
	}
}
