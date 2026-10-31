package stories

import (
	"encoding/json"
	"net/http"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

const (
	viewerID = "20000000-0000-0000-0000-0000000000bb"
	peerID   = "30000000-0000-0000-0000-0000000000cc"
	boardID  = "40000000-0000-0000-0000-0000000000dd"
	storyID  = "50000000-0000-0000-0000-0000000000ee"
	otherID  = "60000000-0000-0000-0000-0000000000ff"
)

func testClaims(userID string) *auth.Claims {
	return &auth.Claims{UserID: userID, Username: "tester"}
}

func newHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled expectations: %v", err)
		}
		_ = db.Close()
	})
	return NewHandler(db, nil), mock
}

// ─── Story row fixtures ─────────────────────────────────────────────────────

var storyColumnNames = []string{
	"id", "owner_type", "owner_id", "author_id",
	"username", "display_name", "avatar_url", "avatar_animated",
	"kind", "media_key", "preview_key", "thumb_hash", "media_width", "media_height",
	"media_duration", "media_content_type", "text", "text_style", "privacy", "is_pinned",
	"views_count", "created_at", "expires_at", "is_viewed", "my_reaction", "reactions_count",
}

type fixture struct {
	id        string
	ownerType string
	ownerID   string
	authorID  string
	username  string
	kind      string
	text      string
	privacy   string
	pinned    bool
	viewed    bool
	views     int
	reactions int
	created   time.Time
}

func newRows(fixtures ...fixture) *sqlmock.Rows {
	r := sqlmock.NewRows(storyColumnNames)
	for _, f := range fixtures {
		addFixture(r, f)
	}
	return r
}

func addFixture(r *sqlmock.Rows, f fixture) {
	if f.privacy == "" {
		f.privacy = PrivacyEveryone
	}
	if f.kind == "" {
		f.kind = KindPhoto
	}
	r.AddRow(
		f.id, f.ownerType, f.ownerID, f.authorID,
		f.username, nil, nil, false,
		f.kind, "key/1.jpg", nil, nil, nil, nil,
		nil, nil, f.text, nil, f.privacy, f.pinned,
		f.views, f.created, f.created.Add(Lifetime), f.viewed, nil, f.reactions,
	)
}

// ─── Validation ─────────────────────────────────────────────────────────────

