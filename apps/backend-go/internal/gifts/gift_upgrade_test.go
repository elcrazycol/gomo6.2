package gifts

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

const (
	giftRecordUUID = "550e8400-e29b-41d4-a716-446655440100"
	giftCatalogID  = "550e8400-e29b-41d4-a716-446655440101"
	giftOwnerID    = "550e8400-e29b-41d4-a716-446655440102"
)

func setupGiftUpgradeHandler(t *testing.T) (*GiftsHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)
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
	return NewGiftsHandler(db), mock
}

// expectGiftOwnership mocks the ownership + catalog lookup query.
func expectGiftOwnership(mock sqlmock.Sqlmock, alreadyUpgraded bool, upgradeCost int) {
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT gc\\.id, gc\\.upgrade_cost, ug\\.is_upgraded\\s*FROM user_gifts ug").
		WillReturnRows(sqlmock.NewRows([]string{"gift_catalog_id", "upgrade_cost", "is_upgraded"}).
			AddRow(giftCatalogID, upgradeCost, alreadyUpgraded))
}

func expectLayers(mock sqlmock.Sqlmock, layerTypes ...string) {
	rows := sqlmock.NewRows([]string{"layer_type"})
	for _, lt := range layerTypes {
		rows = rows.AddRow(lt)
	}
	mock.ExpectQuery("SELECT layer_type FROM gift_layers WHERE gift_catalog_id = \\$1").WillReturnRows(rows)
}

func expectRandomLayer(mock sqlmock.Sqlmock, layerType, id, url string) {
	mock.ExpectQuery("SELECT id, image_url FROM gift_layers\\s*WHERE gift_catalog_id = \\$1 AND layer_type = '" + layerType + "'").
		WillReturnRows(sqlmock.NewRows([]string{"id", "image_url"}).AddRow(id, url))
}

func TestUpgradeGift_InvalidGiftRecordID(t *testing.T) {
	handler, _ := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	c, w := testutil.NewPOSTContext("/api/v1/gifts/not-a-uuid/upgrade", nil, claims, map[string]string{"giftRecordID": "not-a-uuid"})
	handler.UpgradeGift(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpgradeGift_NotFound(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT gc\\.id, gc\\.upgrade_cost, ug\\.is_upgraded\\s*FROM user_gifts ug").
		WillReturnRows(sqlmock.NewRows([]string{"gift_catalog_id", "upgrade_cost", "is_upgraded"}))

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpgradeGift_OwnershipQueryError(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT gc\\.id, gc\\.upgrade_cost, ug\\.is_upgraded\\s*FROM user_gifts ug").
		WillReturnError(errors.New("db down"))

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpgradeGift_AlreadyUpgraded(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	expectGiftOwnership(mock, true, 500)

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpgradeGift_NotUpgradable(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	expectGiftOwnership(mock, false, 0)

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpgradeGift_IncompleteLayers(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	expectGiftOwnership(mock, false, 500)
	// Only two of the three required layer types configured
	expectLayers(mock, "gift", "background")

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpgradeGift_InsufficientDrops(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	expectGiftOwnership(mock, false, 500)
	expectLayers(mock, "gift", "background", "symbol")
	// Atomic deduction matches zero rows → not enough drops
	mock.ExpectExec("UPDATE users SET drops = drops - \\$1\\s*WHERE id = \\$2 AND drops >= \\$1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestUpgradeGift_Success(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	expectGiftOwnership(mock, false, 500)
	expectLayers(mock, "gift", "background", "symbol")

	mock.ExpectExec("UPDATE users SET drops = drops - \\$1\\s*WHERE id = \\$2 AND drops >= \\$1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT COALESCE\\(drops, 0\\) FROM users WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(1000))

	expectRandomLayer(mock, "gift", "gift-layer-1", "http://img/gift.png")
	expectRandomLayer(mock, "background", "bg-layer-1", "http://img/bg.png")
	expectRandomLayer(mock, "symbol", "sym-layer-1", "http://img/sym.png")

	mock.ExpectExec("UPDATE user_gifts\\s*SET is_upgraded = TRUE").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO drops_transactions \\(user_id, type, amount, balance_after").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, want := range []string{
		`"gift_layer_id":"gift-layer-1"`,
		`"background_layer_id":"bg-layer-1"`,
		`"symbol_layer_id":"sym-layer-1"`,
		`"gift_layer_image_url":"http://img/gift.png"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("expected %s in body, got: %s", want, body)
		}
	}
}

func TestUpgradeGift_RandomLayerError(t *testing.T) {
	handler, mock := setupGiftUpgradeHandler(t)
	claims := &auth.Claims{UserID: giftOwnerID}

	expectGiftOwnership(mock, false, 500)
	expectLayers(mock, "gift", "background", "symbol")
	mock.ExpectExec("UPDATE users SET drops = drops - \\$1\\s*WHERE id = \\$2 AND drops >= \\$1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT COALESCE\\(drops, 0\\) FROM users WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(1000))
	// First random layer query fails
	mock.ExpectQuery("SELECT id, image_url FROM gift_layers\\s*WHERE gift_catalog_id = \\$1 AND layer_type = 'gift'").
		WillReturnError(errors.New("db down"))

	c, w := testutil.NewPOSTContext("/api/v1/gifts/"+giftRecordUUID+"/upgrade", nil, claims, map[string]string{"giftRecordID": giftRecordUUID})
	handler.UpgradeGift(c)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d, body: %s", w.Code, w.Body.String())
	}
}
