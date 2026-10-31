package crudengine

import (
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// ─── GomoSub cache invalidation dispatch ────────────────────────────
// Role/overwrite/grant writes change thread visibility, so the dispatcher
// must clear the thread lists along with the structure lists. These tests
// seed the exact query shapes the clients use and assert the registry hooks
// clear them (the 30s-stale-visibility bug class).

func setupEngineWithRedis(t *testing.T) (*Engine, sqlmock.Sqlmock, *miniredis.Miniredis) {
	t.Helper()
	h, mock := setupEngine(t)
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	h.redis = client
	return h, mock, mr
}

func seedKeys(t *testing.T, mr *miniredis.Miniredis, keys ...string) {
	t.Helper()
	for _, key := range keys {
		if err := mr.Set(key, `{"data":[]}`); err != nil {
			t.Fatalf("failed to seed cache key %q: %v", key, err)
		}
	}
}

func assertGone(t *testing.T, mr *miniredis.Miniredis, keys ...string) {
	t.Helper()
	for _, key := range keys {
		if mr.Exists(key) {
			t.Errorf("cache key %q was not invalidated", key)
		}
	}
}

func assertKept(t *testing.T, mr *miniredis.Miniredis, keys ...string) {
	t.Helper()
	for _, key := range keys {
		if !mr.Exists(key) {
			t.Errorf("cache key %q must survive unrelated invalidation", key)
		}
	}
}

func TestInvalidateGomosubRolesDispatch(t *testing.T) {
	h, _, mr := setupEngineWithRedis(t)
	roles := "data:/api/v1/gomosub_roles?board_id=eq.b1|viewer=u1"
	threads := "data:/api/v1/threads?board_id=eq.b1&limit=20|viewer=u9"
	other := "data:/api/v1/threads?board_id=eq.b2&limit=20|viewer=u9"
	seedKeys(t, mr, roles, threads, other)

	c, _ := newRequestContext("POST", "/api/v1/gomosub_roles", nil, nil)
	h.invalidateCacheForTableResult(c, "gomosub_roles", map[string]interface{}{"board_id": "b1"})

	assertGone(t, mr, roles, threads)
	assertKept(t, mr, other)
}

func TestInvalidateChannelPermissionsDispatch(t *testing.T) {
	h, mock, mr := setupEngineWithRedis(t)
	mock.ExpectQuery(`SELECT board_id FROM channels WHERE id = \$1`).
		WithArgs("c1").
		WillReturnRows(sqlmock.NewRows([]string{"board_id"}).AddRow("b1"))

	eq := "data:/api/v1/channel_permissions?channel_id=eq.c1&select=*|viewer=u1"
	inShape := "data:/api/v1/channel_permissions?channel_id=in.(c1,c2)|viewer=u1"
	threads := "data:/api/v1/threads?board_id=eq.b1&limit=20|viewer=u9"
	seedKeys(t, mr, eq, inShape, threads)

	c, _ := newRequestContext("POST", "/api/v1/channel_permissions", nil, nil)
	h.invalidateCacheForTableResult(c, "channel_permissions", map[string]interface{}{"channel_id": "c1"})

	assertGone(t, mr, eq, inShape, threads)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestInvalidateChannelPermissionsDispatch_NoChannel(t *testing.T) {
	h, mock, mr := setupEngineWithRedis(t)
	other := "data:/api/v1/gomosub_roles?board_id=eq.b1|viewer=u1"
	cleared := "data:/api/v1/channel_permissions?channel_id=eq.c9&select=*|viewer=u1"
	seedKeys(t, mr, other, cleared)

	// Empty channel_id: the board lookup is skipped, but the per-channel
	// shape degrades to a broad pattern — all channel_permissions reads go,
	// other tables survive.
	c, _ := newRequestContext("POST", "/api/v1/channel_permissions", nil, nil)
	h.invalidateCacheForTableResult(c, "channel_permissions", map[string]interface{}{})

	assertGone(t, mr, cleared)
	assertKept(t, mr, other)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestInvalidateMemberRolesDispatch(t *testing.T) {
	h, _, mr := setupEngineWithRedis(t)
	grants := "data:/api/v1/gomosub_member_roles?board_id=eq.b1|viewer=u1"
	members := "data:/api/v1/gomosub_memberships?board_id=eq.b1|viewer=u1"
	threads := "data:/api/v1/threads?board_id=eq.b1&limit=20|viewer=u9"
	other := "data:/api/v1/gomosub_memberships?board_id=eq.b2|viewer=u1"
	seedKeys(t, mr, grants, members, threads, other)

	c, _ := newRequestContext("POST", "/api/v1/gomosub_member_roles", nil, nil)
	h.invalidateCacheForTableResult(c, "gomosub_member_roles", map[string]interface{}{"board_id": "b1"})

	assertGone(t, mr, grants, members, threads)
	assertKept(t, mr, other)
}

func TestInvalidateGomosubMembershipsDispatch(t *testing.T) {
	h, _, mr := setupEngineWithRedis(t)
	board := "data:/api/v1/gomosub_memberships?board_id=eq.b1|viewer=u1"
	mine := "data:/api/v1/gomosub_memberships?user_id=eq.u9|viewer=u9"
	other := "data:/api/v1/gomosub_memberships?user_id=eq.u8|viewer=u8"
	seedKeys(t, mr, board, mine, other)

	c, _ := newRequestContext("POST", "/api/v1/gomosub_memberships", nil, nil)
	h.invalidateCacheForTableResult(c, "gomosub_memberships", map[string]interface{}{
		"board_id": "b1", "user_id": "u9",
	})

	assertGone(t, mr, board, mine)
	assertKept(t, mr, other)
}

func TestInvalidateChannelCategoriesDispatch(t *testing.T) {
	h, _, mr := setupEngineWithRedis(t)
	cats := "data:/api/v1/channel_categories?board_id=eq.b1|viewer=u1"
	other := "data:/api/v1/channel_categories?board_id=eq.b2|viewer=u1"
	seedKeys(t, mr, cats, other)

	c, _ := newRequestContext("POST", "/api/v1/channel_categories", nil, nil)
	h.invalidateCacheForTableResult(c, "channel_categories", map[string]interface{}{"board_id": "b1"})

	assertGone(t, mr, cats)
	assertKept(t, mr, other)
}

// ─── Audit-log write hooks ──────────────────────────────────────────
// The after*Write hooks translate generic CRUD writes into audit entries.
// Called directly: the hub is nil in tests, the ledger is sqlmock.

func auditCtx() (*gin.Context, *httptest.ResponseRecorder) {
	return newRequestContext("POST", "/api/v1/gomosub_roles", nil, &auth.Claims{UserID: "actor-1"})
}

func TestAfterGomosubMembershipsWrite_Actions(t *testing.T) {
	h, mock, _ := setupEngineWithRedis(t)
	result := map[string]interface{}{"board_id": "b1", "user_id": "u9"}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		c, _ := auditCtx()
		afterGomosubMembershipsWrite(h, c, method, result)
	}
	// Missing ids: no-op, no DB touch.
	c, _ := auditCtx()
	afterGomosubMembershipsWrite(h, c, "POST", map[string]interface{}{})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAfterGomosubMemberRolesWrite_AuditGrantRevoke(t *testing.T) {
	h, mock, _ := setupEngineWithRedis(t)
	result := map[string]interface{}{"board_id": "b1", "user_id": "u9", "role_id": "r1"}

	mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
		WithArgs("b1", "actor-1", "grant", "u9", "r1", nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	c, _ := auditCtx()
	afterGomosubMemberRolesWrite(h, c, "POST", result)

	mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
		WithArgs("b1", "actor-1", "revoke", "u9", "r1", nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	c2, _ := auditCtx()
	afterGomosubMemberRolesWrite(h, c2, "DELETE", result)

	// Missing role: no-op.
	c3, _ := auditCtx()
	afterGomosubMemberRolesWrite(h, c3, "POST", map[string]interface{}{"board_id": "b1", "user_id": "u9"})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAfterGomosubRolesWrite_AuditActions(t *testing.T) {
	h, mock, _ := setupEngineWithRedis(t)
	for method, action := range map[string]string{
		"POST": "role_create", "PUT": "role_update", "DELETE": "role_delete",
	} {
		mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
			WithArgs("b1", "actor-1", action, nil, "r1", nil, nil).
			WillReturnResult(sqlmock.NewResult(0, 1))
		c, _ := auditCtx()
		afterGomosubRolesWrite(h, c, method, map[string]interface{}{"board_id": "b1", "id": "r1"})
	}
	// Unknown method: no-op, no DB touch.
	c, _ := auditCtx()
	afterGomosubRolesWrite(h, c, "GET", map[string]interface{}{"board_id": "b1", "id": "r1"})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAfterChannelsWrite_AuditActions(t *testing.T) {
	h, mock, _ := setupEngineWithRedis(t)
	for method, action := range map[string]string{
		"POST": "channel_create", "PUT": "channel_update", "DELETE": "channel_delete",
	} {
		mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
			WithArgs("b1", "actor-1", action, nil, nil, "c1", nil).
			WillReturnResult(sqlmock.NewResult(0, 1))
		c, _ := auditCtx()
		afterChannelsWrite(h, c, method, map[string]interface{}{"board_id": "b1", "id": "c1"})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAfterChannelCategoriesWrite_Audit(t *testing.T) {
	h, mock, _ := setupEngineWithRedis(t)
	mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
		WithArgs("b1", "actor-1", "category_create", nil, nil, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	c, _ := auditCtx()
	afterChannelCategoriesWrite(h, c, "POST", map[string]interface{}{"board_id": "b1"})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAfterChannelPermissionsWrite_Audit(t *testing.T) {
	h, mock, _ := setupEngineWithRedis(t)
	mock.ExpectQuery(`SELECT board_id FROM channels WHERE id = \$1`).
		WithArgs("c1").
		WillReturnRows(sqlmock.NewRows([]string{"board_id"}).AddRow("b1"))
	mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
		WithArgs("b1", "actor-1", "overwrite_update", nil, "r1", "c1", nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	c, _ := auditCtx()
	afterChannelPermissionsWrite(h, c, "PUT", map[string]interface{}{"channel_id": "c1", "role_id": "r1"})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
