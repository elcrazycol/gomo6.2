package messenger

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crypto"
	"github.com/gomo6/backend/internal/testutil"
)

// ─── CreateGroupConversation: friends-only + size limit ─────────────────────

func TestCreateGroupConversation_SuccessWithFriends(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{
		"name":       "Test Group",
		"member_ids": []string{testUser2, testUser3},
	}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups", body, claims, nil)

	// Friend checks (both are friends of the creator)
	mock.ExpectQuery(`SELECT EXISTS\(.*SELECT 1 FROM friendships`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(.*SELECT 1 FROM friendships`).
		WithArgs(testUser1, testUser3).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Create conversation
	mock.ExpectQuery(`INSERT INTO chat_conversations \(is_group, group_name, created_by, encryption_key_version\).*RETURNING id`).
		WithArgs("Test Group", testUser1, crypto.KeyVersionHKDF).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(testConv1))

	// Creator as admin
	mock.ExpectExec(`INSERT INTO chat_members \(conversation_id, user_id, role\).*'admin'`).
		WithArgs(testConv1, testUser1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Members
	mock.ExpectExec(`INSERT INTO chat_members \(conversation_id, user_id, role\).*'member'.*DO NOTHING`).
		WithArgs(testConv1, testUser2).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO chat_members \(conversation_id, user_id, role\).*'member'.*DO NOTHING`).
		WithArgs(testConv1, testUser3).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.CreateGroupConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["conversation_id"] != testConv1 {
		t.Fatalf("expected conv id %s, got %v", testConv1, data["conversation_id"])
	}
}

func TestCreateGroupConversation_NonFriendRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{
		"name":       "Test Group",
		"member_ids": []string{testUser2},
	}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups", body, claims, nil)

	// testUser2 is NOT a friend of testUser1
	mock.ExpectQuery(`SELECT EXISTS\(.*SELECT 1 FROM friendships`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.CreateGroupConversation(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestCreateGroupConversation_TooManyMembers(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	// 100 member IDs exceeds the max group size of 100 (creator + 99).
	ids := make([]string, 0, 100)
	for i := 2; i <= 101; i++ {
		ids = append(ids, fmt.Sprintf("00000000-0000-0000-0000-%012d", i))
	}
	body := map[string]interface{}{"name": "Big Group", "member_ids": ids}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups", body, claims, nil)

	handler.CreateGroupConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestCreateGroupConversation_InvalidName(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"name": "", "member_ids": []string{}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups", body, claims, nil)

	handler.CreateGroupConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestCreateGroupConversation_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	body := map[string]interface{}{"name": "Test Group", "member_ids": []string{}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups", body, nil, nil)

	handler.CreateGroupConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── AddGroupMembers: friends-only + size limit ─────────────────────────────

func TestAddGroupMembers_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"user_ids": []string{testUser2, testUser3}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/"+testConv1+"/members", body, claims, map[string]string{"id": testConv1})

	// Admin check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2 AND role = 'admin'\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Existing member checks
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser3).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	// Current member count
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM chat_members WHERE conversation_id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	// Friend checks
	mock.ExpectQuery(`SELECT EXISTS\(.*SELECT 1 FROM friendships`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(.*SELECT 1 FROM friendships`).
		WithArgs(testUser1, testUser3).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Member inserts
	mock.ExpectExec(`INSERT INTO chat_members \(conversation_id, user_id, role\).*'member'.*DO NOTHING`).
		WithArgs(testConv1, testUser2).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO chat_members \(conversation_id, user_id, role\).*'member'.*DO NOTHING`).
		WithArgs(testConv1, testUser3).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Conversation touched
	mock.ExpectExec(`UPDATE chat_conversations SET updated_at = NOW\(\) WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.AddGroupMembers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["added"] != float64(2) {
		t.Fatalf("expected added=2, got %v", data["added"])
	}
}

func TestAddGroupMembers_NonFriendRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"user_ids": []string{testUser2}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/"+testConv1+"/members", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2 AND role = 'admin'\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM chat_members WHERE conversation_id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	// Not a friend → 403
	mock.ExpectQuery(`SELECT EXISTS\(.*SELECT 1 FROM friendships`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.AddGroupMembers(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestAddGroupMembers_GroupFull(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"user_ids": []string{testUser2}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/"+testConv1+"/members", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2 AND role = 'admin'\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	// Already at the 100-member cap → 400
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM chat_members WHERE conversation_id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(100))

	handler.AddGroupMembers(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestAddGroupMembers_AlreadyMembersSkipped(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"user_ids": []string{testUser2}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/"+testConv1+"/members", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2 AND role = 'admin'\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Already a member → skipped, nothing added
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	handler.AddGroupMembers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["added"] != float64(0) {
		t.Fatalf("expected added=0, got %v", data["added"])
	}
}

func TestAddGroupMembers_FriendCheckDBError(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"user_ids": []string{testUser2}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/"+testConv1+"/members", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2 AND role = 'admin'\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM chat_members WHERE conversation_id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	// Friendship query fails → 500, nothing inserted
	mock.ExpectQuery(`SELECT EXISTS\(.*SELECT 1 FROM friendships`).
		WithArgs(testUser1, testUser2).
		WillReturnError(sqlmock.ErrCancelled)

	handler.AddGroupMembers(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestAddGroupMembers_NotAdmin(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"user_ids": []string{testUser2}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/"+testConv1+"/members", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2 AND role = 'admin'\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.AddGroupMembers(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestAddGroupMembers_InvalidGroupID(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]interface{}{"user_ids": []string{testUser2}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/not-a-uuid/members", body, claims, map[string]string{"id": "not-a-uuid"})

	handler.AddGroupMembers(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestAddGroupMembers_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	body := map[string]interface{}{"user_ids": []string{testUser2}}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/groups/"+testConv1+"/members", body, nil, map[string]string{"id": testConv1})

	handler.AddGroupMembers(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
