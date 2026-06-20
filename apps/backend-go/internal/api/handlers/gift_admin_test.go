package handlers

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

func setupGiftAdminHandler(t *testing.T) (*GiftAdminHandler, sqlmock.Sqlmock) {
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
	return NewGiftAdminHandler(db), mock
}

func TestGiftAdmin_ListGifts_NotAdmin(t *testing.T) {
	handler, mock := setupGiftAdminHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT COUNT").WithArgs("user-123").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	c, w := newGETContextWithClaims("/api/v1/admin/gifts", nil, claims)
	handler.ListGifts(c)

	if w.Code != 403 {
		t.Errorf("expected 403, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGiftAdmin_ListGifts_Admin(t *testing.T) {
	handler, mock := setupGiftAdminHandler(t)
	claims := &auth.Claims{UserID: "admin-1"}

	mock.ExpectQuery("SELECT COUNT").WithArgs("admin-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	giftRows := sqlmock.NewRows([]string{"id", "name", "description", "image_url", "price", "category",
		"is_active", "is_limited", "max_quantity", "sold_count", "sort_order", "created_at", "updated_at"})
	mock.ExpectQuery("SELECT (.+) FROM gift_catalog").WillReturnRows(giftRows)

	c, w := newGETContextWithClaims("/api/v1/admin/gifts", nil, claims)
	handler.ListGifts(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGiftAdmin_CreateGift_NotAdmin(t *testing.T) {
	handler, mock := setupGiftAdminHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT COUNT").WithArgs("user-123").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	c, w := newPOSTContext("/api/v1/admin/gifts", map[string]interface{}{
		"name": "Test Gift",
	}, claims, nil)
	handler.CreateGift(c)

	if w.Code != 403 {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestGiftAdmin_CreateGift_InvalidBody(t *testing.T) {
	handler, mock := setupGiftAdminHandler(t)
	claims := &auth.Claims{UserID: "admin-1"}

	mock.ExpectQuery("SELECT COUNT").WithArgs("admin-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	c, w := newPOSTContext("/api/v1/admin/gifts", nil, claims, nil)
	handler.CreateGift(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGiftAdmin_DeleteGift_NotAdmin(t *testing.T) {
	handler, mock := setupGiftAdminHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT COUNT").WithArgs("user-123").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	c, w := newPOSTContext("/api/v1/admin/gifts/gift-1", nil, claims, map[string]string{"id": "gift-1"})
	c.Request.Method = "DELETE"
	handler.DeleteGift(c)

	if w.Code != 403 {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestGiftAdmin_DeleteGift_Success(t *testing.T) {
	handler, mock := setupGiftAdminHandler(t)
	claims := &auth.Claims{UserID: "admin-1"}

	mock.ExpectQuery("SELECT COUNT").WithArgs("admin-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectExec("UPDATE gift_catalog SET is_active").WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newPOSTContext("/api/v1/admin/gifts/gift-1", nil, claims, map[string]string{"id": "gift-1"})
	c.Request.Method = "DELETE"
	handler.DeleteGift(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}
