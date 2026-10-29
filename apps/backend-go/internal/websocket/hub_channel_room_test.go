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
		boardID := "30000000-0000-0000-0000-0000000000cc"
		mock.ExpectQuery(`SELECT ch\.board_id.*FROM channels ch JOIN boards b`).
			WithArgs(chanID).
			WillReturnRows(sqlmock.NewRows([]string{"board_id", "is_private", "owner_id", "visibility"}).
				AddRow(boardID, false, "owner-1", "public"))
		mock.ExpectQuery(`FROM gomosub_bans`).
			WithArgs(boardID, "user-1").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
		mock.ExpectQuery(`timed_out_until FROM gomosub_memberships`).
			WithArgs(boardID, "user-1").
			WillReturnRows(sqlmock.NewRows([]string{"timed_out_until"}).AddRow(nil))
		mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
			WithArgs(boardID, "user-1").
			WillReturnRows(sqlmock.NewRows([]string{"permissions", "is_everyone"}))

		if !hub.canAccessRoom("user-1", "channel_"+chanID) {
			t.Error("expected channel room access")
		}
	})

	t.Run("denied stranger", func(t *testing.T) {
		hub, mock := setupHubWithDB(t)
		boardID := "30000000-0000-0000-0000-0000000000cc"
		mock.ExpectQuery(`SELECT ch\.board_id.*FROM channels ch JOIN boards b`).
			WithArgs(chanID).
			WillReturnRows(sqlmock.NewRows([]string{"board_id", "is_private", "owner_id", "visibility"}).
				AddRow(boardID, true, "owner-1", "public"))
		mock.ExpectQuery(`FROM gomosub_bans`).
			WithArgs(boardID, "user-2").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
		mock.ExpectQuery(`timed_out_until FROM gomosub_memberships`).
			WithArgs(boardID, "user-2").
			WillReturnRows(sqlmock.NewRows([]string{"timed_out_until"}))
		mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
			WithArgs(boardID, "user-2").
			WillReturnRows(sqlmock.NewRows([]string{"permissions", "is_everyone"}))
		mock.ExpectQuery(`(?s)FROM channel_permissions cp.*`).
			WithArgs(chanID, boardID, "user-2").
			WillReturnRows(sqlmock.NewRows([]string{"allow", "deny", "can_read", "can_write", "is_everyone"}))

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
