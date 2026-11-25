package handlers

import (
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

const (
	summaryTargetID = "11111111-2222-3333-4444-555555555555"
	summaryViewerID = "99999999-8888-7777-6666-555555555555"
)

var summaryUserColumns = []string{"id", "public_id", "username", "display_name", "avatar_url", "nickname_emoji_id"}

func setupSummaryHandler(t *testing.T) (*ProfilesHandler, sqlmock.Sqlmock) {
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

func expectSummaryUsers(mock sqlmock.Sqlmock) *sqlmock.Rows {
	rows := sqlmock.NewRows(summaryUserColumns)
	mock.ExpectQuery(`FROM users u`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), maxProfileSummaryIDs).
		WillReturnRows(rows)
	return rows
}

func expectSummaryPrivacy(mock sqlmock.Sqlmock) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"user_id", "private_profile", "private_hide_avatar", "private_hide_stats", "blocked", "blocked_by_me"})
	mock.ExpectQuery(`FROM users u`).WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(rows)
	return rows
}

func expectSummaryRoles(mock sqlmock.Sqlmock) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"user_id", "role"})
	mock.ExpectQuery(`FROM user_roles`).WithArgs(sqlmock.AnyArg()).WillReturnRows(rows)
	return rows
}

func expectSummaryCustomizations(mock sqlmock.Sqlmock) *sqlmock.Rows {
	rows := sqlmock.NewRows(append([]string{"user_id"}, publicCustomizationRowColumns...))
	mock.ExpectQuery(`FROM profile_customization`).WithArgs(sqlmock.AnyArg()).WillReturnRows(rows)
	return rows
}

func customizationRow(userID, usernameCSS string) []driver.Value {
	return []driver.Value{
		userID, usernameCSS, "VIP", "color: blue",
		nil, "banner", nil, nil, nil, nil, false, nil, nil, nil, nil,
	}
}

