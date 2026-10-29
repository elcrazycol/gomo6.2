package rpc

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

// ─── GetGomoSubChannelActivity ──────────────────────────────────────────────

func TestGetGomoSubChannelActivity_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	viewer := "770e8400-e29b-41d4-a716-446655443333"
	boardID := "550e8400-e29b-41d4-a716-446655440000"
	channelID := "660e8400-e29b-41d4-a716-446655441111"
	// Two channels come from the board; only the one the viewer can read must
	// survive into the response.
	mock.ExpectQuery(`(?s)SELECT ch\.id,.*FROM channels ch WHERE ch\.board_id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "last_activity_at"}).
			AddRow(channelID, time.Now()).
			AddRow("660e8400-e29b-41d4-a716-446655442222", time.Now()))
	// channelaccess.CanReadChannel per channel (v2 multi-query chain):
	// scope → bans → membership → role maps → (overwrites for private).
	// First channel: public channel of a public board → readable by anyone.
	// Second: private channel, viewer is not a member and holds no overwrite.
	ownerID := "880e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT ch\.board_id.*FROM channels ch JOIN boards b`).
		WithArgs(channelID).
		WillReturnRows(sqlmock.NewRows([]string{"board_id", "is_private", "owner_id", "visibility"}).
			AddRow(boardID, false, ownerID, "public"))
	mock.ExpectQuery(`FROM gomosub_bans`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`timed_out_until FROM gomosub_memberships`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"timed_out_until"}))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"permissions", "is_everyone"}))
	mock.ExpectQuery(`SELECT ch\.board_id.*FROM channels ch JOIN boards b`).
		WithArgs("660e8400-e29b-41d4-a716-446655442222").
		WillReturnRows(sqlmock.NewRows([]string{"board_id", "is_private", "owner_id", "visibility"}).
			AddRow(boardID, true, ownerID, "public"))
	mock.ExpectQuery(`FROM gomosub_bans`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`timed_out_until FROM gomosub_memberships`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"timed_out_until"}))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"permissions", "is_everyone"}))
	mock.ExpectQuery(`(?s)FROM channel_permissions cp.*`).
		WithArgs("660e8400-e29b-41d4-a716-446655442222", boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"allow", "deny", "can_read", "can_write", "is_everyone"}))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": boardID})
	c.Set("claims", &auth.Claims{UserID: viewer})
	h.GetGomoSubChannelActivity(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []ChannelActivityItem `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 readable channel, got %+v", resp.Data)
	}
	if len(resp.Data) > 0 && resp.Data[0].ChannelID != channelID {
		t.Fatalf("expected readable channel %s, got %s", channelID, resp.Data[0].ChannelID)
	}
}

func TestGetGomoSubChannelActivity_MissingParam(t *testing.T) {
	h, _ := setupRPCHandler(t)

	c, w := testutil.NewRPCGETContext(map[string]string{})
	c.Set("claims", &auth.Claims{UserID: "viewer"})
	h.GetGomoSubChannelActivity(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetGomoSubChannelActivity_InvalidUUID(t *testing.T) {
	h, _ := setupRPCHandler(t)

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": "not-a-uuid"})
	c.Set("claims", &auth.Claims{UserID: "viewer"})
	h.GetGomoSubChannelActivity(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetGomoSubChannelActivity_DBError(t *testing.T) {
	h, mock := setupRPCHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`(?s)SELECT ch\.id,.*FROM channels ch WHERE ch\.board_id = \$1`).
		WithArgs(boardID).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": boardID})
	c.Set("claims", &auth.Claims{UserID: "viewer"})
	h.GetGomoSubChannelActivity(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
