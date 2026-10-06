package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

// publicCustomizationRowColumns mirrors the SELECT list of GetUserCustomization.
var publicCustomizationRowColumns = []string{
	"username_css", "profile_badge_text", "profile_badge_css",
	"background_url", "background_variant", "background_color", "card_background",
	"text_color", "theme_color", "theme_enabled", "theme_tokens", "font_family",
	"font_size", "layout_type",
}

func setupCustomizationHandler(t *testing.T) (*ProfilesHandler, sqlmock.Sqlmock) {
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
	return NewProfilesHandler(db), mock
}

func expectPublicCustomizationQuery(mock sqlmock.Sqlmock, userID string) *sqlmock.Rows {
	r := sqlmock.NewRows(publicCustomizationRowColumns)
	mock.ExpectQuery(`SELECT username_css, profile_badge_text.*FROM profile_customization WHERE user_id = \$1`).
		WithArgs(userID).
		WillReturnRows(r)
	return r
}

// testCustomizationTargetID is a valid UUID used across the
// GetUserCustomization tests (the handler rejects non-UUID ids).
const testCustomizationTargetID = "11111111-2222-3333-4444-555555555555"

// TestGetUserCustomization_ReturnsPublicFieldsForForeignViewer is the regression
// guard for the bug this endpoint exists for: the generic
// /profile_customization surface is scoped to the caller's own user_id, so a
// foreign viewer received an empty row and never saw anyone else's nickname
// colour. The public projection must carry the display fields and nothing
// owner-only.
func TestGetUserCustomization_ReturnsPublicFieldsForForeignViewer(t *testing.T) {
	h, mock := setupCustomizationHandler(t)

	expectPublicCustomizationQuery(mock, testCustomizationTargetID).AddRow(
		"color: red; position: fixed; z-index: 999999", // sanitized on the way out
		"V\tI\rP", // badge text is neutralized too
		"color: blue",
		"11111111-2222-3333-4444-555555555555/seed/bg.png",
		"page",
		"#ffffff",
		"#f8f9fa",
		"#000000",
		"#000000",
		true,
		[]byte(`{"--primary":"265 85% 62%"}`),
		"system-ui",
		16,
		"default",
	)

	c, w := newGETContextWithParams(
		"/api/v1/users/"+testCustomizationTargetID+"/customization",
		nil,
		map[string]string{"id": testCustomizationTargetID},
	)
	h.GetUserCustomization(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if got, want := resp.Data["username_css"], "color: red"; got != want {
		t.Errorf("username_css = %v, want %q (hostile declarations must be stripped)", got, want)
	}
	if got, want := resp.Data["background_url"], "11111111-2222-3333-4444-555555555555/seed/bg.png"; got != want {
		t.Errorf("background_url = %v, want %q", got, want)
	}
	if got, want := resp.Data["profile_badge_text"], "VIP"; got != want {
		t.Errorf("profile_badge_text = %v, want %q (control characters stripped)", got, want)
	}
	if enabled, ok := resp.Data["theme_enabled"].(bool); !ok || !enabled {
		t.Errorf("theme_enabled = %v, want true", resp.Data["theme_enabled"])
	}

	// Owner-only columns must never reach a foreign viewer.
	for _, ownerOnly := range []string{"custom_css", "language", "id", "created_at", "updated_at"} {
		if _, present := resp.Data[ownerOnly]; present {
			t.Errorf("owner-only column %q leaked into the public response", ownerOnly)
		}
	}
}

// TestGetUserCustomization_NoRowIsNull keeps the contract the frontend read
// relied on: nobody-has-a-row is a 200 with a null payload, not an error.
func TestGetUserCustomization_NoRowIsNull(t *testing.T) {
	h, mock := setupCustomizationHandler(t)

	expectPublicCustomizationQuery(mock, testCustomizationTargetID) // no rows

	c, w := newGETContextWithParams(
		"/api/v1/users/"+testCustomizationTargetID+"/customization",
		nil,
		map[string]string{"id": testCustomizationTargetID},
	)
	h.GetUserCustomization(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"data":null`) {
		t.Errorf("expected data:null, got %s", body)
	}
}

func TestGetUserCustomization_RejectsInvalidUUID(t *testing.T) {
	h, _ := setupCustomizationHandler(t)

	c, w := newGETContextWithParams(
		"/api/v1/users/not-a-uuid/customization",
		nil,
		map[string]string{"id": "not-a-uuid"},
	)
	h.GetUserCustomization(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetUserCustomization_DBErrorIs500(t *testing.T) {
	h, mock := setupCustomizationHandler(t)

	mock.ExpectQuery(`SELECT username_css, profile_badge_text.*FROM profile_customization WHERE user_id = \$1`).
		WithArgs(testCustomizationTargetID).
		WillReturnError(errors.New("boom"))

	c, w := newGETContextWithParams(
		"/api/v1/users/"+testCustomizationTargetID+"/customization",
		nil,
		map[string]string{"id": testCustomizationTargetID},
	)
	h.GetUserCustomization(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
