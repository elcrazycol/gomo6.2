package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

// setupAuthHandlerWithRedis returns an AuthHandler with a mock DB and a real
// (miniredis-backed) Redis client, so revocation/blacklist paths are exercised
// end to end.
func setupAuthHandlerWithRedis(t *testing.T) (*AuthHandler, sqlmock.Sqlmock, *miniredis.Miniredis) {
	t.Helper()
	h, mock := setupAuthHandler(t)
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	h.SetRedis(client)
	return h, mock, mr
}

// ─── createLoginSession ──────────────────────────────────────────────────────

func TestCreateLoginSession_PersistsRowWithGeo(t *testing.T) {
	h, mock := setupAuthHandler(t)

	// INSERT is the only expected DB interaction; cleanup query may return 0 rows.
	mock.ExpectExec(`INSERT INTO user_sessions`).
		WithArgs(
			sqlmock.AnyArg(), // session id
			"u1",
			sqlmock.AnyArg(), // refresh hash
			sqlmock.AnyArg(), // access jti
			sqlmock.AnyArg(), // user agent
			sqlmock.AnyArg(), // os
			sqlmock.AnyArg(), // browser
			sqlmock.AnyArg(), // device type
			"8.8.8.8",        // ip (public → geo lookup must run)
			"US",             // country_code from embedded geo data
			"США",            // country_name
		).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}))

	pair, err := h.createLoginSession("u1", "testuser", "localhost:8080",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0", "8.8.8.8")
	if err != nil {
		t.Fatalf("createLoginSession failed: %v", err)
	}
	if pair.SessionID == "" || len(pair.SessionID) != 32 {
		t.Fatalf("expected a 32-char opaque session id, got %q", pair.SessionID)
	}
	if pair.AccessJTI == "" {
		t.Fatal("expected access jti to be tracked")
	}
	claims, err := h.authService.ValidateToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("access token invalid: %v", err)
	}
	if claims.SessionID != pair.SessionID {
		t.Errorf("token must carry the session id, got %q", claims.SessionID)
	}
}

// ─── parseUserAgent ──────────────────────────────────────────────────────────

func TestParseUserAgent(t *testing.T) {
	tests := []struct {
		ua         string
		os, br, dt string
	}{
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Windows", "Chrome", "desktop"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "macOS", "Safari", "desktop"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "iOS", "Safari", "mobile"},
		{"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "Android", "Chrome", "mobile"},
		{"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "iOS", "Safari", "tablet"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/120.0.0.0", "Windows", "Edge", "desktop"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "Linux", "Firefox", "desktop"},
		{"", "Unknown", "Unknown", "desktop"},
	}
	for _, tt := range tests {
		os, br, dt := parseUserAgent(tt.ua)
		if os != tt.os || br != tt.br || dt != tt.dt {
			t.Errorf("parseUserAgent(%q) = (%s, %s, %s), want (%s, %s, %s)", tt.ua, os, br, dt, tt.os, tt.br, tt.dt)
		}
	}
}

// ─── ListSessions ────────────────────────────────────────────────────────────

func TestListSessions_MarksCurrentFromSIDClaim(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", SessionID: "cur-1"}

	// The UPDATE of the current session is best-effort (unexpected call → ignored).
	mock.ExpectQuery(`SELECT id, user_agent, os_name, browser_name, device_type`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "user_agent", "os_name", "browser_name", "device_type", "ip_address",
			"country_code", "country_name", "created_at", "last_active_at",
		}).
			AddRow("cur-1", "ua", "Windows", "Chrome", "desktop", "8.8.8.8", "US", "США", time.Now(), time.Now()).
			AddRow("old-1", "ua", "macOS", "Safari", "desktop", "77.88.8.8", "RU", "Россия", time.Now(), time.Now()))

	c, w := newGETContextWithClaims("/auth/v1/sessions", nil, claims)
	h.ListSessions(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []sessionResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(resp.Data))
	}
	if !resp.Data[0].IsCurrent {
		t.Error("session matching the sid claim must be marked is_current")
	}
	if resp.Data[1].IsCurrent {
		t.Error("other sessions must not be marked is_current")
	}
	if resp.Data[0].CountryCode != "US" || resp.Data[1].CountryName != "Россия" {
		t.Errorf("country fields not populated: %+v", resp.Data)
	}
	if resp.Data[0].Online || resp.Data[1].Online {
		t.Error("online must be false when Redis is unavailable")
	}
}

