package moderation

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const cardUserID = "880e8400-e29b-41d4-a716-446655440000"

const staffRe = `SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role IN \('moderator', 'admin'\)\)`

// ──────────────────────────── Sanctions ────────────────────────────

func TestApplySanction_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true) // caller is a moderator

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs(cardUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(staffRe).WithArgs(cardUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO user_sanctions`).
		WithArgs(cardUserID, "mute", "флуд", "", "u1", nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "kind", "reason", "reason_code", "created_at", "expires_at"}).
			AddRow("s-1", "mute", "флуд", nil, time.Now(), nil))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "sanction_mute", TargetUser, cardUserID, nil, nil, "флуд").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/users/"+cardUserID+"/sanctions",
		map[string]interface{}{"kind": "mute", "reason": "флуд"}, claimsFor("u1"),
		map[string]string{"id": cardUserID})
	h.ApplySanction(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Data SanctionItem `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if resp.Data.Kind != "mute" || !resp.Data.Active {
		t.Fatalf("unexpected sanction payload: %+v", resp.Data)
	}
}

func TestApplySanction_RefusesStaff(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs(cardUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(staffRe).WithArgs(cardUserID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/moderation/users/"+cardUserID+"/sanctions",
		map[string]interface{}{"kind": "ban", "reason": "просто так"}, claimsFor("u1"),
		map[string]string{"id": cardUserID})
	h.ApplySanction(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for sanctioning staff, got %d", w.Code)
	}
}

func TestApplySanction_RejectsUnknownKind(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	c, w := newPOSTContext("/api/v1/moderation/users/"+cardUserID+"/sanctions",
		map[string]interface{}{"kind": "exile", "reason": "навсегда"}, claimsFor("u1"),
		map[string]string{"id": cardUserID})
	h.ApplySanction(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestRevokeSanction_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	const sanctionID = "990e8400-e29b-41d4-a716-446655440000"
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE user_sanctions\s*SET revoked_at = NOW\(\), revoked_by = \$1`).
		WithArgs("u1", sanctionID, cardUserID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "unsanction", TargetUser, cardUserID, nil, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/users/"+cardUserID+"/sanctions/"+sanctionID, nil, claimsFor("u1"),
		map[string]string{"id": cardUserID, "sanctionId": sanctionID})
	// DELETE semantics, but the handler only reads params + claims.
	c.Request.Method = http.MethodDelete
	h.RevokeSanction(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
}

// ──────────────────────────── Notes ────────────────────────────

func TestAddUserNote_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerator(mock, true)

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO user_mod_notes`).
		WithArgs(cardUserID, "u1", "подозрительный паттерн").
		WillReturnRows(sqlmock.NewRows([]string{"id", "body", "created_at"}).
			AddRow("n-1", "подозрительный паттерн", time.Now()))
	mock.ExpectExec(`INSERT INTO moderation_actions`).
		WithArgs("u1", "note", TargetUser, cardUserID, nil, nil, "подозрительный паттерн").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	c, w := newPOSTContext("/api/v1/moderation/users/"+cardUserID+"/notes",
		map[string]string{"body": "подозрительный паттерн"}, claimsFor("u1"),
		map[string]string{"id": cardUserID})
	h.AddUserNote(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body: %s)", w.Code, w.Body.String())
	}
}

// ──────────────────────────── Activity ────────────────────────────

func TestGetUserActivity_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, true)

	mock.ExpectQuery(`(?s)FROM user_activity_events\s*WHERE user_id = \$1.*ORDER BY id DESC`).
		WithArgs(cardUserID, 50).
		WillReturnRows(sqlmock.NewRows([]string{"id", "event_type", "target_type", "target_id", "created_at"}).
			AddRow(42, "like_given", "post", targetUUID, time.Now()).
			AddRow(41, "daily_visit", "", "", time.Now()))
	// previews for the targeted entry
	mock.ExpectQuery(`SELECT p\.id::text, '', COALESCE\(p\.content, ''\).*FROM posts p`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "body", "author", "author_id", "created_at", "ctx1", "ctx2"}).
			AddRow(targetUUID, "", "текст поста", "bob", "bob-1", time.Now(), threadUUID, nil))

	c, w := newGETContext("/api/v1/moderation/users/"+cardUserID+"/activity", claimsFor("u1"))
	c.Params = []gin.Param{{Key: "id", Value: cardUserID}}
	h.GetUserActivity(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Items      []ActivityItem `json:"items"`
			NextCursor string         `json:"next_cursor"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(resp.Data.Items) != 2 {
		t.Fatalf("expected 2 activity items, got %d", len(resp.Data.Items))
	}
	if resp.Data.Items[0].Link != "/thread/"+threadUUID {
		t.Fatalf("expected the post's thread link, got %q", resp.Data.Items[0].Link)
	}
	// A page smaller than the limit has no next cursor.
	if resp.Data.NextCursor != "" {
		t.Fatalf("expected no cursor, got %q", resp.Data.NextCursor)
	}
}

// ──────────────────────────── Card ────────────────────────────

func cardUserRow() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "username", "display_name", "avatar_url", "created_at", "is_online", "is_anonymous",
		"garma", "posts", "threads", "wall_posts", "comments", "likes_received",
	}).AddRow(cardUserID, "spammer", "Спамер", nil, time.Now(), false, false, 0, 5, 1, 2, 3, 0)
}

func TestGetUserCard_Success(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, true)

	mock.ExpectQuery(`SELECT id::text, username, COALESCE\(display_name, ''\)`).
		WithArgs(cardUserID).WillReturnRows(cardUserRow())
	mock.ExpectQuery(`SELECT role FROM user_roles WHERE user_id = \$1 ORDER BY role`).
		WithArgs(cardUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("user"))
	mock.ExpectQuery(`FROM user_sanctions s`).
		WithArgs(cardUserID).WillReturnRows(sqlmock.NewRows([]string{
		"id", "kind", "reason", "reason_code", "created_at", "expires_at", "revoked_at",
		"issuer", "revoker", "active",
	}))
	mock.ExpectQuery(`FROM user_mod_notes n`).
		WithArgs(cardUserID).WillReturnRows(sqlmock.NewRows([]string{"id", "body", "created_at", "author"}))
	mock.ExpectQuery(`(?s)FROM content_reports r WHERE \(`).
		WithArgs(cardUserID).
		WillReturnRows(sqlmock.NewRows([]string{"open", "total"}).AddRow(2, 3))
	mock.ExpectQuery(`(?s)FROM content_reports r.*target_type = 'user'.*LIMIT \$2`).
		WithArgs(cardUserID, 10).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_type", "target_id", "reporter_id", "category", "reason", "status",
			"created_at", "reason_code", "resolution_note", "username", "display_name", "avatar_url", "source",
		}))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FILTER \(WHERE status = 'open'\)::int, COUNT\(\*\)::int\s*FROM content_reports WHERE reporter_id`).
		WithArgs(cardUserID).
		WillReturnRows(sqlmock.NewRows([]string{"open", "total"}).AddRow(0, 0))
	mock.ExpectQuery(`(?s)FROM content_reports r.*WHERE r\.reporter_id = \$1.*LIMIT \$2`).
		WithArgs(cardUserID, 10).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "target_type", "target_id", "reporter_id", "category", "reason", "status",
			"created_at", "reason_code", "resolution_note", "username", "display_name", "avatar_url", "source",
		}))

	c, w := newGETContext("/api/v1/moderation/users/"+cardUserID, claimsFor("u1"))
	c.Params = []gin.Param{{Key: "id", Value: cardUserID}}
	h.GetUserCard(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Data userCardResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if resp.Data.User.Username != "spammer" || resp.Data.User.IsStaff {
		t.Fatalf("unexpected card user: %+v", resp.Data.User)
	}
	if resp.Data.ReportsAgainst.Open != 2 || resp.Data.ReportsAgainst.Total != 3 {
		t.Fatalf("unexpected reports-against summary: %+v", resp.Data.ReportsAgainst)
	}
}