func TestNormalizeStory(t *testing.T) {
	key := viewerID + "/abc.jpg"
	board := boardID
	otherKey := otherID + "/abc.jpg"
	longText := ""
	for i := 0; i < MaxTextLength+1; i++ {
		longText += "я"
	}
	bigStyle := make([]byte, MaxTextStyleBytes+1)

	tests := []struct {
		name string
		req  createStoryRequest
		want error
		// check runs on success only
		check func(t *testing.T, got normalizedStory)
	}{
		{
			name: "photo defaults to everyone",
			req:  createStoryRequest{Kind: KindPhoto, MediaKey: &key},
			check: func(t *testing.T, got normalizedStory) {
				if got.ownerType != OwnerUser {
					t.Errorf("owner_type = %q, want user", got.ownerType)
				}
				if got.privacy != PrivacyEveryone {
					t.Errorf("privacy = %q, want everyone", got.privacy)
				}
			},
		},
		{
			name: "gosub story forces the board audience",
			req: createStoryRequest{
				OwnerType: OwnerGosub, BoardID: &board, Kind: KindPhoto,
				MediaKey: &key, Privacy: PrivacyCloseFriends,
			},
			check: func(t *testing.T, got normalizedStory) {
				if got.privacy != PrivacyEveryone {
					t.Errorf("gosub privacy = %q, want everyone", got.privacy)
				}
				if got.boardID == nil || *got.boardID != boardID {
					t.Errorf("board id not kept: %+v", got.boardID)
				}
			},
		},
		{
			name: "personal story may not carry a board",
			req:  createStoryRequest{Kind: KindPhoto, MediaKey: &key, BoardID: &board},
			want: errInvalidOwner,
		},
		{
			name: "gosub story needs a board",
			req:  createStoryRequest{OwnerType: OwnerGosub, Kind: KindPhoto, MediaKey: &key},
			want: errInvalidOwner,
		},
		{
			name: "photo needs media",
			req:  createStoryRequest{Kind: KindPhoto},
			want: errMediaRequired,
		},
		{
			name: "media key must belong to the author",
			req:  createStoryRequest{Kind: KindPhoto, MediaKey: &otherKey},
			want: errMediaKey,
		},
		{
			name: "text story needs text",
			req:  createStoryRequest{Kind: KindText},
			want: errTextRequired,
		},
		{
			name: "text story may not carry media",
			req:  createStoryRequest{Kind: KindText, Text: "привет", MediaKey: &key},
			want: errMediaForbidden,
		},
		{
			name: "unknown kind",
			req:  createStoryRequest{Kind: "gif", MediaKey: &key},
			want: errInvalidKind,
		},
		{
			name: "invalid privacy",
			req:  createStoryRequest{Kind: KindPhoto, MediaKey: &key, Privacy: "public"},
			want: errInvalidPrivacy,
		},
		{
			name: "video longer than a minute",
			req:  createStoryRequest{Kind: KindVideo, MediaKey: &key, Duration: floatPtr(61)},
			want: errVideoTooLong,
		},
		{
			name: "photo with a duration is a client bug",
			req:  createStoryRequest{Kind: KindPhoto, MediaKey: &key, Duration: floatPtr(10)},
			want: errInvalidKind,
		},
		{
			name: "caption too long",
			req:  createStoryRequest{Kind: KindText, Text: longText},
			want: errTextTooLong,
		},
		{
			name: "style blob too large",
			req: createStoryRequest{
				Kind: KindText, Text: "hi",
				TextStyle: bigStyle,
			},
			want: errStyleTooBig,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeStory(tc.req, viewerID)
			if tc.want != nil {
				if err != tc.want {
					t.Fatalf("err = %v, want %v", err, tc.want)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

func floatPtr(f float64) *float64 { return &f }

// ─── Grouping ───────────────────────────────────────────────────────────────

func TestGroupStories_Ordering(t *testing.T) {
	h, mock := newHandler(t)
	base := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT id::text, username, display_name, avatar_url, avatar_animated\s+FROM users WHERE id = ANY`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "avatar_url", "avatar_animated"}).
			AddRow(peerID, "peer", nil, nil, false).
			AddRow(viewerID, "me", nil, nil, false))
	mock.ExpectQuery(`SELECT id::text, name, slug, gomosub_avatar_url\s+FROM boards WHERE id = ANY`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "slug", "gomosub_avatar_url"}).
			AddRow(boardID, "Треды", "threads", nil))

	// The rail query walks newest→oldest per owner.
	list := []Story{
		{ID: "p3", OwnerType: OwnerUser, OwnerID: peerID, AuthorID: peerID, CreatedAt: base.Add(3 * time.Minute)},
		{ID: "p2", OwnerType: OwnerUser, OwnerID: peerID, AuthorID: peerID, CreatedAt: base.Add(2 * time.Minute), IsViewed: true},
		{ID: "p1", OwnerType: OwnerUser, OwnerID: peerID, AuthorID: peerID, CreatedAt: base.Add(1 * time.Minute), IsViewed: true},
		{ID: "b1", OwnerType: OwnerGosub, OwnerID: boardID, AuthorID: otherID, CreatedAt: base.Add(90 * time.Second), IsViewed: true},
		{ID: "me1", OwnerType: OwnerUser, OwnerID: viewerID, AuthorID: viewerID, CreatedAt: base.Add(30 * time.Second), IsOwn: true},
	}

	groups, err := h.groupStories(list, viewerID)
	if err != nil {
		t.Fatalf("groupStories: %v", err)
	}
	if len(groups) != 3 {
		t.Fatalf("groups = %d, want 3", len(groups))
	}

	if groups[0].Owner.ID != viewerID {
		t.Errorf("the viewer's own group must be first, got %s", groups[0].Owner.ID)
	}
	if groups[1].Owner.ID != peerID {
		t.Errorf("the unread peer group must come next, got %s", groups[1].Owner.ID)
	}
	if !groups[1].HasUnread {
		t.Error("the peer group with an unseen slide must report has_unread")
	}
	if groups[2].Owner.ID != boardID || groups[2].Owner.Type != OwnerGosub {
		t.Errorf("the read board group must be last, got %s/%s", groups[2].Owner.Type, groups[2].Owner.ID)
	}

	// Slides are played oldest → newest.
	ids := []string{groups[1].Stories[0].ID, groups[1].Stories[1].ID, groups[1].Stories[2].ID}
	want := []string{"p1", "p2", "p3"}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("slide order = %v, want %v", ids, want)
		}
	}
}

func TestGroupStories_Empty(t *testing.T) {
	h, _ := newHandler(t)
	groups, err := h.groupStories(nil, viewerID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if groups == nil || len(groups) != 0 {
		t.Fatalf("want an empty non-nil slice, got %#v", groups)
	}
}

// ─── Views ──────────────────────────────────────────────────────────────────

func TestRecordView_CountsOnlyTheFirstOpen(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO story_views`).
		WithArgs(storyID, viewerID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`UPDATE stories SET views_count = views_count \+ 1`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"views_count"}).AddRow(5))
	mock.ExpectCommit()

	count, counted, err := h.recordView(storyID, viewerID)
	if err != nil {
		t.Fatalf("recordView: %v", err)
	}
	if !counted || count != 5 {
		t.Fatalf("got counted=%v count=%d, want true/5", counted, count)
	}
}

func TestRecordView_ReopenDoesNotInflateCounter(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO story_views`).
		WithArgs(storyID, viewerID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT views_count FROM stories WHERE id::text = \$1`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"views_count"}).AddRow(5))
	mock.ExpectCommit()

	count, counted, err := h.recordView(storyID, viewerID)
	if err != nil {
		t.Fatalf("recordView: %v", err)
	}
	if counted || count != 5 {
		t.Fatalf("got counted=%v count=%d, want false/5", counted, count)
	}
}

