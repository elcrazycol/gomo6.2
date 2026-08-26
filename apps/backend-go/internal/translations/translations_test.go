package translations

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func setupTranslationsHandler(t *testing.T) (*Service, sqlmock.Sqlmock) {
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

	return New(db), mock
}

func claimsFor(userID string) *auth.Claims {
	return &auth.Claims{UserID: userID}
}

// ─── Gin test-context builders ─────────────────────────────────────────────
//
// Local mirrors of the handlers package builders (handler_test_helpers.go):
// a moved package cannot import test helpers from the god package it left.
// The three builders below are copied verbatim so the moved tests read
// identically; when a third domain is extracted, the shared builders move
// into a leaf apitest package and both copies collapse onto it (R5).

// newGETContext creates a gin test context for a GET request.
func newGETContext(url string, queryParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	q := req.URL.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()
	c.Request = req
	return c, w
}

// newPOSTContext creates a gin test context for a POST request with JSON body
// and auth claims.
func newPOSTContext(url string, body interface{}, claims *auth.Claims, pathParams map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(http.MethodPost, url, bodyReader)
	req.Header.Set("Content-Type", "application/json")

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}

// newDELETEPContextWithClaims creates a gin test context for a DELETE request
// with auth claims and path params.
func newDELETEPContextWithClaims(url string, queryParams map[string]string, pathParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, url, nil)
	q := req.URL.Query()
	for k, v := range queryParams {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	for k, v := range pathParams {
		c.Params = append(c.Params, gin.Param{Key: k, Value: v})
	}

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}

func TestListTranslations_AnonymousUsesNullUUID(t *testing.T) {
	h, mock := setupTranslationsHandler(t)

	mock.ExpectQuery(`(?s).*NULLIF\(\$1, ''\)::uuid.*WHERE v\.locale = \$2.*`).
		WithArgs("", "uk").
		WillReturnRows(sqlmock.NewRows([]string{"id", "key", "locale", "value", "user_id", "votes", "created_at", "username", "my_vote"}).
			AddRow("v1", "settings.language", "uk", "Мова", "u1", 3, "2026-08-20T00:00:00Z", "alice", 0))

	c, w := newGETContext("/api/v1/translations", map[string]string{"locale": "uk"})
	h.ListTranslations(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestSubmitTranslation_InsertsNewProposal(t *testing.T) {
	h, mock := setupTranslationsHandler(t)

	// Dedupe lookup returns no rows.
	mock.ExpectQuery(`(?s).*FROM translation_values v.*WHERE v\.key = \$1 AND v\.locale = \$2 AND v\.user_id = \$3 AND v\.value = \$4`).
		WithArgs("common.save", "en", "u1", "Save").
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(`(?s)INSERT INTO translation_values \(key, locale, value, user_id\).*RETURNING id, key, locale, value, user_id, votes, created_at`).
		WithArgs("common.save", "en", "Save", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "key", "locale", "value", "user_id", "votes", "created_at"}).
			AddRow("v1", "common.save", "en", "Save", "u1", 0, "2025-01-01T00:00:00Z"))

	c, w := newPOSTContext("/api/v1/translations", map[string]string{"key": "common.save", "locale": "en", "value": "Save"}, claimsFor("u1"), nil)
	h.SubmitTranslation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestSubmitTranslation_DedupesIdenticalProposal(t *testing.T) {
	h, mock := setupTranslationsHandler(t)

	mock.ExpectQuery(`(?s).*FROM translation_values v.*WHERE v\.key = \$1 AND v\.locale = \$2 AND v\.user_id = \$3 AND v\.value = \$4`).
		WithArgs("common.save", "en", "u1", "Save").
		WillReturnRows(sqlmock.NewRows([]string{"id", "key", "locale", "value", "user_id", "votes", "created_at", "username", "my_vote"}).
			AddRow("v1", "common.save", "en", "Save", "u1", 3, "2025-01-01T00:00:00Z", "alice", 0))

	c, w := newPOSTContext("/api/v1/translations", map[string]string{"key": "common.save", "locale": "en", "value": "Save"}, claimsFor("u1"), nil)
	h.SubmitTranslation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSubmitTranslation_RejectsBadLocale(t *testing.T) {
	h, _ := setupTranslationsHandler(t)

	c, w := newPOSTContext("/api/v1/translations", map[string]string{"key": "common.save", "locale": "not a locale!", "value": "Save"}, claimsFor("u1"), nil)
	h.SubmitTranslation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestVoteTranslation_NewVoteAdds(t *testing.T) {
	h, mock := setupTranslationsHandler(t)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT direction FROM translation_votes WHERE value_id = \$1 AND user_id = \$2`).
		WithArgs("v1", "u1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`INSERT INTO translation_votes \(value_id, user_id, direction\)`).
		WithArgs("v1", "u1", 1).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`UPDATE translation_values SET votes = votes \+ \$2.*RETURNING votes`).
		WithArgs("v1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"votes"}).AddRow(1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/translations/v1/vote", map[string]int{"direction": 1}, claimsFor("u1"), map[string]string{"id": "v1"})
	h.VoteTranslation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestVoteTranslation_SameDirectionTogglesOff(t *testing.T) {
	h, mock := setupTranslationsHandler(t)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT direction FROM translation_votes WHERE value_id = \$1 AND user_id = \$2`).
		WithArgs("v1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"direction"}).AddRow(1))
	mock.ExpectExec(`DELETE FROM translation_votes WHERE value_id = \$1 AND user_id = \$2`).
		WithArgs("v1", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`UPDATE translation_values SET votes = votes \+ \$2.*RETURNING votes`).
		WithArgs("v1", -1).
		WillReturnRows(sqlmock.NewRows([]string{"votes"}).AddRow(0))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/translations/v1/vote", map[string]int{"direction": 1}, claimsFor("u1"), map[string]string{"id": "v1"})
	h.VoteTranslation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestVoteTranslation_OppositeDirectionFlips(t *testing.T) {
	h, mock := setupTranslationsHandler(t)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT direction FROM translation_votes WHERE value_id = \$1 AND user_id = \$2`).
		WithArgs("v1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"direction"}).AddRow(1))
	mock.ExpectExec(`UPDATE translation_votes SET direction = \$3.*WHERE value_id = \$1 AND user_id = \$2`).
		WithArgs("v1", "u1", -1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`UPDATE translation_values SET votes = votes \+ \$2.*RETURNING votes`).
		WithArgs("v1", -2).
		WillReturnRows(sqlmock.NewRows([]string{"votes"}).AddRow(-1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/translations/v1/vote", map[string]int{"direction": -1}, claimsFor("u1"), map[string]string{"id": "v1"})
	h.VoteTranslation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestVoteTranslation_RequiresAuth(t *testing.T) {
	h, _ := setupTranslationsHandler(t)

	c, w := newPOSTContext("/api/v1/translations/v1/vote", map[string]int{"direction": 1}, nil, map[string]string{"id": "v1"})
	h.VoteTranslation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestDeleteTranslation_AuthorCanDelete(t *testing.T) {
	h, mock := setupTranslationsHandler(t)

	// isMod lookup returns no rows → not a moderator.
	mock.ExpectQuery(`SELECT role FROM user_roles WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`DELETE FROM translation_values WHERE id = \$1 AND user_id = \$2`).
		WithArgs("v1", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newDELETEPContextWithClaims("/api/v1/translations/v1", nil, map[string]string{"id": "v1"}, claimsFor("u1"))
	h.DeleteTranslation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}