func TestGetUserCard_NotFound(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, true)

	mock.ExpectQuery(`SELECT id::text, username, COALESCE\(display_name, ''\)`).
		WithArgs(cardUserID).WillReturnError(sql.ErrNoRows)

	c, w := newGETContext("/api/v1/moderation/users/"+cardUserID, claimsFor("u1"))
	c.Params = []gin.Param{{Key: "id", Value: cardUserID}}
	h.GetUserCard(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetUserCard_RejectsNonModerator(t *testing.T) {
	h, mock := setupHandler(t)
	expectModerationRead(mock, false)

	c, w := newGETContext("/api/v1/moderation/users/"+cardUserID, claimsFor("u1"))
	c.Params = []gin.Param{{Key: "id", Value: cardUserID}}
	h.GetUserCard(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// Every moderation mutation must purge cached moderation responses: otherwise a
// moderator still sees the pre-action card ("Санкций не было") for the TTL.
func TestInvalidateModerationCache(t *testing.T) {
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })

	h := NewHandler(nil, client, nil)
	mr.Set("data:/api/v1/moderation/reports?status=open", "{}")
	mr.Set("data:/api/v1/moderation/users/u1", "{}")
	mr.Set("data:/api/v1/profiles?id=eq.u1", "{}") // unrelated — must survive

	h.invalidateModerationCache()

	for _, key := range []string{
		"data:/api/v1/moderation/reports?status=open",
		"data:/api/v1/moderation/users/u1",
	} {
		if mr.Exists(key) {
			t.Fatalf("moderation key %q must be invalidated", key)
		}
	}
	if !mr.Exists("data:/api/v1/profiles?id=eq.u1") {
		t.Fatal("unrelated cache keys must survive")
	}
}
