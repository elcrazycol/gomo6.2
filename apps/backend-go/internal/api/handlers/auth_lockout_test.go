package handlers

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// ─── recordFailedAttempt ─────────────────────────────────────────────────────

func TestRecordFailedAttempt_SetsLockoutKey(t *testing.T) {
	h, _, mr := setupAuthHandlerWithRedis(t)

	h.recordFailedAttempt("victim@example.com")

	if !mr.Exists("lockout:victim@example.com") {
		t.Fatal("failed-attempt counter must be written to Redis")
	}
	if got, _ := mr.Get("lockout:victim@example.com"); got != "1" {
		t.Errorf("expected counter 1, got %q", got)
	}
	// 15-minute TTL must be set.
	ttl := mr.TTL("lockout:victim@example.com")
	if ttl <= 0 || ttl > 15*time.Minute {
		t.Errorf("unexpected TTL: %v", ttl)
	}
}

func TestRecordFailedAttempt_NilRedis_Noop(t *testing.T) {
	h, _ := setupAuthHandler(t)
	// Must not panic and must not error when Redis is disabled.
	h.recordFailedAttempt("x@y.z")
}

// ─── isAuthActionLocked / recordAuthActionFailure / clearAuthActionLock ──────

func TestIsAuthActionLocked_Threshold(t *testing.T) {
	h, _, mr := setupAuthHandlerWithRedis(t)

	if h.isAuthActionLocked("user-1") {
		t.Error("no key must not be locked")
	}
	if err := mr.Set("auth_action_lock:user-1", "4"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if h.isAuthActionLocked("user-1") {
		t.Error("4 attempts (< 5) must not be locked")
	}
	if err := mr.Set("auth_action_lock:user-1", "5"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if !h.isAuthActionLocked("user-1") {
		t.Error("5 attempts must be locked")
	}
}

func TestIsAuthActionLocked_NilRedis_NotLocked(t *testing.T) {
	h, _ := setupAuthHandler(t)
	if h.isAuthActionLocked("user-1") {
		t.Error("without Redis nothing can be locked")
	}
}

func TestRecordAuthActionFailure_Increments(t *testing.T) {
	h, _, mr := setupAuthHandlerWithRedis(t)

	h.recordAuthActionFailure("user-1")
	h.recordAuthActionFailure("user-1")

	if got, _ := mr.Get("auth_action_lock:user-1"); got != "2" {
		t.Errorf("expected counter 2, got %q", got)
	}
}

func TestClearAuthActionLock_Removes(t *testing.T) {
	h, _, mr := setupAuthHandlerWithRedis(t)
	if err := mr.Set("auth_action_lock:user-1", "3"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	h.clearAuthActionLock("user-1")

	if mr.Exists("auth_action_lock:user-1") {
		t.Error("counter must be deleted after successful verification")
	}
}

// ─── Login: account lockout ──────────────────────────────────────────────────

const lockoutUserColumns = "id, username, display_name, email, domain, password_hash, totp_enabled, totp_secret, trusted_devices, created_at"

func TestLogin_AccountLockout_BlocksAfterFiveAttempts(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	if err := mr.Set("lockout:victim@example.com", "5"); err != nil {
		t.Fatalf("seed lockout: %v", err)
	}

	// Lockout applies to real accounts only — the user must exist.
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("victim@example.com").
		WillReturnRows(sqlmock.NewRows(strings.Split(lockoutUserColumns, ", ")).
			AddRow("u1", "victim", "Victim", "victim@example.com", "localhost:8080", "hash", false, nil, nil, time.Now()))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "victim@example.com",
		"password": "correct-password",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for locked account, got %d: %s", w.Code, w.Body.String())
	}
	// The response is indistinguishable from a wrong password — no 429, no
	// "locked" wording that would reveal the identifier is real.
	if strings.Contains(w.Body.String(), "429") || strings.Contains(strings.ToLower(w.Body.String()), "lock") {
		t.Errorf("lockout must not be distinguishable from invalid credentials: %s", w.Body.String())
	}
}

func TestLogin_UnderLockoutThreshold_Proceeds(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)
	if err := mr.Set("lockout:victim@example.com", "4"); err != nil {
		t.Fatalf("seed lockout: %v", err)
	}

	realHash, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("victim@example.com").
		WillReturnRows(sqlmock.NewRows(strings.Split(lockoutUserColumns, ", ")).
			AddRow("u1", "victim", "Victim", "victim@example.com", "localhost:8080", string(realHash), false, nil, nil, time.Now()))
	mock.ExpectExec(`INSERT INTO user_sessions`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT id, refresh_hash, access_jti FROM user_sessions`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "refresh_hash", "access_jti"}))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "victim@example.com",
		"password": "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 below threshold, got %d: %s", w.Code, w.Body.String())
	}
	// Successful password verification resets the counter.
	if mr.Exists("lockout:victim@example.com") {
		t.Error("lockout counter must be cleared after a successful login")
	}
}

func TestLogin_WrongPassword_RecordsFailedAttempt(t *testing.T) {
	h, mock, mr := setupAuthHandlerWithRedis(t)

	realHash, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("victim@example.com").
		WillReturnRows(sqlmock.NewRows(strings.Split(lockoutUserColumns, ", ")).
			AddRow("u1", "victim", "Victim", "victim@example.com", "localhost:8080", string(realHash), false, nil, nil, time.Now()))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "victim@example.com",
		"password": "wrong-password",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
	got, err := mr.Get("lockout:victim@example.com")
	if err != nil || got != "1" {
		t.Errorf("wrong password must increment the lockout counter, got %q (err=%v)", got, err)
	}
}

// ─── Honeypot ────────────────────────────────────────────────────────────────

func TestRegister_Honeypot_SilentSuccess(t *testing.T) {
	h, mock := setupAuthHandler(t)
	_ = mock // no DB call may happen for a honeypot hit

	email := "bot@example.com"
	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "botuser",
		Email:    &email,
		Password: "vE7xKp2mNq9rLw5t",
		Website:  "http://spam.example.com",
	}, nil, nil)
	h.Register(c)

	// Bot must believe registration succeeded — no error, no account created.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (misleading success), got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("honeypot hit must not surface an error: %s", *resp.Error)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("no DB expectations may be consumed by a honeypot hit: %v", err)
	}
}

func TestLogin_Honeypot_InvalidCredentials(t *testing.T) {
	h, mock := setupAuthHandler(t)
	_ = mock

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "bot@example.com",
		"password": "whatever",
		"website":  "http://spam.example.com",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (generic invalid credentials), got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Invalid credentials") {
		t.Errorf("expected generic error, got: %s", w.Body.String())
	}
}

// ─── isPwned ─────────────────────────────────────────────────────────────────

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// stubPwnedHTTP replaces http.DefaultClient with one whose transport returns
// the given status/body, restoring it when the test finishes.
func stubPwnedHTTP(t *testing.T, status int, body string, err error) {
	t.Helper()
	old := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if err != nil {
			return nil, err
		}
		return &http.Response{
			StatusCode: status,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	})}
	t.Cleanup(func() { http.DefaultClient = old })
}

// sha1SuffixHex returns the "XXXXX:count" line HIBP would return for a breached
// password, derived from the password itself so the test never hardcodes hashes.
func sha1SuffixHex(password string) string {
	hash := sha1.Sum([]byte(password))
	hashHex := strings.ToUpper(hex.EncodeToString(hash[:]))
	return hashHex[5:]
}

func TestIsPwned_FoundInBreach(t *testing.T) {
	stubPwnedHTTP(t, http.StatusOK, sha1SuffixHex("password123")+":8\nother:2\n", nil)

	if !isPwned("password123") {
		t.Error("password present in the breach list must be reported pwned")
	}
}

func TestIsPwned_NotFound(t *testing.T) {
	stubPwnedHTTP(t, http.StatusOK, "000000000000000000000000000000000000000:1\n", nil)

	if isPwned("password123") {
		t.Error("password absent from the response must not be reported pwned")
	}
}

func TestIsPwned_ServerError_FailOpen(t *testing.T) {
	stubPwnedHTTP(t, http.StatusInternalServerError, "error page", nil)

	if isPwned("password123") {
		t.Error("non-200 must fail open (not block registration)")
	}
}

func TestIsPwned_NetworkError_FailOpen(t *testing.T) {
	stubPwnedHTTP(t, 0, "", io.ErrUnexpectedEOF)

	if isPwned("password123") {
		t.Error("network errors must fail open (not block registration)")
	}
}

func TestIsPwned_EmptyBody_FailOpen(t *testing.T) {
	stubPwnedHTTP(t, http.StatusOK, "", nil)

	if isPwned("password123") {
		t.Error("empty body must not be treated as pwned")
	}
}
