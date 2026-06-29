package handlers

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

func setupGiftsHandler(t *testing.T) (*GiftsHandler, sqlmock.Sqlmock) {
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
	handler := NewGiftsHandler(db)
	return handler, mock
}

func TestGetGiftCatalog_Success(t *testing.T) {
	handler, mock := setupGiftsHandler(t)

	rows := sqlmock.NewRows([]string{"id", "name", "description", "image_url", "price", "category",
		"is_active", "is_limited", "max_quantity", "sold_count", "sort_order", "created_at", "updated_at"})
	mock.ExpectQuery("SELECT (.+) FROM gift_catalog").WillReturnRows(rows)

	c, w := newGETContext("/api/v1/gift_catalog", nil)
	handler.GetGiftCatalog(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetGiftCatalog_InvalidLimit(t *testing.T) {
	handler, mock := setupGiftsHandler(t)

	rows := sqlmock.NewRows([]string{"id", "name", "description", "image_url", "price", "category",
		"is_active", "is_limited", "max_quantity", "sold_count", "sort_order", "created_at", "updated_at"})
	mock.ExpectQuery("SELECT (.+) FROM gift_catalog").WillReturnRows(rows)

	c, w := newGETContext("/api/v1/gift_catalog", map[string]string{"limit": "abc"})
	handler.GetGiftCatalog(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestGetUserGifts_MissingRecipientID(t *testing.T) {
	handler, _ := setupGiftsHandler(t)

	c, w := newGETContext("/api/v1/user_gifts", nil)
	handler.GetUserGifts(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestGetUserGifts_Success(t *testing.T) {
	handler, mock := setupGiftsHandler(t)

	// CanViewUserContent → GetPrivacySettings
	mock.ExpectQuery("SELECT (.+) FROM privacy_settings").WillReturnRows(sqlmock.NewRows([]string{
		"private_profile", "private_hide_avatar", "private_hide_wall",
		"private_hide_threads", "private_hide_stats", "private_hide_friends",
		"private_hide_gifts", "private_hide_achievements",
	}).AddRow(false, true, true, true, true, true, true, true))

	mock.ExpectQuery("SELECT COUNT").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	rows := sqlmock.NewRows([]string{"id", "gift_id", "sender_id", "recipient_id", "message",
		"is_anonymous", "created_at",
		"gift_name", "gift_image_url", "gift_price",
		"sender_username", "sender_avatar_url"})
	mock.ExpectQuery("SELECT (.+) FROM user_gifts").WillReturnRows(rows)

	c, w := newGETContext("/api/v1/user_gifts", map[string]string{"recipient_id": "user-123"})
	handler.GetUserGifts(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetUserGifts_LimitZero(t *testing.T) {
	handler, mock := setupGiftsHandler(t)

	// CanViewUserContent → GetPrivacySettings
	mock.ExpectQuery("SELECT (.+) FROM privacy_settings").WillReturnRows(sqlmock.NewRows([]string{
		"private_profile", "private_hide_avatar", "private_hide_wall",
		"private_hide_threads", "private_hide_stats", "private_hide_friends",
		"private_hide_gifts", "private_hide_achievements",
	}).AddRow(false, true, true, true, true, true, true, true))

	mock.ExpectQuery("SELECT COUNT").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(5))

	c, w := newGETContext("/api/v1/user_gifts", map[string]string{"recipient_id": "user-123", "limit": "0"})
	handler.GetUserGifts(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendGift_SelfGift(t *testing.T) {
	handler, _ := setupGiftsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/gifts/send", map[string]interface{}{
		"gift_id":      "550e8400-e29b-41d4-a716-446655440000",
		"recipient_id": "user-123",
	}, claims, nil)
	handler.SendGift(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendGift_InvalidGiftID(t *testing.T) {
	handler, _ := setupGiftsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/gifts/send", map[string]interface{}{
		"gift_id":      "not-a-uuid",
		"recipient_id": "550e8400-e29b-41d4-a716-446655440001",
	}, claims, nil)
	handler.SendGift(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendGift_InvalidRecipientID(t *testing.T) {
	handler, _ := setupGiftsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/gifts/send", map[string]interface{}{
		"gift_id":      "550e8400-e29b-41d4-a716-446655440000",
		"recipient_id": "not-a-uuid",
	}, claims, nil)
	handler.SendGift(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSendGift_InvalidBody(t *testing.T) {
	handler, _ := setupGiftsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/gifts/send", nil, claims, nil)
	handler.SendGift(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}