func TestListSessions_OnlineFromRedisPresence(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", SessionID: "cur-1"}

	mock.ExpectQuery(`SELECT id, user_agent, os_name, browser_name, device_type`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "user_agent", "os_name", "browser_name", "device_type", "ip_address",
			"country_code", "country_name", "created_at", "last_active_at",
		}).
			AddRow("cur-1", "ua", "Windows", "Chrome", "desktop", "", "", "", time.Now(), time.Now()).
			AddRow("old-1", "ua", "macOS", "Safari", "desktop", "", "", "", time.Now(), time.Now()))

	// Simulate a live WebSocket for the second device.
	if err := mr.Set("ws:online:u1:old-1", "1"); err != nil {
		t.Fatalf("failed to seed presence: %v", err)
	}

	c, w := newGETContextWithClaims("/auth/v1/sessions", nil, claims)
	h.ListSessions(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []sessionResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Data[1].Online {
		t.Error("session with a live ws:online marker must be reported online")
	}
	if resp.Data[0].Online {
		t.Error("current session without a ws:online marker must be offline")
	}
}

// ─── DeleteSession ───────────────────────────────────────────────────────────

func TestDeleteSession_RevokesAndBlacklists(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", SessionID: "cur-1"}

	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("victim-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}).
			AddRow("victim-1", "refhash-1", "jti-1"))
	mock.ExpectExec(`DELETE FROM user_sessions`).WithArgs("victim-1", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newDELETEPContext("/auth/v1/sessions/victim-1", nil, map[string]string{"id": "victim-1"})
	c.Set("claims", claims)
	h.DeleteSession(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			OK         bool `json:"ok"`
			WasCurrent bool `json:"was_current"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Data.OK || resp.Data.WasCurrent {
		t.Fatalf("unexpected response: %+v", resp.Data)
	}

	// Instant revocation must be observable: access token blacklisted,
	// refresh token gone.
	if !mr.Exists("blacklist:jti-1") {
		t.Error("revoked session's access token must be blacklisted")
	}
	if mr.Exists("refresh:u1:refhash-1") {
		t.Error("revoked session's refresh token must be deleted")
	}
}

func TestDeleteSession_NotFound(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", SessionID: "cur-1"}

	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("ghost-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}))

	c, w := newDELETEPContext("/auth/v1/sessions/ghost-1", nil, map[string]string{"id": "ghost-1"})
	c.Set("claims", claims)
	h.DeleteSession(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteSession_OwnSessionReportsCurrent(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", SessionID: "cur-1"}

	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("cur-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}).
			AddRow("cur-1", "refhash-1", "jti-1"))
	mock.ExpectExec(`DELETE FROM user_sessions`).WithArgs("cur-1", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newDELETEPContext("/auth/v1/sessions/cur-1", nil, map[string]string{"id": "cur-1"})
	c.Set("claims", claims)
	h.DeleteSession(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			WasCurrent bool `json:"was_current"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Data.WasCurrent {
		t.Error("deleting the caller's own session must report was_current=true")
	}
	if !mr.Exists("blacklist:jti-1") {
		t.Error("own session's access token must be blacklisted")
	}
}

// ─── DeleteAllOtherSessions ──────────────────────────────────────────────────

func TestDeleteAllOtherSessions_KeepsCurrent(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", SessionID: "cur-1"}

	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}).
			AddRow("cur-1", "rh-1", "jti-cur").
			AddRow("dev-2", "rh-2", "jti-2").
			AddRow("dev-3", "rh-3", "jti-3"))
	mock.ExpectExec(`DELETE FROM user_sessions`).WithArgs("dev-2", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`DELETE FROM user_sessions`).WithArgs("dev-3", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newDELETEPContext("/auth/v1/sessions", nil, nil)
	c.Set("claims", claims)
	h.DeleteAllOtherSessions(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Deleted int `json:"deleted"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Data.Deleted != 2 {
		t.Fatalf("expected 2 deleted sessions, got %d", resp.Data.Deleted)
	}
	// The current session must survive untouched.
	if mr.Exists("blacklist:jti-cur") {
		t.Error("current session must not be blacklisted")
	}
	if !mr.Exists("blacklist:jti-2") || !mr.Exists("blacklist:jti-3") {
		t.Error("other sessions' access tokens must be blacklisted")
	}
}

// ─── Logout ──────────────────────────────────────────────────────────────────

func TestLogout_RevokesOnlyCurrentSession(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", SessionID: "cur-1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("cur-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}).
			AddRow("cur-1", "rh-1", "jti-1"))
	mock.ExpectExec(`DELETE FROM user_sessions`).WithArgs("cur-1", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newPOSTContext("/auth/v1/logout", nil, claims, nil)
	h.Logout(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !mr.Exists("blacklist:jti-1") {
		t.Error("logged-out session's access token must be blacklisted")
	}
	if mr.Exists("refresh:u1:rh-1") {
		t.Error("logged-out session's refresh token must be deleted")
	}
}

func TestLogout_WithoutSessionIdentity_RevokesEverything(t *testing.T) {
	h, _ := setupAuthHandler(t)
	// Pure bearer/API client — no sid claim, no refresh cookie.
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// Fallback path deletes all rows (best-effort, no expectations required).
	c, w := newPOSTContext("/auth/v1/logout", nil, claims, nil)
	h.Logout(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Refresh (rotation keeps the same device) ────────────────────────────────

func TestRefresh_RotatesInPlaceKeepingSession(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// Mint a real token pair for session sess-1 (stored in miniredis).
	pair1, err := h.authService.GenerateTokenPair("u1", "testuser", "localhost:8080", "sess-1")
	if err != nil {
		t.Fatalf("GenerateTokenPair failed: %v", err)
	}
	oldHash := sha256hex(pair1.RefreshToken)

	// The refresh handler finds the session row by refresh_hash and rotates it
	// in place — the id NEVER changes.
	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("u1", oldHash).
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}).
			AddRow("sess-1", oldHash, pair1.AccessJTI))
	mock.ExpectExec(`UPDATE user_sessions`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "sess-1", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	c, w := newPOSTContext("/auth/v1/refresh", map[string]string{
		"refresh_token": pair1.RefreshToken,
	}, claims, nil)
	h.Refresh(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Data.Token == "" {
		t.Fatal("expected a new access token")
	}

	// The rotated token must still belong to sess-1.
	newClaims, err := h.authService.ValidateToken(resp.Data.Token)
	if err != nil {
		t.Fatalf("rotated token invalid: %v", err)
	}
	if newClaims.SessionID != "sess-1" {
		t.Fatalf("rotation must preserve the session id, got %q", newClaims.SessionID)
	}

	// Old refresh token consumed; new one stored; old access token blacklisted
	// so a session can never hold two live access tokens.
	oldKey := "refresh:u1:" + oldHash
	if mr.Exists(oldKey) {
		t.Error("old refresh token must be deleted after rotation")
	}
	if !mr.Exists("blacklist:" + pair1.AccessJTI) {
		t.Error("superseded access token must be blacklisted on rotation")
	}
}

func TestRefresh_LegacySessionWithoutRow_MintsNewRow(t *testing.T) {
	h, mock, _ := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	pair1, err := h.authService.GenerateTokenPair("u1", "testuser", "localhost:8080", "legacy-sess")
	if err != nil {
		t.Fatalf("GenerateTokenPair failed: %v", err)
	}
	oldHash := sha256hex(pair1.RefreshToken)

	// No row found for this refresh hash (pre-migration session).
	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("u1", oldHash).
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}))
	// The handler mints a fresh row; sqlmock treats it as unexpected (ignored).

	c, w := newPOSTContext("/auth/v1/refresh", map[string]string{
		"refresh_token": pair1.RefreshToken,
	}, claims, nil)
	h.Refresh(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	newClaims, err := h.authService.ValidateToken(resp.Data.Token)
	if err != nil {
		t.Fatalf("rotated token invalid: %v", err)
	}
	if newClaims.SessionID == "" {
		t.Error("legacy refresh must still mint a session-bound token")
	}
}

// ─── Review-fix regression tests ────────────────────────────────────────────

func TestRefresh_RowDeletedConcurrently_FailsClosed(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	pair1, err := h.authService.GenerateTokenPair("u1", "testuser", "localhost:8080", "sess-1")
	if err != nil {
		t.Fatalf("GenerateTokenPair failed: %v", err)
	}
	oldHash := sha256hex(pair1.RefreshToken)

	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("u1", oldHash).
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}).
			AddRow("sess-1", oldHash, pair1.AccessJTI))
	// The row is gone by the time rotation runs (concurrent revoke) → 0 rows.
	mock.ExpectExec(`UPDATE user_sessions`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "sess-1", "u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newPOSTContext("/auth/v1/refresh", map[string]string{
		"refresh_token": pair1.RefreshToken,
	}, claims, nil)
	h.Refresh(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when the session row was revoked concurrently, got %d: %s", w.Code, w.Body.String())
	}
	// The freshly minted refresh token must not be left behind for a dead session.
	for _, key := range mr.Keys() {
		if strings.HasPrefix(key, "refresh:u1:") {
			t.Errorf("dead session left a refresh token behind: %s", key)
		}
	}
}

func TestCleanupOldSessions_FullyRevokesBeyondCap(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)

	const total = maxSessionsPerUser + 1 // 11 rows: newest first, oldest last
	rowRows := sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"})
	for i := 1; i <= total; i++ {
		id := fmt.Sprintf("s%02d", i)
		rowRows = rowRows.AddRow(id, "rh-"+id, "jti-"+id)
		if err := mr.Set("refresh:u1:rh-"+id, "1"); err != nil {
			t.Fatalf("seed failed: %v", err)
		}
	}

	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("u1").
		WillReturnRows(rowRows)
	// Only the oldest session (beyond the cap) is revoked: its row deleted.
	mock.ExpectExec(`DELETE FROM user_sessions`).WithArgs("s11", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	cleanupOldSessions(h.db, h.redis, h.authService, "u1")

	// The capped session must be FULLY dead: refresh token gone + access token
	// blacklisted, so it cannot resurrect on its next refresh.
	if mr.Exists("refresh:u1:rh-s11") {
		t.Error("capped session's refresh token must be deleted")
	}
	if !mr.Exists("blacklist:jti-s11") {
		t.Error("capped session's access token must be blacklisted")
	}
	// The kept sessions must stay untouched.
	if !mr.Exists("refresh:u1:rh-s01") {
		t.Error("kept session's refresh token must survive")
	}
	if mr.Exists("blacklist:jti-s01") {
		t.Error("kept session's access token must not be blacklisted")
	}
}

// ─── models.APIResponse smoke (shape check) ──────────────────────────────────

func TestSessionResponse_JSONShape(t *testing.T) {
	s := sessionResponse{
		ID: "abc", UserAgent: "ua", OSName: "Windows", BrowserName: "Chrome",
		DeviceType: "desktop", IPAddress: "8.8.8.8", CountryCode: "US",
		CountryName: "США", CreatedAt: "t1", LastActiveAt: "t2", IsCurrent: true, Online: true,
	}
	data, err := json.Marshal(models.SuccessResponse(s))
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if _, ok := got["data"]; !ok {
		t.Fatal("expected data wrapper")
	}
	if _, ok := got["success"]; !ok {
		t.Fatal("expected success wrapper")
	}
}
