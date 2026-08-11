package handlers

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

const (
	backupBoardID = "550e8400-e29b-41d4-a716-446655440200"
	backupOwnerID = "550e8400-e29b-41d4-a716-446655440201"
)

func setupBackupHandler(t *testing.T) (*BackupHandler, sqlmock.Sqlmock) {
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
	return NewBackupHandler(db), mock
}

// newBackupExportContext builds a GET context with the board id path param and auth claims.
func newBackupExportContext(boardID string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/boards/"+boardID+"/backup/export", nil)
	c.Request = req
	c.Params = append(c.Params, gin.Param{Key: "id", Value: boardID})
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

// ── Export authorization ─────────────────────────────────────────────────────

func TestBackupExport_Unauthenticated(t *testing.T) {
	handler, _ := setupBackupHandler(t)

	c, w := newBackupExportContext(backupBoardID, nil)
	handler.Export(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestBackupExport_BoardNotFound(t *testing.T) {
	handler, mock := setupBackupHandler(t)
	claims := &auth.Claims{UserID: backupOwnerID}

	mock.ExpectQuery("SELECT owner_id FROM boards WHERE id = \\$1 AND is_gomosub = true").
		WillReturnError(sql.ErrNoRows)

	c, w := newBackupExportContext(backupBoardID, claims)
	handler.Export(c)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestBackupExport_ForbiddenForNonOwner(t *testing.T) {
	handler, mock := setupBackupHandler(t)
	claims := &auth.Claims{UserID: backupOwnerID}
	otherOwner := "550e8400-e29b-41d4-a716-446655440299"

	mock.ExpectQuery("SELECT owner_id FROM boards WHERE id = \\$1 AND is_gomosub = true").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(otherOwner))

	c, w := newBackupExportContext(backupBoardID, claims)
	handler.Export(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestBackupExport_Success(t *testing.T) {
	handler, mock := setupBackupHandler(t)
	claims := &auth.Claims{UserID: backupOwnerID}

	mock.ExpectQuery("SELECT owner_id FROM boards WHERE id = \\$1 AND is_gomosub = true").
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(backupOwnerID))
	mock.ExpectQuery("SELECT slug FROM boards WHERE id = \\$1").
		WillReturnRows(sqlmock.NewRows([]string{"slug"}).AddRow("mysub"))

	// Board row (row_to_json)
	mock.ExpectQuery("SELECT row_to_json\\(b\\) FROM").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}).
			AddRow(`{"id":"board-1","slug":"mysub","name":"My Sub","visibility":"public"}`))

	// All export sections
	mock.ExpectQuery("SELECT row_to_json\\(t\\) FROM \\(SELECT \\* FROM channels").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}).AddRow([]byte(`{"id":"ch-1","slug":"general"}`)))
	mock.ExpectQuery("SELECT row_to_json\\(t\\) FROM \\(SELECT \\* FROM gomosub_roles").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("channel_permissions cp JOIN channels").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("SELECT m\\.user_id, COALESCE\\(u\\.username").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "username", "email", "role", "role_id"}).
			AddRow("u-1", "alice", nil, "member", nil))
	mock.ExpectQuery("FROM \\(SELECT \\* FROM gomosub_invites").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("FROM \\(SELECT \\* FROM gomosub_rules_acceptance").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("FROM \\(SELECT \\* FROM threads").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("FROM \\(SELECT p\\.\\* FROM posts p JOIN threads").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("FROM \\(SELECT tl\\.\\* FROM thread_likes").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("FROM \\(SELECT pl\\.\\* FROM post_likes").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("FROM \\(SELECT \\* FROM polls WHERE thread_id IN").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))
	mock.ExpectQuery("FROM \\(SELECT pv\\.\\* FROM poll_votes").
		WillReturnRows(sqlmock.NewRows([]string{"row_to_json"}))

	c, w := newBackupExportContext(backupBoardID, claims)
	handler.Export(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/gzip" {
		t.Errorf("expected application/gzip content type, got %q", ct)
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, "gomosub-mysub-") {
		t.Errorf("expected attachment filename with slug, got %q", cd)
	}
	if w.Body.Len() == 0 {
		t.Fatal("expected non-empty gzip stream")
	}

	// Decompress and verify the archive actually contains the expected entries.
	gz, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	entryNames := map[string]bool{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar read: %v", err)
		}
		entryNames[hdr.Name] = true
	}
	for _, want := range []string{"backup-manifest.json", "board.json", "channels.json", "memberships.json", "threads.json"} {
		if !entryNames[want] {
			t.Errorf("expected entry %q in export archive, got %v", want, entryNames)
		}
	}
}

