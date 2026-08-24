package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func setupPushHandler(t *testing.T) (*PushHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	// Point VAPID env at dummy keys so push.New returns an enabled service.
	t.Setenv("VAPID_PUBLIC_KEY", "test-public")
	t.Setenv("VAPID_PRIVATE_KEY", "test-private")
	t.Setenv("VAPID_SUBJECT", "mailto:test@example.com")

	handler := NewPushHandler(NewPushService(db))
	return handler, mock
}

func TestPushHandler_SubscribeUpsert(t *testing.T) {
	handler, mock := setupPushHandler(t)
	body := map[string]string{"endpoint": "https://push.example/x", "p256dh": "k1", "auth": "k2", "user_agent": "iPhone"}
	c, w := newPOSTContext("/api/v1/push/subscribe", body, &auth.Claims{UserID: "u1"}, nil)

	mock.ExpectExec(`INSERT INTO push_subscriptions .*ON CONFLICT .*DO UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.Subscribe(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestPushHandler_SubscribeUnauthenticated(t *testing.T) {
	handler, _ := setupPushHandler(t)
	body := map[string]string{"endpoint": "https://push.example/x", "p256dh": "k1", "auth": "k2"}
	c, w := newPOSTContext("/api/v1/push/subscribe", body, nil, nil)

	handler.Subscribe(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestPushHandler_SubscribeInvalidBody(t *testing.T) {
	handler, _ := setupPushHandler(t)
	body := map[string]string{"endpoint": "https://push.example/x"} // missing keys
	c, w := newPOSTContext("/api/v1/push/subscribe", body, &auth.Claims{UserID: "u1"}, nil)
	handler.Subscribe(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPushHandler_Unsubscribe(t *testing.T) {
	handler, mock := setupPushHandler(t)
	body := map[string]string{"endpoint": "https://push.example/x"}
	c, w := newPOSTContext("/api/v1/push/subscribe", body, &auth.Claims{UserID: "u1"}, nil)

	// DeleteSubscription SQL
	mock.ExpectExec(`DELETE FROM push_subscriptions WHERE user_id = \$1 AND endpoint = \$2`).
		WithArgs("u1", "https://push.example/x").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.Unsubscribe(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestPushHandler_GetPreferences(t *testing.T) {
	handler, mock := setupPushHandler(t)
	c, w := newGETContextWithClaims("/api/v1/push/preferences", nil, &auth.Claims{UserID: "u1"})

	mock.ExpectQuery(`SELECT type_map FROM push_preferences WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"type_map"}).AddRow([]byte(`{"like":false}`)))

	handler.GetPreferences(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			TypeMap        map[string]bool `json:"type_map"`
			AvailableTypes []string        `json:"available_types"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Data.TypeMap["like"] != false {
		t.Fatalf("expected like=false, got %+v", resp.Data.TypeMap)
	}
	if len(resp.Data.AvailableTypes) == 0 {
		t.Fatalf("expected available_types catalog")
	}
}

func TestPushHandler_UpdatePreferences(t *testing.T) {
	handler, mock := setupPushHandler(t)
	reqBody := map[string]interface{}{"type_map": map[string]bool{"like": false, "reply": true}}
	c, w := newPOSTContext("/api/v1/push/preferences", reqBody, &auth.Claims{UserID: "u1"}, nil)

	mock.ExpectExec(`INSERT INTO push_preferences .*ON CONFLICT .*DO UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.UpdatePreferences(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}
