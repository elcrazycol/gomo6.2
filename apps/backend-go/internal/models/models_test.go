package models

import (
	"database/sql/driver"
	"encoding/json"
	"testing"
	"time"
)

// =============================================================================
// JSONB tests
// =============================================================================

func TestJSONB_Value(t *testing.T) {
	j := JSONB{"hello", 42, true, nil, []interface{}{"nested"}}
	v, err := j.Value()
	if err != nil {
		t.Fatalf("JSONB.Value() failed: %v", err)
	}

	val, ok := v.(driver.Value)
	if !ok {
		t.Fatal("Value() must return driver.Value")
	}
	bytes, ok := val.([]byte)
	if !ok {
		t.Fatal("Value() must return []byte")
	}

	var decoded []interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("json.Unmarshal of Value result failed: %v", err)
	}
	if len(decoded) != 5 {
		t.Errorf("Expected 5 elements, got %d", len(decoded))
	}
}

func TestJSONB_Value_Nil(t *testing.T) {
	var j JSONB
	v, err := j.Value()
	if err != nil {
		t.Fatalf("JSONB.Value() for nil failed: %v", err)
	}

	val, ok := v.(driver.Value)
	if !ok {
		t.Fatal("Value() must return driver.Value")
	}
	bytes, ok := val.([]byte)
	if !ok {
		t.Fatal("Value() must return []byte")
	}

	if string(bytes) != "null" {
		t.Errorf("Expected 'null', got '%s'", string(bytes))
	}
}

func TestJSONB_Scan_Nil(t *testing.T) {
	var j JSONB
	if err := j.Scan(nil); err != nil {
		t.Fatalf("Scan(nil) failed: %v", err)
	}
	if j != nil {
		t.Error("Expected nil after Scan(nil)")
	}
}

func TestJSONB_Scan_ByteSlice(t *testing.T) {
	var j JSONB
	data := []byte(`["a", "b", "c"]`)
	if err := j.Scan(data); err != nil {
		t.Fatalf("Scan([]byte) failed: %v", err)
	}
	if len(j) != 3 {
		t.Errorf("Expected 3 elements, got %d", len(j))
	}
	if j[0] != "a" || j[1] != "b" || j[2] != "c" {
		t.Errorf("Unexpected values: %v", j)
	}
}

func TestJSONB_Scan_String(t *testing.T) {
	var j JSONB
	if err := j.Scan(`[1, 2, 3]`); err != nil {
		t.Fatalf("Scan(string) failed: %v", err)
	}
	if len(j) != 3 {
		t.Errorf("Expected 3 elements, got %d", len(j))
	}
}

func TestJSONB_Scan_InvalidType(t *testing.T) {
	var j JSONB
	if err := j.Scan(42); err == nil {
		t.Fatal("Expected error for Scan(int), got nil")
	}
}

func TestJSONB_Scan_InvalidJSON(t *testing.T) {
	var j JSONB
	if err := j.Scan([]byte(`{invalid`)); err == nil {
		t.Fatal("Expected error for invalid JSON")
	}
}

func TestJSONB_Scan_Nested(t *testing.T) {
	var j JSONB
	data := []byte(`[{"key": "value"}, [1,2,3], "simple"]`)
	if err := j.Scan(data); err != nil {
		t.Fatalf("Scan(nested) failed: %v", err)
	}
	if len(j) != 3 {
		t.Errorf("Expected 3 elements, got %d", len(j))
	}
	// First element is a map
	m, ok := j[0].(map[string]interface{})
	if !ok || m["key"] != "value" {
		t.Errorf("First element unexpected: %v", j[0])
	}
	// Second element is a slice
	s, ok := j[1].([]interface{})
	if !ok || len(s) != 3 {
		t.Errorf("Second element unexpected: %v", j[1])
	}
}

func TestJSONB_ValueScanRoundTrip(t *testing.T) {
	original := JSONB{"test", 123.0, true, nil} // no []interface{} — raw JSON []interface{} are uncomparable

	// Value
	v, err := original.Value()
	if err != nil {
		t.Fatalf("Value() failed: %v", err)
	}

	// Scan back
	var decoded JSONB
	if err := decoded.Scan(v); err != nil {
		t.Fatalf("Scan() failed: %v", err)
	}

	if len(original) != len(decoded) {
		t.Fatalf("Length mismatch: %d vs %d", len(original), len(decoded))
	}

	// Check each element (skip map/slice elements since they're uncomparable)
	for i := range original {
		switch orig := original[i].(type) {
		case string:
			if dec, ok := decoded[i].(string); ok && orig != dec {
				t.Errorf("element %d: expected %v, got %v", i, orig, decoded[i])
			}
		case float64:
			if dec, ok := decoded[i].(float64); ok && orig != dec {
				t.Errorf("element %d: expected %v, got %v", i, orig, decoded[i])
			}
		case bool:
			if dec, ok := decoded[i].(bool); ok && orig != dec {
				t.Errorf("element %d: expected %v, got %v", i, orig, decoded[i])
			}
		}
	}
}