// expectBoardServerGrant mocks checkBoardServerPerm: another owner, no ban,
// no timeout, membership as given, and one role carrying `perms`.
func expectBoardServerGrant(mock sqlmock.Sqlmock, member bool, perms string) {
	mock.ExpectQuery(`SELECT owner_id::text FROM boards WHERE id::text`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("00000000-0000-0000-0000-0000000000aa"))
	mock.ExpectQuery(`FROM gomosub_bans WHERE board_id`).
		WithArgs(viewerID, boardID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`timed_out_until IS NOT NULL AND timed_out_until`).
		WithArgs(viewerID, boardID).
		WillReturnRows(sqlmock.NewRows([]string{"timed_out"}))
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(boardID, viewerID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(member))
	rows := sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"})
	if perms != "" {
		rows.AddRow("r-1", "mods", []byte(perms), 5, false)
	}
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(boardID, viewerID).
		WillReturnRows(rows)
}

// ─── Publish ────────────────────────────────────────────────────────────────

func TestCreateStory_GosubStoresBoardAudience(t *testing.T) {
	h, mock := newHandler(t)
	key := viewerID + "/abc.jpg"

	expectBoardServerGrant(mock, true, `{"can_post_stories": true}`)
	mock.ExpectQuery(`INSERT INTO stories`).
		WithArgs(OwnerGosub, nil, boardID, viewerID, KindPhoto,
			key, nil, nil, nil, nil, nil, nil, "", nil, PrivacyEveryone, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "created_at", "expires_at"}).
			AddRow(storyID, time.Now(), time.Now().Add(Lifetime)))
	mock.ExpectQuery(`SELECT\s+s.id::text, s.owner_type`).
		WithArgs(viewerID, storyID).
		WillReturnRows(newRows(fixture{
			id: storyID, ownerType: OwnerGosub, ownerID: boardID, authorID: viewerID,
			username: "tester", kind: KindPhoto, created: time.Now(),
		}))

	c, w := testutil.NewPOSTContext("/api/v1/stories", map[string]interface{}{
		"owner_type": OwnerGosub,
		"board_id":   boardID,
		"kind":       KindPhoto,
		"media_key":  key,
		// A client may send a narrower audience; the board wins.
		"privacy": PrivacyCloseFriends,
	}, testClaims(viewerID), nil)

	h.CreateStory(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestCreateStory_ForeignMediaKeyIsRejectedBeforeAnyWrite(t *testing.T) {
	h, _ := newHandler(t)

	c, w := testutil.NewPOSTContext("/api/v1/stories", map[string]interface{}{
		"kind":      KindPhoto,
		"media_key": otherID + "/stolen.jpg",
	}, testClaims(viewerID), nil)

	h.CreateStory(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %s)", w.Code, w.Body.String())
	}
}

