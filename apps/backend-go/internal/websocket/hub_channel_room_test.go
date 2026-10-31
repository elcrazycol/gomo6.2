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
		// LoadEffective membership check, then the @everyone base view
		// grant (migration 149 default).
		mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
			WithArgs(boardID, "user-1").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
		mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
			WithArgs(boardID, "user-1").
			WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}).
				AddRow("r-everyone", "@everyone", []byte(`{"view_channel": true}`), 0, true))
		mock.ExpectQuery(`(?s)FROM channel_permissions cp.*`).
			WithArgs(chanID, boardID, "user-1").
			WillReturnRows(sqlmock.NewRows([]string{"allow", "deny", "can_read", "can_write", "is_everyone"}))

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

// PublishGomoSubMemberChanged builds the ids-only roster signal. Without
// Redis it is a silent no-op (nil-safe); delivery to the board room happens
// through handleRedisEvent (next test), the same path every publisher shares.
func TestPublishGomoSubMemberChanged_ReachesBoardRoom(t *testing.T) {
	const boardID = "30000000-0000-0000-0000-0000000000cc"

	hub := NewHub(nil, nil)
	if err := hub.PublishGomoSubMemberChanged(boardID, "user-9", "joined"); err != nil {
		t.Fatalf("nil-redis publish must be a silent no-op, got: %v", err)
	}
}

// The same signal arriving from Redis (multi-instance fan-out) must route
// to the board room too.
func TestHandleRedisEvent_MemberChangedRoutesToBoardRoom(t *testing.T) {
	const boardID = "30000000-0000-0000-0000-0000000000cd"

	hub := NewHub(nil, nil)
	client := newTestClient(hub, "user-1", "Alice")
	hub.SubscribeToRoom(client, "board_"+boardID)

	hub.handleRedisEvent(RealtimeEvent{
		Type: MessageTypeGomoSubMemberChanged,
		Payload: map[string]interface{}{
			"board_id": boardID,
			"user_id":  "user-9",
			"action":   "roles_changed",
		},
	})
	waitForBuffer()

	select {
	case msg := <-client.Send:
		if !containsStr(string(msg), "roles_changed") {
			t.Errorf("expected roles_changed in %s", string(msg))
		}
	default:
		t.Error("redis member-changed event must reach subscribers of board_<id>")
	}
}