// =============================================================================
// APIResponse tests
// =============================================================================

func TestSuccessResponse(t *testing.T) {
	resp := SuccessResponse("hello")
	if !resp.Success {
		t.Error("Expected Success=true")
	}
	if resp.Data != "hello" {
		t.Errorf("Expected Data='hello', got %v", resp.Data)
	}
	if resp.Error != nil {
		t.Errorf("Expected Error=nil, got %v", *resp.Error)
	}
	if resp.Count != nil {
		t.Errorf("Expected Count=nil, got %d", *resp.Count)
	}
}

func TestSuccessResponse_NilData(t *testing.T) {
	resp := SuccessResponse(nil)
	if !resp.Success {
		t.Error("Expected Success=true")
	}
	if resp.Data != nil {
		t.Errorf("Expected Data=nil, got %v", resp.Data)
	}
}

func TestSuccessResponseWithCount(t *testing.T) {
	resp := SuccessResponseWithCount([]string{"a", "b", "c"}, 42)
	if !resp.Success {
		t.Error("Expected Success=true")
	}
	if resp.Count == nil {
		t.Fatal("Expected non-nil Count")
	}
	if *resp.Count != 42 {
		t.Errorf("Expected Count=42, got %d", *resp.Count)
	}
	data, ok := resp.Data.([]string)
	if !ok || len(data) != 3 {
		t.Errorf("Unexpected data: %v", resp.Data)
	}
}

func TestSuccessResponseWithCount_Zero(t *testing.T) {
	resp := SuccessResponseWithCount(nil, 0)
	if resp.Count == nil {
		t.Fatal("Expected non-nil Count")
	}
	if *resp.Count != 0 {
		t.Errorf("Expected Count=0, got %d", *resp.Count)
	}
}

func TestErrorResponse(t *testing.T) {
	errMsg := "something went wrong"
	resp := ErrorResponse(errMsg)
	if resp.Success {
		t.Error("Expected Success=false")
	}
	if resp.Error == nil {
		t.Fatal("Expected non-nil Error")
	}
	if *resp.Error != errMsg {
		t.Errorf("Expected Error=%q, got %q", errMsg, *resp.Error)
	}
	if resp.Data != nil {
		t.Errorf("Expected Data=nil, got %v", resp.Data)
	}
}

func TestErrorResponse_EmptyString(t *testing.T) {
	resp := ErrorResponse("")
	if resp.Error == nil {
		t.Fatal("Expected non-nil Error for empty string")
	}
	if *resp.Error != "" {
		t.Errorf("Expected empty error, got %q", *resp.Error)
	}
}

func TestAPIResponse_JSONMarshal(t *testing.T) {
	resp := SuccessResponse(map[string]int{"count": 10})
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var decoded APIResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if !decoded.Success {
		t.Error("Expected Success=true after round-trip")
	}
}

// =============================================================================
// User tests
// =============================================================================

func TestUser_Defaults(t *testing.T) {
	u := User{
		ID:       "user-1",
		Username: "testuser",
		Email:    "test@example.com",
	}
	if u.ID != "user-1" {
		t.Errorf("Expected ID 'user-1', got '%s'", u.ID)
	}
	if u.IsRemote || u.IsAnonymous {
		t.Error("Expected IsRemote and IsAnonymous to be false by default")
	}
	if u.AvatarURL != nil {
		t.Error("Expected AvatarURL to be nil by default")
	}
}

func TestUser_AvatarURL(t *testing.T) {
	url := "https://example.com/avatar.png"
	u := User{
		ID:        "user-2",
		Username:  "picuser",
		AvatarURL: &url,
	}
	if u.AvatarURL == nil || *u.AvatarURL != url {
		t.Errorf("Expected AvatarURL=%q, got %v", url, u.AvatarURL)
	}
}

func TestUser_WithTimestamps(t *testing.T) {
	now := time.Now()
	u := User{
		ID:        "user-3",
		Username:  "timeuser",
		LastSeen:  &now,
		CreatedAt: now,
	}
	if u.LastSeen == nil || !u.LastSeen.Equal(now) {
		t.Error("LastSeen timestamp mismatch")
	}
	if !u.CreatedAt.Equal(now) {
		t.Error("CreatedAt timestamp mismatch")
	}
}

