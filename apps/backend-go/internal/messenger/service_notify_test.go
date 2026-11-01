package messenger

import (
	"net/http"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
	"github.com/google/uuid"
)

func TestSendServiceNotification_Success(t *testing.T) {
	h, mock := setupMessengerHandler(t)

	svcID := uuid.New().String()
	userID := uuid.New().String()
	convID := uuid.New().String()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SELECT set_config('app.current_user_id', $1, true)")).
		WithArgs(svcID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT find_or_create_conversation($1, $2)")).
		WithArgs(svcID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"conv"}).AddRow(convID))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE chat_conversations SET is_service = true WHERE id = $1")).
		WithArgs(convID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO chat_messages")).
		WithArgs(convID, svcID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "sent_at"}).AddRow(uuid.New().String(), time.Now()))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE chat_conversations")).
		WithArgs(sqlmock.AnyArg(), svcID, convID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := h.SendServiceNotification(svcID, userID, "Новый вход в аккаунт"); err != nil {
		t.Fatalf("expected success, got: %v", err)
	}
}

func TestSendServiceNotification_BadArgs(t *testing.T) {
	h, _ := setupMessengerHandler(t)
	if err := h.SendServiceNotification("", "u2", "hi"); err == nil {
		t.Fatal("empty service id must fail")
	}
	if err := h.SendServiceNotification("s1", "s1", "hi"); err == nil {
		t.Fatal("self-notify must fail")
	}
	if err := h.SendServiceNotification("s1", "u2", "   "); err == nil {
		t.Fatal("empty text must fail")
	}
}

func TestSendMessage_ServiceThread_Rejected(t *testing.T) {
	h, mock := setupMessengerHandler(t)

	convID := uuid.New().String()
	claims := &auth.Claims{UserID: "user-1", Username: "testuser"}
	body := SendMessageRequest{Content: "hello?", ClientID: "c1"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/"+convID+"/messages", body, claims, map[string]string{"id": convID})

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COALESCE(is_service, false) FROM chat_conversations WHERE id = $1`)).
		WithArgs(convID).
		WillReturnRows(sqlmock.NewRows([]string{"is_service"}).AddRow(true))

	h.SendMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 in service thread, got %d: %s", w.Code, w.Body.String())
	}
}