// ── writeJSONEntry ───────────────────────────────────────────────────────────

func TestWriteJSONEntry_RoundTrip(t *testing.T) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	err := writeJSONEntry(tw, "test.json", map[string]interface{}{"a": 1, "b": "x"})
	if err != nil {
		t.Fatalf("writeJSONEntry: %v", err)
	}
	tw.Close()

	tr := tar.NewReader(&buf)
	hdr, err := tr.Next()
	if err != nil {
		t.Fatalf("tar read: %v", err)
	}
	if hdr.Name != "test.json" {
		t.Errorf("expected name test.json, got %q", hdr.Name)
	}
	content, err := io.ReadAll(tr)
	if err != nil {
		t.Fatalf("read entry: %v", err)
	}
	var got map[string]interface{}
	if err := json.Unmarshal(content, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["a"].(float64) != 1 || got["b"] != "x" {
		t.Errorf("unexpected content: %s", content)
	}
}

// ── parseTarArchive ──────────────────────────────────────────────────────────

func TestParseTarArchive_JSONAndFiles(t *testing.T) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	if err := writeJSONEntry(tw, "backup-manifest.json", map[string]interface{}{"version": 1}); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if err := writeJSONEntry(tw, "board.json", map[string]interface{}{"slug": "s"}); err != nil {
		t.Fatalf("write board: %v", err)
	}
	fileHdr := &tar.Header{Name: "files/avatars/abc.png", Mode: 0644, Size: 5}
	if err := tw.WriteHeader(fileHdr); err != nil {
		t.Fatalf("write file header: %v", err)
	}
	if _, err := tw.Write([]byte("12345")); err != nil {
		t.Fatalf("write file: %v", err)
	}
	tw.Close()

	data, files, err := parseTarArchive(tar.NewReader(&buf))
	if err != nil {
		t.Fatalf("parseTarArchive: %v", err)
	}
	if _, ok := data["backup-manifest.json"].(map[string]interface{}); !ok {
		t.Error("expected backup-manifest.json in archive data")
	}
	if _, ok := data["board.json"].(map[string]interface{}); !ok {
		t.Error("expected board.json in archive data")
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file entry, got %d", len(files))
	}
	if files[0].bucket != "avatars" || files[0].key != "abc.png" || files[0].size != 5 {
		t.Errorf("unexpected file entry: %+v", files[0])
	}
}

func TestParseTarArchive_ReadError(t *testing.T) {
	_, _, err := parseTarArchive(tar.NewReader(strings.NewReader("garbage")))
	if err == nil {
		t.Fatal("expected error for broken tar stream")
	}
}

// ── ensureGhostUserTx ────────────────────────────────────────────────────────

func TestEnsureGhostUserTx_Existing(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	mock.ExpectQuery("SELECT id FROM users WHERE username = '_ghost'").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("ghost-1"))

	id, err := ensureGhostUserTx(tx)
	if err != nil {
		t.Fatalf("ensureGhostUserTx: %v", err)
	}
	if id != "ghost-1" {
		t.Errorf("expected ghost-1, got %q", id)
	}
}

func TestEnsureGhostUserTx_CreatesWhenMissing(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	mock.ExpectQuery("SELECT id FROM users WHERE username = '_ghost'").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("INSERT INTO users \\(id, username, email").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT id FROM users WHERE username = '_ghost'").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("ghost-new"))

	id, err := ensureGhostUserTx(tx)
	if err != nil {
		t.Fatalf("ensureGhostUserTx: %v", err)
	}
	if id != "ghost-new" {
		t.Errorf("expected ghost-new, got %q", id)
	}
}

func TestEnsureGhostUserTx_QueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	mock.ExpectQuery("SELECT id FROM users WHERE username = '_ghost'").
		WillReturnError(errors.New("db down"))

	if _, err := ensureGhostUserTx(tx); err == nil {
		t.Fatal("expected error from ensureGhostUserTx")
	}
}

// ── buildUserMapping ─────────────────────────────────────────────────────────

func membershipArchive(mems []interface{}, ownerID string) map[string]interface{} {
	return map[string]interface{}{
		"memberships.json": mems,
		"board.json":       map[string]interface{}{"owner_id": ownerID},
	}
}

