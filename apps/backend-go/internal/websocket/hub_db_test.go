package websocket

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// setupHubWithDB creates a Hub whose DB is backed by sqlmock.
func setupHubWithDB(t *testing.T) (*Hub, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	hub := NewHub(nil, nil)
	hub.SetDB(db)
	return hub, mock
}

// The membership check must run inside a transaction with SET LOCAL so the RLS
// binding is scoped to that transaction and cannot leak to other pooled
// connections (the previous set_config-via-Exec leaked session state).
func TestIsMemberOfConversation_TxScoped(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectCommit()

	if !hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected member=true")
	}
}

func TestIsMemberOfConversation_NotMember(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectCommit()

	if hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected member=false")
	}
}

func TestIsMemberOfConversation_DBError_FailClosed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "user-1").
		WillReturnError(sqlmock.ErrCancelled)

	if hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected false on DB error (fail-closed)")
	}
}

func TestIsMemberOfConversation_NilDB_FailClosed(t *testing.T) {
	hub := NewHub(nil, nil) // db stays nil
	if hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected false with nil db (fail-closed)")
	}
}

func TestWithUserTx_SetConfigFailure(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnError(sqlmock.ErrCancelled)

	err := hub.withUserTx("user-1", func(tx *sql.Tx) error {
		return nil
	})
	if err == nil {
		t.Fatal("expected error when set_config fails")
	}
}

// =============================================================================
// canAccessRoom — profile_now_playing_* must respect private_profile (M1)
// =============================================================================

func TestCanAccessRoom_NowPlaying_PublicProfile(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile"}).AddRow(false))

	if !hub.canAccessRoom("user-b", "profile_now_playing_user-a") {
		t.Fatal("expected access to a public profile's now-playing room")
	}
}

func TestCanAccessRoom_NowPlaying_PrivateProfile_StrangerDenied(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-b", "user-a").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	if hub.canAccessRoom("user-b", "profile_now_playing_user-a") {
		t.Fatal("stranger must be denied access to a private profile's now-playing room")
	}
}

func TestCanAccessRoom_NowPlaying_PrivateProfile_FriendAllowed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-b", "user-a").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	if !hub.canAccessRoom("user-b", "profile_now_playing_user-a") {
		t.Fatal("friend must be allowed access to a private profile's now-playing room")
	}
}

func TestCanAccessRoom_NowPlaying_OwnerAllowed(t *testing.T) {
	hub, _ := setupHubWithDB(t)
	// Owner is allowed without any DB query.

	if !hub.canAccessRoom("user-a", "profile_now_playing_user-a") {
		t.Fatal("owner must be allowed access to their own now-playing room")
	}
}

func TestCanAccessRoom_NowPlaying_NoPrivacyRow_Allowed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnError(sql.ErrNoRows)

	if !hub.canAccessRoom("user-b", "profile_now_playing_user-a") {
		t.Fatal("expected access when no privacy settings row exists (public default)")
	}
}

func TestCanAccessRoom_NowPlaying_DBError_FailClosed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnError(sqlmock.ErrCancelled)

	if hub.canAccessRoom("user-b", "profile_now_playing_user-a") {
		t.Fatal("expected fail-closed denial on DB error")
	}
}

func TestCanAccessRoom_NowPlaying_EmptyTarget_Denied(t *testing.T) {
	hub, _ := setupHubWithDB(t)
	// Empty target id after the prefix must be rejected without DB queries.

	if hub.canAccessRoom("user-b", "profile_now_playing_") {
		t.Fatal("expected denial for empty target id")
	}
}

// =============================================================================
// areFriends — shared friendship check (used by wall + now-playing rules)
// =============================================================================

func TestAreFriends_Yes(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-a", "user-b").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	if !hub.areFriends("user-a", "user-b") {
		t.Fatal("expected friends=true")
	}
}

func TestAreFriends_No(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-a", "user-b").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	if hub.areFriends("user-a", "user-b") {
		t.Fatal("expected friends=false")
	}
}

func TestAreFriends_DBError_FailClosed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-a", "user-b").
		WillReturnError(sqlmock.ErrCancelled)

	if hub.areFriends("user-a", "user-b") {
		t.Fatal("expected false on DB error (fail-closed)")
	}
}

func TestAreFriends_NilDB_FailClosed(t *testing.T) {
	hub := NewHub(nil, nil) // db stays nil
	if hub.areFriends("user-a", "user-b") {
		t.Fatal("expected false with nil db (fail-closed)")
	}
}

// =============================================================================
// RevokeProfileRoomSubscriptionsFromNonFriends — M1 residual edge case
// =============================================================================

