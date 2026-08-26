package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// notificationColumns is the shared column list for every notification row
// returned by SELECT/RETURNING, including the structured `params` column.
var notificationColumns = []string{
	"id", "user_id", "type", "title", "message",
	"related_thread_id", "related_post_id", "related_user_id",
	"related_wall_post_id", "related_wall_comment_id", "related_wall_user_id",
	"related_wall_post_ids", "is_read", "created_at", "group_count", "params",
}

// newMock opens a sqlmock DB with the standard cleanup that verifies all
// expectations were met.
func newMock(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
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
	return db, mock
}

func strPtr(s string) *string { return &s }

// ──────────────────────────── params marshaling ────────────────────────────

func TestMarshalNotificationParams_Nil(t *testing.T) {
	if got := MarshalNotificationParams(nil); string(got) != "{}" {
		t.Fatalf("expected empty object for nil params, got %s", got)
	}
}

func TestMarshalNotificationParams_Valid(t *testing.T) {
	got := MarshalNotificationParams(&models.NotificationParams{Actor: "alice", Count: 2})
	if string(got) != `{"actor":"alice","count":2}` {
		t.Fatalf("unexpected JSON: %s", got)
	}
}

func TestUnmarshalNotificationParams_Empty(t *testing.T) {
	if got := unmarshalNotificationParams(nil); got != (models.NotificationParams{}) {
		t.Fatalf("expected zero params for empty input, got %+v", got)
	}
}

func TestUnmarshalNotificationParams_Malformed(t *testing.T) {
	if got := unmarshalNotificationParams(json.RawMessage("{not-json")); got != (models.NotificationParams{}) {
		t.Fatalf("expected zero params for malformed input, got %+v", got)
	}
}

func TestUnmarshalNotificationParams_Valid(t *testing.T) {
	got := unmarshalNotificationParams(json.RawMessage(`{"actor":"alice","count":3,"gift_name":"Роза"}`))
	if got.Actor != "alice" || got.Count != 3 || got.GiftName != "Роза" {
		t.Fatalf("unexpected params: %+v", got)
	}
}

func TestNotificationParamsJSON_Empty(t *testing.T) {
	if got := notificationParamsJSON(nil); got != "{}" {
		t.Fatalf("expected {} for empty params, got %q", got)
	}
}

func TestSetPushService(t *testing.T) {
	prev := PushService
	t.Cleanup(func() { PushService = prev })

	// Nil-safe wiring — routes calls it even when VAPID keys are missing.
	SetPushService(nil)
	if PushService != nil {
		t.Fatal("expected PushService to be nil after SetPushService(nil)")
	}
}

func TestNullableString(t *testing.T) {
	s := "x"
	if got := nullableString(nil); got != nil {
		t.Fatalf("expected nil for nil pointer, got %v", got)
	}
	if got := nullableString(&s); got != "x" {
		t.Fatalf("expected x, got %v", got)
	}
}

func TestFirstNonNilString(t *testing.T) {
	a, b := "a", "b"
	if got := firstNonNilString(&a, &b); got != &a {
		t.Fatal("expected first pointer when non-nil")
	}
	if got := firstNonNilString(nil, &b); got != &b {
		t.Fatal("expected second pointer when first is nil")
	}
	if got := firstNonNilString(nil, nil); got != nil {
		t.Fatalf("expected nil when both nil, got %v", got)
	}
}

// ──────────────────────────── push display text ────────────────────────────

func TestPushTitleFor(t *testing.T) {
	cases := map[string]string{
		"like":               "Новая оценка",
		"reply":              "Новый ответ",
		"thread_reply":       "Новый ответ в теме",
		"wall_post":          "Новая запись на стене",
		"wall_post_like":     "Новые оценки",
		"wall_comment":       "Новый комментарий на стене",
		"wall_comment_reply": "Новый ответ на комментарий",
		"wall_repost":        "Новый репост",
		"friend_request":     "Заявка в друзья",
		"friend_accepted":    "Заявка в друзья принята",
		"gift_received":      "Вам подарили подарок",
		"unknown_type":       "gomo6",
	}
	for typ, want := range cases {
		if got := pushTitleFor(&models.Notification{Type: typ}); got != want {
			t.Errorf("pushTitleFor(%q) = %q, want %q", typ, got, want)
		}
	}
}