func TestBuildUserMapping_NoMemberships(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()

	mapping := buildUserMapping(tx, map[string]interface{}{}, "importer-1", "ghost-1")
	if len(mapping) != 0 {
		t.Errorf("expected empty mapping, got %v", mapping)
	}
}

func TestBuildUserMapping_ByUsername(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, _ := db.Begin()

	archive := membershipArchive([]interface{}{
		map[string]interface{}{"user_id": "u-1", "username": "alice"},
	}, "other-owner")
	mock.ExpectQuery("SELECT id FROM users WHERE username = \\$1 AND is_anonymous = false").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("local-alice"))

	mapping := buildUserMapping(tx, archive, "importer-1", "ghost-1")
	if mapping["u-1"] != "local-alice" {
		t.Errorf("expected u-1 -> local-alice, got %v", mapping)
	}
}

func TestBuildUserMapping_OwnerMapsToImporter(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, _ := db.Begin()

	archive := membershipArchive([]interface{}{
		map[string]interface{}{"user_id": "u-owner", "username": ""},
	}, "u-owner")

	mapping := buildUserMapping(tx, archive, "importer-1", "ghost-1")
	if mapping["u-owner"] != "importer-1" {
		t.Errorf("expected u-owner -> importer-1, got %v", mapping)
	}
}

func TestBuildUserMapping_UnknownMapsToGhost(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, _ := db.Begin()

	archive := membershipArchive([]interface{}{
		map[string]interface{}{"user_id": "u-x", "username": "nobody"},
	}, "other-owner")
	mock.ExpectQuery("SELECT id FROM users WHERE username = \\$1 AND is_anonymous = false").
		WillReturnError(sql.ErrNoRows)

	mapping := buildUserMapping(tx, archive, "importer-1", "ghost-1")
	if mapping["u-x"] != "ghost-1" {
		t.Errorf("expected u-x -> ghost-1, got %v", mapping)
	}
}

// ── mapUserID ────────────────────────────────────────────────────────────────

func TestMapUserID(t *testing.T) {
	ghost := "ghost-1"
	cases := []struct {
		name    string
		mapping map[string]string
		oldID   *string
		want    string
	}{
		{"nil old ID maps to ghost", map[string]string{"a": "b"}, nil, ghost},
		{"known old ID maps through", map[string]string{"u1": "u1-new"}, strPtr("u1"), "u1-new"},
		{"unknown old ID maps to ghost", map[string]string{"other": "x"}, strPtr("u1"), ghost},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapUserID(tc.mapping, tc.oldID, ghost)
			if got == nil || *got != tc.want {
				t.Errorf("expected %q, got %v", tc.want, got)
			}
		})
	}
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

func TestJSONHelpers(t *testing.T) {
	m := map[string]interface{}{
		"str":  "value",
		"num":  float64(7),
		"int":  7,
		"bool": true,
		"nilv": nil,
		"arr":  []interface{}{"a", "b"},
		"time": "2024-01-02T15:04:05Z",
		"badT": "not-a-time",
		"raw":  map[string]interface{}{"k": "v"},
	}

	if got := jsonStr(m, "str"); got != "value" {
		t.Errorf("jsonStr: got %q", got)
	}
	if got := jsonStr(m, "missing"); got != "" {
		t.Errorf("jsonStr missing: got %q", got)
	}
	if got := jsonStr(m, "num"); got != "" {
		t.Errorf("jsonStr non-string: got %q", got)
	}
	if got := jsonStr(m, "nilv"); got != "" {
		t.Errorf("jsonStr nil: got %q", got)
	}

	if got := jsonStrPtr(m, "str"); got == nil || *got != "value" {
		t.Errorf("jsonStrPtr: got %v", got)
	}
	if got := jsonStrPtr(m, "missing"); got != nil {
		t.Errorf("jsonStrPtr missing: got %v", got)
	}
	if got := jsonStrPtr(m, "nilv"); got != nil {
		t.Errorf("jsonStrPtr nil: got %v", got)
	}

	if got := jsonBool(m, "bool"); !got {
		t.Error("jsonBool: expected true")
	}
	if got := jsonBool(m, "missing"); got {
		t.Error("jsonBool missing: expected false")
	}
	if got := jsonBool(m, "str"); got {
		t.Error("jsonBool non-bool: expected false")
	}

	if got := jsonInt(m, "num"); got != 7 {
		t.Errorf("jsonInt float64: got %d", got)
	}
	if got := jsonInt(m, "int"); got != 7 {
		t.Errorf("jsonInt int: got %d", got)
	}
	if got := jsonInt(m, "missing"); got != 0 {
		t.Errorf("jsonInt missing: got %d", got)
	}

	if got := jsonRaw(m, "raw"); string(got) != `{"k":"v"}` {
		t.Errorf("jsonRaw: got %s", got)
	}
	if got := jsonRaw(m, "missing"); string(got) != "null" {
		t.Errorf("jsonRaw missing: got %s", got)
	}

	if got := jsonTime(m, "time"); got == nil || !got.Equal(time.Date(2024, 1, 2, 15, 4, 5, 0, time.UTC)) {
		t.Errorf("jsonTime: got %v", got)
	}
	if got := jsonTime(m, "badT"); got != nil {
		t.Errorf("jsonTime invalid: got %v", got)
	}
	if got := jsonTime(m, "missing"); got != nil {
		t.Errorf("jsonTime missing: got %v", got)
	}
}

