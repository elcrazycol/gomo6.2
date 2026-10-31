package rpc

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/testutil"
)

// ─── GetGomoSubsDirectory ────────────────────────────────────────────────────

func TestGetGomoSubsDirectory_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	mock.ExpectQuery(`(?s)SELECT b\.id.*FROM boards b WHERE b\.is_gomosub = true.*`).
		WithArgs(nil, 200).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "name", "description", "cover_image_url",
			"gomosub_avatar_url", "gomosub_tags", "visibility", "created_at",
			"member_count", "channel_count", "joined",
		}).AddRow(
			"550e8400-e29b-41d4-a716-446655440000", "games", "Игры", "Про игры", nil,
			nil, `["anime"]`, "public", "2026-01-01T00:00:00Z",
			12, 3, false,
		))

	c, w := testutil.NewRPCGETContext(map[string]string{})
	h.GetGomoSubsDirectory(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool                   `json:"success"`
		Data    []GomoSubDirectoryItem `json:"data"`
		Error   *string                `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 sub, got %d", len(resp.Data))
	}
	sub := resp.Data[0]
	if sub.MemberCount != 12 || sub.ChannelCount != 3 {
		t.Errorf("expected counts 12/3, got %d/%d", sub.MemberCount, sub.ChannelCount)
	}
	if sub.Joined {
		t.Error("anonymous viewer must not be marked joined")
	}
	if len(sub.Tags) != 1 || sub.Tags[0] != "anime" {
		t.Errorf("expected tags [anime], got %v", sub.Tags)
	}
}

func TestGetGomoSubsDirectory_PrivateVisibleToMember(t *testing.T) {
	h, mock := setupRPCHandler(t)

	viewer := "770e8400-e29b-41d4-a716-446655443333"
	mock.ExpectQuery(`(?s)SELECT b\.id.*FROM boards b WHERE b\.is_gomosub = true.*`).
		WithArgs(viewer, 200).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "name", "description", "cover_image_url",
			"gomosub_avatar_url", "gomosub_tags", "visibility", "created_at",
			"member_count", "channel_count", "joined",
		}).AddRow(
			"550e8400-e29b-41d4-a716-446655440000", "secret", "Секретный", "Только для своих", nil,
			nil, `[]`, "private", "2026-01-01T00:00:00Z",
			5, 2, true,
		))

	c, w := testutil.NewRPCGETContext(map[string]string{})
	c.Set("claims", &auth.Claims{UserID: viewer})
	h.GetGomoSubsDirectory(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []GomoSubDirectoryItem `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 1 || resp.Data[0].Visibility != "private" || !resp.Data[0].Joined {
		t.Fatalf("member must see their private sub as joined, got %+v", resp.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled: %v", err)
	}
}

func TestGetGomoSubsDirectory_DBError(t *testing.T) {
	h, mock := setupRPCHandler(t)

	mock.ExpectQuery(`(?s)SELECT b\.id.*FROM boards b.*`).
		WithArgs(nil, 200).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := testutil.NewRPCGETContext(map[string]string{})
	h.GetGomoSubsDirectory(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
	if w.Code == http.StatusOK {
		var resp models.APIResponse
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
	}
}