func TestPushBodyFor_RemainingTypes(t *testing.T) {
	cases := []struct {
		name   string
		typ    string
		params string
		want   string
	}{
		{"like", "like", `{"actor":"alice"}`, "@alice оценил(а) ваш контент"},
		{"like_no_actor", "like", `{}`, "Ваш контент оценили"},
		{"reply", "reply", `{"actor":"alice"}`, "@alice ответил(а) вам"},
		{"reply_no_actor", "reply", `{}`, "Кто-то ответил вам"},
		{"thread_reply", "thread_reply", `{"actor":"alice"}`, "@alice ответил(а) в теме"},
		{"thread_reply_no_actor", "thread_reply", `{}`, "Новый ответ в теме"},
		{"wall_post", "wall_post", `{"actor":"alice"}`, "@alice написал(а) на вашей стене"},
		{"wall_post_no_actor", "wall_post", `{}`, "Новая запись на вашей стене"},
		{"wall_comment", "wall_comment", `{"actor":"alice"}`, "@alice прокомментировал(а) вашу запись"},
		{"wall_comment_no_actor", "wall_comment", `{}`, "Вашу запись прокомментировали"},
		{"wall_comment_reply", "wall_comment_reply", `{"actor":"alice"}`, "@alice ответил(а) на ваш комментарий"},
		{"wall_comment_reply_no_actor", "wall_comment_reply", `{}`, "Ответ на ваш комментарий"},
		{"wall_repost", "wall_repost", `{"actor":"alice"}`, "@alice сделал(а) репост вашей записи"},
		{"wall_repost_no_actor", "wall_repost", `{}`, "Репост вашей записи"},
		{"friend_request", "friend_request", `{"actor":"alice"}`, "@alice хочет добавить вас в друзья"},
		{"friend_request_no_actor", "friend_request", `{}`, "Новая заявка в друзья"},
		{"friend_accepted", "friend_accepted", `{"actor":"alice"}`, "@alice принял(а) вашу заявку"},
		{"friend_accepted_no_actor", "friend_accepted", `{}`, "Заявка в друзья принята"},
		{"gift_received_no_name", "gift_received", `{}`, "Вам отправили подарок"},
		{"wall_post_like_count_one", "wall_post_like", `{"actor":"alice","count":1}`, "@alice оценил(а) вашу запись"},
		{"wall_post_like_no_actor_burst", "wall_post_like", `{"count":3}`, "Ваши записи оценили"},
		{"wall_post_like_no_actor_single", "wall_post_like", `{"count":1}`, "Вашу запись оценили"},
	}
	for _, tc := range cases {
		n := &models.Notification{Type: tc.typ, Params: json.RawMessage(tc.params)}
		if got := pushBodyFor(n); got != tc.want {
			t.Errorf("%s: pushBodyFor(%q, %s) = %q, want %q", tc.name, tc.typ, tc.params, got, tc.want)
		}
	}
}

func TestPushBodyFor_StoredMessage(t *testing.T) {
	n := &models.Notification{Type: "wall_post", Message: "С днём рождения!", Params: json.RawMessage(`{"actor":"alice"}`)}
	if got := pushBodyFor(n); got != "@alice: С днём рождения!" {
		t.Fatalf("unexpected body: %q", got)
	}
}

func TestPushBodyFor_Gift(t *testing.T) {
	n := &models.Notification{Type: "gift_received", Params: json.RawMessage(`{"gift_name":"Роза"}`)}
	if got := pushBodyFor(n); got != "Подарок: Роза" {
		t.Fatalf("unexpected gift body: %q", got)
	}
}

func TestPushBodyFor_Default(t *testing.T) {
	n := &models.Notification{Type: "unknown_type"}
	if got := pushBodyFor(n); got != "Новое уведомление в gomo6" {
		t.Fatalf("unexpected default body: %q", got)
	}
}

// ──────────────────────────── CreateNotification ────────────────────────────