func TestPgJSONScan(t *testing.T) {
	t.Run("nil source sets nil map", func(t *testing.T) {
		var dst map[string]interface{}
		s := pgJSON(&dst)
		if err := s.Scan(nil); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if dst != nil {
			t.Errorf("expected nil map, got %v", dst)
		}
	})

	t.Run("byte slice source", func(t *testing.T) {
		var dst map[string]interface{}
		s := pgJSON(&dst)
		if err := s.Scan([]byte(`{"a":1}`)); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if dst["a"].(float64) != 1 {
			t.Errorf("unexpected map: %v", dst)
		}
	})

	t.Run("string source", func(t *testing.T) {
		var dst map[string]interface{}
		s := pgJSON(&dst)
		if err := s.Scan(`{"a":2}`); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if dst["a"].(float64) != 2 {
			t.Errorf("unexpected map: %v", dst)
		}
	})

	t.Run("unsupported type errors", func(t *testing.T) {
		var dst map[string]interface{}
		s := pgJSON(&dst)
		if err := s.Scan(42); err == nil {
			t.Fatal("expected error for int source")
		}
	})
}

// ── FileRef helpers ──────────────────────────────────────────────────────────

func TestResolveFileRef(t *testing.T) {
	if ref := resolveFileRef("user-1/avatar.png"); ref.Bucket != "avatars" {
		t.Errorf("avatar URL: expected avatars bucket, got %q", ref.Bucket)
	}
	if ref := resolveFileRef("plain.jpg"); ref.Bucket != "content" {
		t.Errorf("plain URL: expected content bucket, got %q", ref.Bucket)
	}
}

func TestExtractFileRefsFromJSON(t *testing.T) {
	if refs := extractFileRefsFromJSON(nil); refs != nil {
		t.Errorf("nil input: expected nil, got %v", refs)
	}
	if refs := extractFileRefsFromJSON([]byte("null")); refs != nil {
		t.Errorf("null input: expected nil, got %v", refs)
	}
	if refs := extractFileRefsFromJSON([]byte("[]")); refs != nil {
		t.Errorf("empty array: expected nil, got %v", refs)
	}
	if refs := extractFileRefsFromJSON([]byte("{")); refs != nil {
		t.Errorf("invalid JSON: expected nil, got %v", refs)
	}

	refs := extractFileRefsFromJSON([]byte(`["plain.jpg","u/avatar.png",""]`))
	if len(refs) != 2 {
		t.Fatalf("expected 2 refs, got %v", refs)
	}
	if refs[0].Bucket != "content" || refs[1].Bucket != "avatars" {
		t.Errorf("unexpected buckets: %+v", refs)
	}
}

func TestExtractAttachmentsAsFileRefs(t *testing.T) {
	if refs := extractAttachmentsAsFileRefs(nil); refs != nil {
		t.Errorf("nil input: expected nil, got %v", refs)
	}
	if refs := extractAttachmentsAsFileRefs([]byte("[]")); refs != nil {
		t.Errorf("empty array: expected nil, got %v", refs)
	}
	if refs := extractAttachmentsAsFileRefs([]byte("nope")); refs != nil {
		t.Errorf("invalid JSON: expected nil, got %v", refs)
	}

	refs := extractAttachmentsAsFileRefs([]byte(`[{"url":"doc.pdf","type":"pdf"},{"url":"","type":"image"}]`))
	if len(refs) != 1 {
		t.Fatalf("expected 1 ref, got %v", refs)
	}
	if refs[0].Key != "doc.pdf" {
		t.Errorf("unexpected ref: %+v", refs[0])
	}
}