func decodeSummaries(t *testing.T, body []byte) []ProfileSummary {
	t.Helper()
	var payload struct {
		Success bool             `json:"success"`
		Data    []ProfileSummary `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode response: %v\n%s", err, body)
	}
	if !payload.Success {
		t.Fatalf("response not successful: %s", body)
	}
	return payload.Data
}

func TestGetProfileSummaries_RequiresIDs(t *testing.T) {
	h, _ := setupSummaryHandler(t)
	c, w := testutil.NewGETContext("/api/v1/profiles/summary", nil)

	h.GetProfileSummaries(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetProfileSummaries_RejectsTooManyIDs(t *testing.T) {
	h, _ := setupSummaryHandler(t)
	ids := make([]string, 0, maxProfileSummaryIDs+1)
	for i := 0; i <= maxProfileSummaryIDs; i++ {
		ids = append(ids, summaryTargetID)
	}
	c, w := testutil.NewGETContext("/api/v1/profiles/summary", map[string]string{"ids": strings.Join(ids, ",")})

	h.GetProfileSummaries(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetProfileSummaries_RejectsMalformedID(t *testing.T) {
	h, _ := setupSummaryHandler(t)
	c, w := testutil.NewGETContext("/api/v1/profiles/summary", map[string]string{"ids": "not-a-user"})

	h.GetProfileSummaries(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetProfileSummaries_UnknownUserIsEmpty200(t *testing.T) {
	h, mock := setupSummaryHandler(t)
	expectSummaryUsers(mock) // no rows
	c, w := testutil.NewGETContext("/api/v1/profiles/summary", map[string]string{"ids": summaryTargetID})

	h.GetProfileSummaries(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if got := decodeSummaries(t, w.Body.Bytes()); len(got) != 0 {
		t.Fatalf("expected empty data, got %+v", got)
	}
}

func TestGetProfileSummaries_SelfIncludesRolesAndSanitizesCSS(t *testing.T) {
	h, mock := setupSummaryHandler(t)

	expectSummaryUsers(mock).AddRow(summaryTargetID, 42, "alice", "Alice", "https://cdn/a.png", "emoji-1")
	expectSummaryPrivacy(mock)
	expectSummaryRoles(mock).AddRow(summaryTargetID, "admin").AddRow(summaryTargetID, "moderator")
	expectSummaryCustomizations(mock).AddRow(customizationRow(summaryTargetID, "color: red; position: fixed; z-index: 999")...)

	c, w := testutil.NewGETContextWithClaims(
		"/api/v1/profiles/summary",
		map[string]string{"ids": summaryTargetID},
		&auth.Claims{UserID: summaryTargetID},
	)

	h.GetProfileSummaries(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeSummaries(t, w.Body.Bytes())
	if len(data) != 1 {
		t.Fatalf("expected 1 summary, got %d", len(data))
	}
	got := data[0]
	if got.Username != "alice" || got.PublicID == nil || *got.PublicID != 42 {
		t.Fatalf("unexpected identity: %+v", got)
	}
	if !got.IsAdmin {
		t.Fatal("self admin role must set is_admin")
	}
	if len(got.Roles) != 2 {
		t.Fatalf("self must receive the full role set, got %v", got.Roles)
	}
	css, _ := got.Customization["username_css"].(string)
	if strings.Contains(css, "position") || strings.Contains(css, "z-index") {
		t.Fatalf("customization CSS was not sanitized: %q", css)
	}
	if strings.Contains(w.Body.String(), "email") {
		t.Fatal("profile summaries must never expose email")
	}
}

func TestGetProfileSummaries_GuestSkipsRoles(t *testing.T) {
	h, mock := setupSummaryHandler(t)

	expectSummaryUsers(mock).AddRow(summaryTargetID, 42, "alice", nil, nil, nil)
	expectSummaryPrivacy(mock)
	// No user_roles query is expected for a guest — sqlmock fails the test if
	// the handler issues one.
	expectSummaryCustomizations(mock).AddRow(customizationRow(summaryTargetID, "color: red")...)

	c, w := testutil.NewGETContext("/api/v1/profiles/summary", map[string]string{"ids": summaryTargetID})

	h.GetProfileSummaries(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	got := decodeSummaries(t, w.Body.Bytes())[0]
	if got.IsAdmin {
		t.Fatal("guests must not see an admin flag")
	}
	if got.Roles != nil {
		t.Fatalf("roles must not be returned to guests, got %v", got.Roles)
	}
}

func TestGetProfileSummaries_AcceptsPublicID(t *testing.T) {
	h, mock := setupSummaryHandler(t)

	expectSummaryUsers(mock).AddRow(summaryTargetID, 42, "alice", nil, nil, nil)
	expectSummaryPrivacy(mock)
	expectSummaryRoles(mock)
	expectSummaryCustomizations(mock)

	c, w := testutil.NewGETContextWithClaims(
		"/api/v1/profiles/summary",
		map[string]string{"ids": "42"},
		&auth.Claims{UserID: summaryViewerID},
	)

	h.GetProfileSummaries(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	got := decodeSummaries(t, w.Body.Bytes())[0]
	if got.ID != summaryTargetID {
		t.Fatalf("expected canonical uuid, got %q", got.ID)
	}
}

func TestGetProfileSummaries_HiddenAvatarIsStripped(t *testing.T) {
	h, mock := setupSummaryHandler(t)

	expectSummaryUsers(mock).AddRow(summaryTargetID, 42, "alice", nil, "https://cdn/a.png", nil)
	expectSummaryPrivacy(mock).AddRow(summaryTargetID, true, true, false, false, false)
	// A private profile for a signed-in non-friend needs the friendship check.
	mock.ExpectQuery(`FROM friendships`).
		WithArgs(summaryViewerID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"user1_id", "user2_id"}))
	expectSummaryRoles(mock)
	expectSummaryCustomizations(mock)

	c, w := testutil.NewGETContextWithClaims(
		"/api/v1/profiles/summary",
		map[string]string{"ids": summaryTargetID},
		&auth.Claims{UserID: summaryViewerID},
	)

	h.GetProfileSummaries(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	got := decodeSummaries(t, w.Body.Bytes())[0]
	if got.AvatarURL != nil {
		t.Fatalf("hidden avatar leaked: %q", *got.AvatarURL)
	}
}