// M1: when a profile becomes private, live subscriptions of non-friend viewers
// to the wall and now-playing rooms must be revoked without reconnecting,
// while owner and friend subscriptions survive. Friendship checks run in map
// iteration order, so expectations are matched unordered.
func TestHub_RevokeProfileRoomSubscriptionsFromNonFriends(t *testing.T) {
	hub, mock := setupHubWithDB(t)
	mock.MatchExpectationsInOrder(false)

	strangerWall := newTestClient(hub, "user-x", "Xavier")
	friendWall := newTestClient(hub, "user-f", "Frank")
	owner := newTestClient(hub, "user-a", "Alice")
	strangerNP := newTestClient(hub, "user-y", "Yara")
	friendNP := newTestClient(hub, "user-g", "Grace")

	hub.SubscribeToRoom(strangerWall, "profile_wall_user-a")
	hub.SubscribeToRoom(friendWall, "profile_wall_user-a")
	hub.SubscribeToRoom(owner, "profile_wall_user-a")
	hub.SubscribeToRoom(strangerNP, "profile_now_playing_user-a")
	hub.SubscribeToRoom(friendNP, "profile_now_playing_user-a")

	friendShip := `SELECT EXISTS\(\s*SELECT 1 FROM friendships`
	mock.ExpectQuery(friendShip).WithArgs("user-x", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(friendShip).WithArgs("user-f", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(friendShip).WithArgs("user-y", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(friendShip).WithArgs("user-g", "user-a").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	hub.RevokeProfileRoomSubscriptionsFromNonFriends("user-a", true, true)

	hub.mu.RLock()
	_, sWall := hub.rooms["profile_wall_user-a"][strangerWall]
	_, fWall := hub.rooms["profile_wall_user-a"][friendWall]
	_, ownWall := hub.rooms["profile_wall_user-a"][owner]
	_, sNP := hub.rooms["profile_now_playing_user-a"][strangerNP]
	_, fNP := hub.rooms["profile_now_playing_user-a"][friendNP]
	hub.mu.RUnlock()

	if sWall {
		t.Error("non-friend stranger must be removed from the wall room")
	}
	if !fWall {
		t.Error("friend must remain in the wall room")
	}
	if !ownWall {
		t.Error("owner must remain in their own wall room")
	}
	if sNP {
		t.Error("non-friend stranger must be removed from the now-playing room")
	}
	if !fNP {
		t.Error("friend must remain in the now-playing room")
	}
	if strangerWall.Rooms["profile_wall_user-a"] {
		t.Error("client.Rooms must not keep the revoked wall room")
	}
	if strangerNP.Rooms["profile_now_playing_user-a"] {
		t.Error("client.Rooms must not keep the revoked now-playing room")
	}
}

func TestHub_RevokeProfileRoomSubscriptionsFromNonFriends_WallOnly(t *testing.T) {
	hub, mock := setupHubWithDB(t)
	mock.MatchExpectationsInOrder(false)

	stranger := newTestClient(hub, "user-x", "Xavier")
	hub.SubscribeToRoom(stranger, "profile_wall_user-a")
	// The now-playing room is not flagged, so it is never consulted.

	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-x", "user-a").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	hub.RevokeProfileRoomSubscriptionsFromNonFriends("user-a", true, false)

	hub.mu.RLock()
	_, still := hub.rooms["profile_wall_user-a"][stranger]
	hub.mu.RUnlock()
	if still {
		t.Error("stranger must be removed from the wall room when only the wall is flagged")
	}
}

func TestHub_RevokeProfileRoomSubscriptionsFromNonFriends_NoCandidates(t *testing.T) {
	hub, mock := setupHubWithDB(t)
	// No room members — no friendship queries may run.

	hub.RevokeProfileRoomSubscriptionsFromNonFriends("user-a", true, true)
	_ = mock
}

func TestHub_RevokeProfileRoomSubscriptionsFromNonFriends_EmptyTargetOrFlags(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	hub.RevokeProfileRoomSubscriptionsFromNonFriends("", true, true)
	hub.RevokeProfileRoomSubscriptionsFromNonFriends("user-a", false, false)
	_ = mock
}

func TestHub_RevokeProfileRoomSubscriptionsFromNonFriends_NilDB_FailClosed(t *testing.T) {
	hub := NewHub(nil, nil) // db stays nil — every friendship check must deny
	stranger := newTestClient(hub, "user-x", "Xavier")
	hub.SubscribeToRoom(stranger, "profile_wall_user-a")

	hub.RevokeProfileRoomSubscriptionsFromNonFriends("user-a", true, true)

	hub.mu.RLock()
	_, still := hub.rooms["profile_wall_user-a"][stranger]
	hub.mu.RUnlock()
	if still {
		t.Error("stranger must be removed when DB is unavailable (fail-closed)")
	}
}