func TestUser_JSONTag(t *testing.T) {
	u := User{ID: "u1", Username: "alice"}
	data, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var decoded map[string]interface{}
	json.Unmarshal(data, &decoded)

	if decoded["id"] != "u1" {
		t.Errorf("Expected json key 'id', got %v", decoded["id"])
	}
	if decoded["username"] != "alice" {
		t.Errorf("Expected json key 'username', got %v", decoded["username"])
	}
}

// =============================================================================
// Board tests
// =============================================================================

func TestBoard_Gomosub(t *testing.T) {
	b := Board{
		ID:        "board-1",
		Slug:      "test-board",
		Name:      "Test Board",
		IsGomosub: true,
	}
	if !b.IsGomosub {
		t.Error("Expected IsGomosub=true")
	}
	if b.GomosubTags != nil {
		t.Error("Expected GomosubTags to be nil initially")
	}
}

func TestBoard_WithTags(t *testing.T) {
	b := Board{
		ID:          "board-2",
		Slug:        "tech",
		Name:        "Technology",
		GomosubTags: JSONB{"golang", "rust", "web"},
	}
	if len(b.GomosubTags) != 3 {
		t.Errorf("Expected 3 tags, got %d", len(b.GomosubTags))
	}
}

// =============================================================================
// Thread tests
// =============================================================================

func TestThread_Defaults(t *testing.T) {
	now := time.Now()
	th := Thread{
		ID:        "thread-1",
		BoardID:   "board-1",
		Title:     "Test Thread",
		Content:   "Hello world",
		CreatedAt: now,
		UpdatedAt: now,
	}
	if th.ServerDomain != "" {
		t.Errorf("Expected empty ServerDomain, got '%s'", th.ServerDomain)
	}
	if th.PostCount != 0 {
		t.Errorf("Expected PostCount=0, got %d", th.PostCount)
	}
	if th.IsRemote {
		t.Error("Expected IsRemote=false")
	}
}

func TestThread_ContentJSON(t *testing.T) {
	contentJSON := json.RawMessage(`{"type":"doc","content":[]}`)
	th := Thread{
		ID:          "thread-2",
		BoardID:     "board-1",
		Title:       "Rich thread",
		ContentJSON: contentJSON,
	}
	if th.ContentJSON == nil {
		t.Fatal("Expected non-nil ContentJSON")
	}
}

func TestThread_ImageURLs(t *testing.T) {
	th := Thread{
		ID:        "thread-3",
		BoardID:   "board-1",
		Title:     "Pics",
		ImageURLs: JSONB{"https://example.com/1.jpg", "https://example.com/2.jpg"},
	}
	if len(th.ImageURLs) != 2 {
		t.Errorf("Expected 2 image URLs, got %d", len(th.ImageURLs))
	}
}

// =============================================================================
// Post tests
// =============================================================================

func TestPost_ReplyTo(t *testing.T) {
	replyTo := "parent-post-1"
	p := Post{
		ID:       "post-1",
		ThreadID: "thread-1",
		Content:  "Reply content",
		ReplyTo:  &replyTo,
	}
	if p.ReplyTo == nil || *p.ReplyTo != "parent-post-1" {
		t.Errorf("Expected ReplyTo='parent-post-1', got %v", p.ReplyTo)
	}
}

func TestPost_Private(t *testing.T) {
	recipientID := "user-42"
	p := Post{
		ID:                 "post-private",
		ThreadID:           "thread-1",
		Content:            "Private message",
		IsPrivate:          true,
		PrivateRecipientID: &recipientID,
	}
	if !p.IsPrivate {
		t.Error("Expected IsPrivate=true")
	}
	if p.PrivateRecipientID == nil || *p.PrivateRecipientID != "user-42" {
		t.Errorf("Expected recipient user-42, got %v", p.PrivateRecipientID)
	}
}

// =============================================================================
// Like tests
// =============================================================================

func TestPostLike(t *testing.T) {
	now := time.Now()
	pl := PostLike{
		ID:        "like-1",
		PostID:    "post-1",
		UserID:    "user-1",
		CreatedAt: now,
	}
	if pl.ID != "like-1" || pl.PostID != "post-1" || pl.UserID != "user-1" {
		t.Error("PostLike field assignment mismatch")
	}
}