func TestCreateStory_RequiresPostingRightsInGomoSub(t *testing.T) {
	h, mock := newHandler(t)
	key := viewerID + "/abc.jpg"

	expectBoardServerGrant(mock, false, "")

	c, w := testutil.NewPOSTContext("/api/v1/stories", map[string]interface{}{
		"owner_type": OwnerGosub,
		"board_id":   boardID,
		"kind":       KindPhoto,
		"media_key":  key,
	}, testClaims(viewerID), nil)

	h.CreateStory(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body %s)", w.Code, w.Body.String())
	}
}

// ─── Update / delete ────────────────────────────────────────────────────────

func TestUpdateStory_PinnedCap(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectQuery(`SELECT author_id::text, owner_type FROM stories`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"author_id", "owner_type"}).AddRow(viewerID, OwnerUser))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM stories`).
		WithArgs(viewerID, storyID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(MaxPinnedStories))

	c, w := testutil.NewPUTContext("/api/v1/stories/"+storyID,
		map[string]interface{}{"is_pinned": true}, testClaims(viewerID),
		map[string]string{"id": storyID})

	h.UpdateStory(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %s)", w.Code, w.Body.String())
	}
}

func TestUpdateStory_OnlyAuthor(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectQuery(`SELECT author_id::text, owner_type FROM stories`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"author_id", "owner_type"}).AddRow(otherID, OwnerUser))

	c, w := testutil.NewPUTContext("/api/v1/stories/"+storyID,
		map[string]interface{}{"privacy": PrivacyFriends}, testClaims(viewerID),
		map[string]string{"id": storyID})

	h.UpdateStory(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body %s)", w.Code, w.Body.String())
	}
}

func TestDeleteStory_BoardModeratorMayDelete(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectQuery(`SELECT author_id::text, owner_type,\s+COALESCE\(user_id::text, board_id::text\), media_key, preview_key`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"author_id", "owner_type", "owner_id", "media_key", "preview_key"}).
			AddRow(otherID, OwnerGosub, boardID, nil, nil))
	expectBoardServerGrant(mock, true, `{"can_delete_threads": true}`)
	mock.ExpectExec(`UPDATE stories SET deleted_at = NOW\(\)`).
		WithArgs(storyID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := testutil.NewDELETEContextWithClaims("/api/v1/stories/"+storyID, nil,
		map[string]string{"id": storyID}, testClaims(viewerID))

	h.DeleteStory(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestDeleteStory_StrangerForbidden(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectQuery(`SELECT author_id::text, owner_type,\s+COALESCE\(user_id::text, board_id::text\), media_key, preview_key`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"author_id", "owner_type", "owner_id", "media_key", "preview_key"}).
			AddRow(otherID, OwnerUser, otherID, nil, nil))

	c, w := testutil.NewDELETEContextWithClaims("/api/v1/stories/"+storyID, nil,
		map[string]string{"id": storyID}, testClaims(viewerID))

	h.DeleteStory(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body %s)", w.Code, w.Body.String())
	}
}

// ─── Reactions ──────────────────────────────────────────────────────────────

func TestSetReaction_RejectsOwnStory(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectQuery(`SELECT author_id::text, owner_type, COALESCE\(user_id::text, board_id::text\)\s+FROM stories`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"author_id", "owner_type", "owner_id"}).AddRow(viewerID, OwnerUser, viewerID))
	mock.ExpectQuery(`SELECT EXISTS \(\s*SELECT 1 FROM stories s`).
		WithArgs(viewerID, storyID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := testutil.NewPUTContext("/api/v1/stories/"+storyID+"/reaction",
		map[string]interface{}{"emoji": "❤️"}, testClaims(viewerID),
		map[string]string{"id": storyID})

	h.SetReaction(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %s)", w.Code, w.Body.String())
	}
}

func TestSetReaction_RejectsUnknownEmoji(t *testing.T) {
	h, _ := newHandler(t)

	c, w := testutil.NewPUTContext("/api/v1/stories/"+storyID+"/reaction",
		map[string]interface{}{"emoji": "💩💩💩"}, testClaims(viewerID),
		map[string]string{"id": storyID})

	h.SetReaction(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %s)", w.Code, w.Body.String())
	}
}

// ─── Reads ──────────────────────────────────────────────────────────────────

func TestGetUserStories_PrivateProfileReturnsEmptyList(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectQuery(`SELECT EXISTS \(\s*SELECT 1 FROM users u`).
		WithArgs(viewerID, peerID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := testutil.NewGETContextWithParams("/api/v1/stories/user/"+peerID, nil,
		map[string]string{"userId": peerID})
	c.Set("claims", testClaims(viewerID))

	h.GetUserStories(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); body != `{"success":true,"data":[]}` {
		t.Fatalf("a private profile must return an empty list, got %s", body)
	}
}

func TestGetUserStories_ArchiveIsAuthorOnly(t *testing.T) {
	h, _ := newHandler(t)

	c, w := testutil.NewGETContextWithParams("/api/v1/stories/user/"+peerID,
		map[string]string{"scope": "archive"}, map[string]string{"userId": peerID})
	c.Set("claims", testClaims(viewerID))

	h.GetUserStories(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body %s)", w.Code, w.Body.String())
	}
}

func TestGetUserStories_ReturnsOldestFirst(t *testing.T) {
	h, mock := newHandler(t)
	base := time.Now().UTC()

	mock.ExpectQuery(`SELECT EXISTS \(\s*SELECT 1 FROM users u`).
		WithArgs(viewerID, peerID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT`)+`[\s\S]*`+regexp.QuoteMeta(`ORDER BY s.created_at ASC`)).
		WithArgs(viewerID, peerID).
		WillReturnRows(newRows(
			fixture{id: "s1", ownerType: OwnerUser, ownerID: peerID, authorID: peerID, username: "peer", created: base},
			fixture{id: "s2", ownerType: OwnerUser, ownerID: peerID, authorID: peerID, username: "peer", created: base.Add(time.Minute), viewed: true}))

	c, w := testutil.NewGETContextWithParams("/api/v1/stories/user/"+peerID, nil,
		map[string]string{"userId": peerID})
	c.Set("claims", testClaims(viewerID))

	h.GetUserStories(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool    `json:"success"`
		Data    []Story `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Data) != 2 || resp.Data[0].ID != "s1" || resp.Data[1].ID != "s2" {
		t.Fatalf("unexpected order: %+v", resp.Data)
	}
	if !resp.Data[1].IsViewed || resp.Data[0].IsViewed {
		t.Error("per-viewer viewed state must be preserved")
	}
}

func TestGetViewers_StrangerForbidden(t *testing.T) {
	h, mock := newHandler(t)

	mock.ExpectQuery(`SELECT owner_type, COALESCE\(user_id::text, board_id::text\), author_id::text\s+FROM stories`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_type", "owner_id", "author_id"}).
			AddRow(OwnerUser, otherID, otherID))

	c, w := testutil.NewGETContextWithParams("/api/v1/stories/"+storyID+"/viewers", nil,
		map[string]string{"id": storyID})
	c.Set("claims", testClaims(viewerID))

	h.GetViewers(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body %s)", w.Code, w.Body.String())
	}
}

func TestGetViewers_AuthorSeesNewestFirst(t *testing.T) {
	h, mock := newHandler(t)
	base := time.Now().UTC()

	mock.ExpectQuery(`SELECT owner_type, COALESCE\(user_id::text, board_id::text\), author_id::text\s+FROM stories`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_type", "owner_id", "author_id"}).
			AddRow(OwnerUser, viewerID, viewerID))
	mock.ExpectQuery(`SELECT u.id::text, u.username`).
		WithArgs(storyID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "display_name", "avatar_url", "avatar_animated", "viewed_at", "cursor",
		}).
			AddRow(peerID, "peer", nil, nil, false, base.Add(time.Minute), "c2").
			AddRow(otherID, "other", nil, nil, false, base, "c1"))

	c, w := testutil.NewGETContextWithParams("/api/v1/stories/"+storyID+"/viewers", nil,
		map[string]string{"id": storyID})
	c.Set("claims", testClaims(viewerID))

	h.GetViewers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data ViewersResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Data.Viewers) != 2 || resp.Data.Viewers[0].User.ID != peerID {
		t.Fatalf("unexpected viewers: %+v", resp.Data.Viewers)
	}
	// Two rows is below the page size, so there is nothing more to page.
	if resp.Data.NextBefore != nil {
		t.Errorf("next_before must be absent on a short page, got %q", *resp.Data.NextBefore)
	}
}
