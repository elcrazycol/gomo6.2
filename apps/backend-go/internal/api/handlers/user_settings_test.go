package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

const settingsUserID = "11111111-1111-1111-1111-111111111111"

func setupUserSettingsHandler(t *testing.T) (*UserSettingsHandler, sqlmock.Sqlmock) {
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
	return NewUserSettingsHandler(db), mock
}

var settingsColumns = []string{"theme_id", "theme_mode", "time_auto", "custom_font", "favorite_theme_ids"}

func TestUserSettingsGetNoRow(t *testing.T) {
	h, mock := setupUserSettingsHandler(t)
	mock.ExpectQuery("SELECT theme_id").WithArgs(settingsUserID).
		WillReturnRows(sqlmock.NewRows(settingsColumns))

	c, w := testutil.NewGETContext("/api/v1/user/settings", nil)
	c.Set("claims", &auth.Claims{UserID: settingsUserID})
	h.Get(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if body := w.Body.String(); body != `{"success":true}` && body != `{"success":true,"data":null}` {
		t.Errorf("unexpected body: %s", body)
	}
}

func TestUserSettingsGetRow(t *testing.T) {
	h, mock := setupUserSettingsHandler(t)
	mock.ExpectQuery("SELECT theme_id").WithArgs(settingsUserID).
		WillReturnRows(sqlmock.NewRows(settingsColumns).
			AddRow("slate", "dark", true, "Inter", "{ash,sand}"))

	c, w := testutil.NewGETContext("/api/v1/user/settings", nil)
	c.Set("claims", &auth.Claims{UserID: settingsUserID})
	h.Get(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			ThemeID          string   `json:"theme_id"`
			ThemeMode        string   `json:"theme_mode"`
			TimeAuto         bool     `json:"time_auto"`
			CustomFont       string   `json:"custom_font"`
			FavoriteThemeIDs []string `json:"favorite_theme_ids"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.ThemeID != "slate" || resp.Data.ThemeMode != "dark" || !resp.Data.TimeAuto {
		t.Errorf("unexpected settings: %+v", resp.Data)
	}
	if len(resp.Data.FavoriteThemeIDs) != 2 || resp.Data.FavoriteThemeIDs[0] != "ash" {
		t.Errorf("unexpected favorites: %v", resp.Data.FavoriteThemeIDs)
	}
}

func TestUserSettingsUpdateSanitizesAndUpserts(t *testing.T) {
	h, mock := setupUserSettingsHandler(t)

	// Invalid mode is dropped (NULL); favorites are deduped and malformed ids
	// removed before the upsert.
	mock.ExpectQuery("INSERT INTO user_settings").
		WithArgs(settingsUserID, "graphite", nil, false, nil, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(settingsColumns).
			AddRow("graphite", nil, false, nil, "{ash}"))

	c, w := testutil.NewPUTContext("/api/v1/user/settings", map[string]interface{}{
		"theme_id":           "graphite",
		"theme_mode":         "rainbow",
		"time_auto":          false,
		"favorite_theme_ids": []string{"ash", "ash", "bad id!", "sand<script>"},
	}, &auth.Claims{UserID: settingsUserID}, nil)
	h.Update(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
}

func TestSanitizeThemeID(t *testing.T) {
	cases := map[string]string{
		"graphite":    "graphite",
		"custom:ab12": "custom:ab12",
		"  slate ":    "slate",
		"bad id":      "",
		"<script>":    "",
		"":            "",
	}
	for in, want := range cases {
		if got := sanitizeThemeID(in); got != want {
			t.Errorf("sanitizeThemeID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSanitizeFavorites(t *testing.T) {
	got := sanitizeFavorites([]string{"ash", "ash", "sand", "bad id", ""})
	want := []string{"ash", "sand"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}