func TestThreadLike(t *testing.T) {
	tl := ThreadLike{
		ID:       "tlike-1",
		ThreadID: "thread-1",
		UserID:   "user-1",
	}
	if tl.ID != "tlike-1" {
		t.Error("ThreadLike field assignment mismatch")
	}
}

// =============================================================================
// Notification tests
// =============================================================================

func TestNotification(t *testing.T) {
	threadID := "thread-1"
	postID := "post-1"
	n := Notification{
		ID:              "notif-1",
		UserID:          "user-1",
		Type:            "reply",
		Title:           "New reply",
		Message:         "Someone replied to your post",
		RelatedThreadID: &threadID,
		RelatedPostID:   &postID,
		IsRead:          false,
	}
	if n.IsRead {
		t.Error("Expected IsRead=false")
	}
	if n.RelatedThreadID == nil || *n.RelatedThreadID != "thread-1" {
		t.Errorf("Expected thread_id 'thread-1', got %v", n.RelatedThreadID)
	}
}

func TestNotification_Read(t *testing.T) {
	n := Notification{
		ID:     "notif-2",
		UserID: "user-1",
		Type:   "like",
		Title:  "Someone liked your post",
		IsRead: true,
	}
	if !n.IsRead {
		t.Error("Expected IsRead=true")
	}
}

// =============================================================================
// Request types tests
// =============================================================================

func TestCreateThreadRequest(t *testing.T) {
	req := CreateThreadRequest{
		BoardID:   "board-1",
		Title:     "New Thread",
		Content:   "Thread content",
		ImageURLs: []string{"https://example.com/img.jpg"},
	}
	if req.BoardID != "board-1" || req.Title != "New Thread" {
		t.Errorf("CreateThreadRequest fields mismatch: %+v", req)
	}
	if len(req.ImageURLs) != 1 {
		t.Errorf("Expected 1 image URL, got %d", len(req.ImageURLs))
	}
}

func TestCreateThreadRequest_WithPoll(t *testing.T) {
	req := CreateThreadRequest{
		BoardID: "board-1",
		Title:   "Poll Thread",
		Content: "Vote now",
		Poll: &PollRequest{
			Question: "Best language?",
			Options: []PollOption{
				{ID: "opt-1", Text: "Go"},
				{ID: "opt-2", Text: "Rust"},
			},
			AllowMultiple: false,
		},
	}
	if req.Poll == nil {
		t.Fatal("Expected non-nil Poll")
	}
	if len(req.Poll.Options) != 2 {
		t.Errorf("Expected 2 poll options, got %d", len(req.Poll.Options))
	}
	if req.Poll.AllowMultiple {
		t.Error("Expected AllowMultiple=false")
	}
}

func TestCreatePostRequest(t *testing.T) {
	replyTo := "parent-1"
	req := CreatePostRequest{
		ThreadID:  "thread-1",
		Content:   "Post content",
		ImageURLs: []string{"img1.jpg", "img2.jpg"},
		ReplyTo:   &replyTo,
	}
	if req.ThreadID != "thread-1" {
		t.Errorf("Expected ThreadID 'thread-1', got '%s'", req.ThreadID)
	}
	if req.ReplyTo == nil || *req.ReplyTo != "parent-1" {
		t.Errorf("Expected ReplyTo 'parent-1', got %v", req.ReplyTo)
	}
}

func TestCreatePostRequest_Private(t *testing.T) {
	recipient := "user-42"
	req := CreatePostRequest{
		ThreadID:          "thread-1",
		Content:           "Private reply",
		IsPrivate:         true,
		PrivateRecipientID: &recipient,
	}
	if !req.IsPrivate {
		t.Error("Expected IsPrivate=true")
	}
}

func TestPollRequest_AllOptions(t *testing.T) {
	pr := PollRequest{
		Question:        "Q?",
		Options:         []PollOption{{ID: "1", Text: "A"}, {ID: "2", Text: "B"}},
		AllowMultiple:   true,
		ShowResults:     true,
		AllowChangeVote: true,
	}
	if !pr.AllowMultiple || !pr.ShowResults || !pr.AllowChangeVote {
		t.Error("Poll options mismatch")
	}
}

// =============================================================================
// Bot model tests
// =============================================================================

func TestBot(t *testing.T) {
	b := Bot{
		ID:          "bot-1",
		OwnerID:     "user-1",
		Username:    "helper-bot",
		DisplayName: "Helper Bot",
		LuaCode:     "print('hello')",
		Token:       "secret-token",
		IsActive:    true,
	}
	if !b.IsActive {
		t.Error("Expected IsActive=true")
	}
	if b.Username != "helper-bot" || b.DisplayName != "Helper Bot" {
		t.Errorf("Bot fields mismatch: %+v", b)
	}
}