func TestCreateNotification_Success(t *testing.T) {
	db, mock := newMock(t)

	now := time.Now()
	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n1", "u1", "like", "", "", "thread1", "post1", nil, nil, nil, nil, "[]", false, now, 1, []byte(`{"actor":"alice"}`))

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*created_at`).
		WithArgs("u1", "like", "", "", "thread1", "post1", nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnRows(rows)

	params := &models.NotificationParams{Actor: "alice"}
	notif, err := CreateNotification(db, nil, nil, "u1", "like", "", params, strPtr("thread1"), strPtr("post1"), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
	if notif.ID != "n1" {
		t.Fatalf("expected ID n1, got %s", notif.ID)
	}
	if notif.Type != "like" {
		t.Fatalf("expected type like, got %s", notif.Type)
	}
	if notif.RelatedThreadID == nil || *notif.RelatedThreadID != "thread1" {
		t.Fatalf("expected related_thread_id thread1, got %v", notif.RelatedThreadID)
	}
}

func TestCreateNotification_NilDB(t *testing.T) {
	notif, err := CreateNotification(nil, nil, nil, "u1", "like", "Msg", nil, nil, nil, nil)
	if err == nil {
		t.Fatal("expected error for nil db, got nil")
	}
	if notif != nil {
		t.Fatalf("expected nil notification, got %v", notif)
	}
}

func TestCreateNotification_DBError(t *testing.T) {
	db, mock := newMock(t)

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "like", "", "Msg", nil, nil, nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnError(sqlmock.ErrCancelled)

	params := &models.NotificationParams{Actor: "alice"}
	notif, err := CreateNotification(db, nil, nil, "u1", "like", "Msg", params, nil, nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if notif != nil {
		t.Fatalf("expected nil notification, got %v", notif)
	}
}

// ──────────────────────────── CreateWallNotification / grouping ────────────────────────────

func TestCreateWallNotification_MergesIntoGroup(t *testing.T) {
	db, mock := newMock(t)

	now := time.Now()

	// Grouping lookup finds an existing burst of 1 like from actor1.
	mock.ExpectQuery(`SELECT id, group_count, related_wall_post_id, related_wall_post_ids.*FROM notifications.*LIMIT 1`).
		WithArgs("u1", "wall_post_like", "actor1", 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "group_count", "related_wall_post_id", "related_wall_post_ids",
		}).AddRow("nw-existing", 1, "wp-old", `["wp-old"]`))

	// Merge UPDATE increments the count, records the structured params and bumps created_at.
	mock.ExpectQuery(`UPDATE notifications.*SET group_count = \$1, is_read = false.*RETURNING created_at`).
		WithArgs(2, "wp-new", `["wp-old","wp-new"]`, `{"actor":"actor1","count":2}`, "nw-existing").
		WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(now))

	params := &models.NotificationParams{Actor: "actor1"}
	notif, err := CreateWallNotification(db, nil, nil, "u1", "wall_post_like", "", params, strPtr("wp-new"), nil, strPtr("wu1"), strPtr("actor1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
	if notif.ID != "nw-existing" {
		t.Fatalf("expected merged id nw-existing, got %s", notif.ID)
	}
	if notif.GroupCount != 2 {
		t.Fatalf("expected group_count 2, got %d", notif.GroupCount)
	}
	if notif.RelatedWallPostID == nil || *notif.RelatedWallPostID != "wp-new" {
		t.Fatalf("expected related_wall_post_id wp-new, got %v", notif.RelatedWallPostID)
	}
	if len(notif.RelatedWallPostIDs) != 2 {
		t.Fatalf("expected 2 related wall post ids, got %v", notif.RelatedWallPostIDs)
	}

	var mergedParams models.NotificationParams
	if err := json.Unmarshal(notif.Params, &mergedParams); err != nil {
		t.Fatalf("failed to unmarshal params: %v", err)
	}
	if mergedParams.Actor != "actor1" || mergedParams.Count != 2 {
		t.Fatalf("unexpected merged params: %+v", mergedParams)
	}
}

func TestCreateWallNotification_GroupingErrorFallsBackToInsert(t *testing.T) {
	db, mock := newMock(t)

	// A grouping lookup error is non-fatal: the caller falls back to a fresh insert.
	mock.ExpectQuery(`SELECT id, group_count, related_wall_post_id, related_wall_post_ids.*FROM notifications.*LIMIT 1`).
		WithArgs("u1", "wall_post_like", "actor1", 1).
		WillReturnError(sqlmock.ErrCancelled)

	now := time.Now()
	rows := sqlmock.NewRows(notificationColumns).
		AddRow("nw1", "u1", "wall_post_like", "", "", nil, nil, "actor1", "wp1", nil, "wu1", `["wp1"]`, false, now, 1, []byte(`{"actor":"actor1"}`))

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "wall_post_like", "", "", nil, nil, "actor1", "wp1", nil, "wu1", `["wp1"]`, false, sqlmock.AnyArg(), 1, `{"actor":"actor1"}`).
		WillReturnRows(rows)

	params := &models.NotificationParams{Actor: "actor1"}
	notif, err := CreateWallNotification(db, nil, nil, "u1", "wall_post_like", "", params, strPtr("wp1"), nil, strPtr("wu1"), strPtr("actor1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}
	if notif.ID != "nw1" {
		t.Fatalf("expected fresh insert id nw1, got %s", notif.ID)
	}
}

// ──────────────────────────── redis + hub delivery ────────────────────────────

func TestCreateNotification_InvalidatesCacheAndPublishes(t *testing.T) {
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	db, mock := newMock(t)

	now := time.Now()
	rows := sqlmock.NewRows(notificationColumns).
		AddRow("n1", "u1", "like", "", "", nil, nil, nil, nil, nil, nil, "[]", false, now, 1, []byte(`{"actor":"alice"}`))

	mock.ExpectQuery(`INSERT INTO notifications.*VALUES.*RETURNING.*`).
		WithArgs("u1", "like", "", "", nil, nil, nil, nil, nil, nil, "[]", false, sqlmock.AnyArg(), 1, `{"actor":"alice"}`).
		WillReturnRows(rows)

	// Seed a cached notifications list for u1 — it must be purged on insert.
	ctx := context.Background()
	cacheKey := "data:/api/v1/notifications?user_id=eq.u1&limit=50"
	if err := client.Set(ctx, cacheKey, "cached", 0).Err(); err != nil {
		t.Fatalf("seed cache key: %v", err)
	}

	hub := websocket.NewHub(client, nil)
	params := &models.NotificationParams{Actor: "alice"}
	notif, err := CreateNotification(db, client, hub, "u1", "like", "", params, nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if notif == nil {
		t.Fatal("expected notification, got nil")
	}

	if mr.Exists(cacheKey) {
		t.Errorf("expected cache key %q to be invalidated", cacheKey)
	}
}
