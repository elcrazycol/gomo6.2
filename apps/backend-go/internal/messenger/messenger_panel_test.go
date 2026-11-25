package messenger

import (
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
	"github.com/lib/pq"
)

func TestSetMuted_PersistsOnlyOwnMembership(t *testing.T) {
	handler, mock := setupMessengerHandler(t)
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}

	mock.ExpectQuery(`FROM chat_conversations c`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "is_member", "is_group", "is_notes", "is_service", "encryption_mode", "other_user", "peer_blocked_me",
		}).AddRow(testConv1, true, false, false, false, "server", testUser2, false))
	mock.ExpectExec(`UPDATE chat_members\s+SET is_muted = \$3\s+WHERE conversation_id = \$1 AND user_id = \$2`).
		WithArgs(testConv1, testUser1, true).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := testutil.NewPUTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/mute",
		map[string]bool{"muted": true},
		claims,
		map[string]string{"id": testConv1},
	)

	handler.SetMuted(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if data["muted"] != true {
		t.Fatalf("expected muted=true, got %v", data)
	}
}

func TestSetMuted_RequiresMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}

	expectNoConversationAccess(mock, testConv1, testUser1)

	c, w := testutil.NewPUTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/mute",
		map[string]bool{"muted": true},
		claims,
		map[string]string{"id": testConv1},
	)

	handler.SetMuted(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a non-member, got %d", w.Code)
	}
}

func TestSetMuted_RejectsMissingFlag(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}

	c, w := testutil.NewPUTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/mute",
		map[string]string{},
		claims,
		map[string]string{"id": testConv1},
	)

	handler.SetMuted(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without a muted flag, got %d", w.Code)
	}
}

func TestListSharedAttachments_ReturnsNewestFirst(t *testing.T) {
	handler, mock := setupMessengerHandler(t)
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}

	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")
	mock.ExpectQuery(`FROM message_attachments a\s+JOIN chat_messages m`).
		WithArgs(testConv1, pq.Array([]string{"image", "video"}), maxSharedAttachments).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "message_id", "url", "type", "name", "size", "mime", "meta", "sent_at",
		}).
			AddRow("a-1", testMsg1, "user-1/messenger/photo.jpg", "image", "photo.jpg", 1024, "image/jpeg", `{"width":800,"height":600}`, "2026-01-02T10:00:00Z").
			AddRow("a-2", testMsg2, "user-1/messenger/clip.mp4", "video", "clip.mp4", 2048, "video/mp4", nil, "2026-01-01T10:00:00Z"))

	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/"+testConv1+"/attachments?types=image,video",
		nil,
		map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	handler.ListSharedAttachments(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(data) != 2 {
		t.Fatalf("expected 2 attachments, got %d", len(data))
	}
	first := data[0].(map[string]interface{})
	if first["id"] != "a-1" || first["type"] != "image" {
		t.Fatalf("unexpected first attachment: %v", first)
	}
}

func TestListSharedAttachments_RejectsUnknownType(t *testing.T) {
	handler, mock := setupMessengerHandler(t)
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}

	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")

	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/"+testConv1+"/attachments?types=image,hologram",
		nil,
		map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	handler.ListSharedAttachments(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an unknown type, got %d", w.Code)
	}
}

func TestListSharedAttachments_RequiresMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}

	expectNoConversationAccess(mock, testConv1, testUser1)

	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/"+testConv1+"/attachments",
		nil,
		map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	handler.ListSharedAttachments(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a non-member, got %d", w.Code)
	}
}

// A peer block erases the shared-media panel as well: the blocked side gets an
// empty list and never reaches the attachments query.
func TestListSharedAttachments_PeerBlockedReturnsEmpty(t *testing.T) {
	handler, mock := setupMessengerHandler(t)
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}

	expectConversationAccessPeerBlocked(mock, testConv1, testUser1, testUser2)

	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/"+testConv1+"/attachments",
		nil,
		map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	handler.ListSharedAttachments(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("expected no shared media for the blocked side, got %d", len(data))
	}
}