func TestBotLog(t *testing.T) {
	now := time.Now()
	bl := BotLog{
		ID:        "log-1",
		BotID:     "bot-1",
		Level:     "error",
		Message:   "Something failed",
		CreatedAt: now,
	}
	if bl.Level != "error" || bl.Message != "Something failed" {
		t.Errorf("BotLog fields mismatch: %+v", bl)
	}
}

func TestBotStats(t *testing.T) {
	bs := BotStats{
		ID:                "stats-1",
		BotID:             "bot-1",
		MessagesSent:      100,
		MessagesReceived:  200,
		CommandsProcessed: 50,
		ErrorsCount:       5,
	}
	if bs.MessagesSent != 100 || bs.ErrorsCount != 5 {
		t.Errorf("BotStats fields mismatch: %+v", bs)
	}
}

// =============================================================================
// Federation model tests
// =============================================================================

func TestServerInfo(t *testing.T) {
	now := time.Now()
	si := ServerInfo{
		Domain:   "example.com",
		Name:     "Example Server",
		Version:  "1.0.0",
		LastSeen: now,
		IsOnline: true,
	}
	if si.Domain != "example.com" || !si.IsOnline {
		t.Errorf("ServerInfo fields mismatch: %+v", si)
	}
}

// =============================================================================
// BoardInfo / ThreadWithBoards tests
// =============================================================================

func TestBoardInfo(t *testing.T) {
	bi := BoardInfo{
		Slug:         "tech",
		Name:         "Technology",
		IsGomosub:    false,
		IsRulesBoard: false,
	}
	if bi.Slug != "tech" || bi.Name != "Technology" {
		t.Errorf("BoardInfo fields mismatch: %+v", bi)
	}
}

func TestThreadWithBoards(t *testing.T) {
	twb := ThreadWithBoards{
		ID:      "thread-wb-1",
		BoardID: "board-1",
		Title:   "Thread with Board Info",
		Content: "Content here",
		Username: "author",
		Boards: BoardInfo{
			Slug: "board-slug",
			Name: "Board Name",
		},
	}
	if twb.Username != "author" || twb.Boards.Slug != "board-slug" {
		t.Errorf("ThreadWithBoards fields mismatch: %+v", twb)
	}
}

// =============================================================================
// Bot request types tests
// =============================================================================

func TestCreateBotRequest(t *testing.T) {
	desc := "A helpful bot"
	req := CreateBotRequest{
		Username:    "my-bot",
		DisplayName: "My Bot",
		Description: &desc,
		LuaCode:     "print('hi')",
	}
	if req.Username != "my-bot" || req.DisplayName != "My Bot" {
		t.Errorf("CreateBotRequest fields mismatch: %+v", req)
	}
	if req.Description == nil || *req.Description != "A helpful bot" {
		t.Errorf("Description mismatch: %v", req.Description)
	}
}

func TestUpdateBotRequest(t *testing.T) {
	active := true
	name := "Updated Bot"
	req := UpdateBotRequest{
		DisplayName: &name,
		IsActive:    &active,
	}
	if req.DisplayName == nil || *req.DisplayName != "Updated Bot" {
		t.Errorf("DisplayName mismatch")
	}
	if req.IsActive == nil || !*req.IsActive {
		t.Errorf("IsActive mismatch")
	}
}

func TestUpdateBotRequest_PartialUpdate(t *testing.T) {
	req := UpdateBotRequest{
		IsActive: boolPtr(false),
	}
	if req.DisplayName != nil {
		t.Error("Expected DisplayName=nil for partial update")
	}
	if req.LuaCode != nil {
		t.Error("Expected LuaCode=nil for partial update")
	}
	if req.IsActive == nil || *req.IsActive {
		t.Error("Expected IsActive=false")
	}
}

// =============================================================================
// Register/Login request tests
// =============================================================================

func TestRegisterRequest(t *testing.T) {
	req := RegisterRequest{
		Username: "newuser",
		Email:    "new@example.com",
		Password: "secure-password",
	}
	if req.Username != "newuser" || req.Email != "new@example.com" {
		t.Errorf("RegisterRequest fields mismatch")
	}
}

func TestLoginRequest(t *testing.T) {
	req := LoginRequest{
		Email:    "test@example.com",
		Password: "secret",
	}
	if req.Email != "test@example.com" || req.Password != "secret" {
		t.Errorf("LoginRequest fields mismatch")
	}
}

// helpers
func boolPtr(b bool) *bool {
	return &b
}
