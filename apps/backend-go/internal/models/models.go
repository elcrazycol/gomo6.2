package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// JSONB type for PostgreSQL
type JSONB []interface{}

func (j JSONB) Value() (driver.Value, error) {
	return json.Marshal(j)
}

func (j *JSONB) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, j)
	case string:
		return json.Unmarshal([]byte(v), j)
	default:
		return errors.New("cannot scan into JSONB")
	}
}

// User with federation support
type User struct {
	ID          string          `json:"id" db:"id"`
	Username    string          `json:"username" db:"username"`
	Email       string          `json:"email" db:"email"`
	Domain      string          `json:"domain" db:"domain"`
	AvatarURL   *string         `json:"avatar_url" db:"avatar_url"`
	Bio         *string         `json:"bio" db:"bio"`
	BioJSON     json.RawMessage `json:"bio_json,omitempty" db:"bio_json"`
	Garma       *int            `json:"garma" db:"garma"`
	PostCount   *int            `json:"post_count" db:"post_count"`
	ThreadCount *int            `json:"thread_count" db:"thread_count"`
	IsOnline    bool            `json:"is_online" db:"is_online"`
	LastSeen    *time.Time      `json:"last_seen,omitempty" db:"last_seen_at"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
	IsRemote    bool            `json:"is_remote" db:"is_remote"`
	IsAnonymous bool            `json:"is_anonymous" db:"is_anonymous"`
}

// Board (local boards)
type Board struct {
	ID               string     `json:"id" db:"id"`
	Slug             string     `json:"slug" db:"slug"`
	Name             string     `json:"name" db:"name"`
	Description      *string    `json:"description" db:"description"`
	IsGomosub        bool       `json:"is_gomosub" db:"is_gomosub"`
	IsRulesBoard     bool       `json:"is_rules_board" db:"is_rules_board"`
	OwnerID          *string    `json:"owner_id" db:"owner_id"`
	GomosubAvatarURL *string    `json:"gomosub_avatar_url" db:"gomosub_avatar_url"`
	CoverImageURL    *string    `json:"cover_image_url" db:"cover_image_url"`
	GomosubTags      JSONB      `json:"gomosub_tags" db:"gomosub_tags"`
	RulesMarkdown    *string    `json:"rules_markdown" db:"rules_markdown"`
	RulesUpdatedAt   *time.Time `json:"rules_updated_at" db:"rules_updated_at"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
}

// GomoSub (global communities)
type GomoSub struct {
	ID            string    `json:"id" db:"id"`
	Slug          string    `json:"slug" db:"slug"`
	Name          string    `json:"name" db:"name"`
	Description   *string   `json:"description" db:"description"`
	ServerDomain  string    `json:"server_domain" db:"server_domain"`
	OwnerID       string    `json:"owner_id" db:"owner_id"`
	AvatarURL     *string   `json:"avatar_url" db:"avatar_url"`
	CoverImageURL *string   `json:"cover_image_url" db:"cover_image_url"`
	Tags          JSONB     `json:"tags" db:"tags"`
	IsRemote      bool      `json:"is_remote" db:"is_remote"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// Thread with federation support
type Thread struct {
	ID           string          `json:"id" db:"id"`
	BoardID      string          `json:"board_id" db:"board_id"`
	UserID       *string         `json:"user_id" db:"user_id"`
	Title        string          `json:"title" db:"title"`
	Content      string          `json:"content" db:"content"`
	ContentJSON  json.RawMessage `json:"content_json" db:"content_json"`
	ImageURL     *string         `json:"image_url" db:"image_url"`
	ImageURLs    JSONB           `json:"image_urls" db:"image_urls"`
	Attachments  JSONB           `json:"attachments" db:"attachments"` // Added for full attachment support
	PostCount    int             `json:"post_count" db:"post_count"`
	ServerDomain string          `json:"server_domain" db:"server_domain"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at" db:"updated_at"`
	IsRemote     bool            `json:"is_remote" db:"is_remote"`
}

// ThreadWithBoards extends Thread with board information for frontend compatibility
type ThreadWithBoards struct {
	ID           string          `json:"id" db:"id"`
	BoardID      string          `json:"board_id" db:"board_id"`
	UserID       *string         `json:"user_id" db:"user_id"`
	Title        string          `json:"title" db:"title"`
	Content      string          `json:"content" db:"content"`
	ContentJSON  json.RawMessage `json:"content_json" db:"content_json"`
	ImageURL     *string         `json:"image_url" db:"image_url"`
	ImageURLs    JSONB           `json:"image_urls" db:"image_urls"`
	Attachments  JSONB           `json:"attachments" db:"attachments"` // Added for full attachment support
	Tags         json.RawMessage `json:"tags" db:"tags"`
	PostCount    int             `json:"post_count" db:"post_count"`
	ServerDomain string          `json:"server_domain" db:"server_domain"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at" db:"updated_at"`
	IsRemote     bool            `json:"is_remote" db:"is_remote"`
	Username     string          `json:"username"`
	AvatarURL    *string         `json:"avatar_url"`
	Boards       BoardInfo       `json:"boards"`
}

type BoardInfo struct {
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	IsGomosub    bool   `json:"is_gomosub"`
	IsRulesBoard bool   `json:"is_rules_board"`
}

// Post with federation support
type Post struct {
	ID                 string          `json:"id" db:"id"`
	ThreadID           string          `json:"thread_id" db:"thread_id"`
	UserID             *string         `json:"user_id" db:"user_id"`
	Content            string          `json:"content" db:"content"`
	ContentJSON        json.RawMessage `json:"content_json" db:"content_json"`
	ImageURL           *string         `json:"image_url" db:"image_url"`
	ImageURLs          JSONB           `json:"image_urls" db:"image_urls"`
	Attachments        JSONB           `json:"attachments" db:"attachments"`
	ReplyTo            *string         `json:"reply_to" db:"reply_to"`
	IsPrivate          bool            `json:"is_private" db:"is_private"`
	PrivateRecipientID *string         `json:"private_recipient_id" db:"private_recipient_id"`
	ServerDomain       string          `json:"server_domain" db:"server_domain"`
	CreatedAt          time.Time       `json:"created_at" db:"created_at"`
	IsRemote           bool            `json:"is_remote" db:"is_remote"`
	Username           string          `json:"username"`
	AvatarURL          *string         `json:"avatar_url"`
}

// PostLike
type PostLike struct {
	ID        string    `json:"id" db:"id"`
	PostID    string    `json:"post_id" db:"post_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// ThreadLike
type ThreadLike struct {
	ID        string    `json:"id" db:"id"`
	ThreadID  string    `json:"thread_id" db:"thread_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// Notification
type Notification struct {
	ID              string     `json:"id" db:"id"`
	UserID          string     `json:"user_id" db:"user_id"`
	Type            string     `json:"type" db:"type"`
	Title           string     `json:"title" db:"title"`
	Message         string     `json:"message" db:"message"`
	RelatedThreadID *string    `json:"related_thread_id" db:"related_thread_id"`
	RelatedPostID   *string    `json:"related_post_id" db:"related_post_id"`
	IsRead          bool       `json:"is_read" db:"is_read"`
	CreatedAt       *time.Time `json:"created_at" db:"created_at"`
}

// Achievement
type Achievement struct {
	ID          string     `json:"id" db:"id"`
	Name        string     `json:"name" db:"name"`
	Description string     `json:"description" db:"description"`
	Category    string     `json:"category" db:"category"`
	Icon        *string    `json:"icon" db:"icon"`
	RewardType  *string    `json:"reward_type" db:"reward_type"`
	RewardValue *string    `json:"reward_value" db:"reward_value"`
	CreatedAt   *time.Time `json:"created_at" db:"created_at"`
}

// UserAchievement
type UserAchievement struct {
	ID            string     `json:"id" db:"id"`
	UserID        string     `json:"user_id" db:"user_id"`
	AchievementID string     `json:"achievement_id" db:"achievement_id"`
	UnlockedAt    *time.Time `json:"unlocked_at" db:"unlocked_at"`
}

// Federation server info
type ServerInfo struct {
	Domain   string    `json:"domain"`
	Name     string    `json:"name"`
	Version  string    `json:"version"`
	LastSeen time.Time `json:"last_seen"`
	IsOnline bool      `json:"is_online"`
}

// Federation request/response types
type FederationAuth struct {
	Timestamp int64  `json:"timestamp"`
	Domain    string `json:"domain"`
	Signature string `json:"signature"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *string     `json:"error,omitempty"`
	Count   *int        `json:"count,omitempty"`
}

// SuccessResponse builds a successful APIResponse.
func SuccessResponse(data interface{}) APIResponse {
	return APIResponse{Success: true, Data: data}
}

// SuccessResponseWithCount builds a successful response with a Count field.
func SuccessResponseWithCount(data interface{}, count int) APIResponse {
	return APIResponse{Success: true, Data: data, Count: &count}
}

// ErrorResponse builds an error APIResponse.
func ErrorResponse(err string) APIResponse {
	return APIResponse{Success: false, Error: &err}
}

// Request types for API
type CreateThreadRequest struct {
	BoardID           string          `json:"board_id"`
	Title             string          `json:"title"`
	Content           string          `json:"content"`
	ContentJSON       json.RawMessage `json:"content_json,omitempty"`
	ImageURLs         []string        `json:"image_urls"`
	Attachments       JSONB           `json:"attachments,omitempty"` // Added for full attachment support
	BoardServerDomain string          `json:"board_server_domain,omitempty"`
}

type CreatePostRequest struct {
	ThreadID           string          `json:"thread_id"`
	Content            string          `json:"content"`
	ContentJSON        json.RawMessage `json:"content_json,omitempty"`
	ImageURLs          []string        `json:"image_urls"`
	Attachments        JSONB           `json:"attachments,omitempty"`
	ReplyTo            *string         `json:"reply_to,omitempty"`
	IsPrivate          bool            `json:"is_private"`
	PrivateRecipientID *string         `json:"private_recipient_id,omitempty"`
	ThreadServerDomain string          `json:"thread_server_domain,omitempty"`
}

type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Bot models
type Bot struct {
	ID          string    `json:"id" db:"id"`
	OwnerID     string    `json:"owner_id" db:"owner_id"`
	Username    string    `json:"username" db:"username"`
	DisplayName string    `json:"display_name" db:"display_name"`
	AvatarURL   *string   `json:"avatar_url" db:"avatar_url"`
	Description *string   `json:"description" db:"description"`
	LuaCode     string    `json:"lua_code" db:"lua_code"`
	Token       string    `json:"token" db:"token"`
	IsActive    bool      `json:"is_active" db:"is_active"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type BotLog struct {
	ID        string          `json:"id" db:"id"`
	BotID     string          `json:"bot_id" db:"bot_id"`
	Level     string          `json:"level" db:"level"`
	Message   string          `json:"message" db:"message"`
	Context   json.RawMessage `json:"context" db:"context"`
	CreatedAt time.Time       `json:"created_at" db:"created_at"`
}

type BotStats struct {
	ID                string    `json:"id" db:"id"`
	BotID             string    `json:"bot_id" db:"bot_id"`
	MessagesSent      int       `json:"messages_sent" db:"messages_sent"`
	MessagesReceived  int       `json:"messages_received" db:"messages_received"`
	CommandsProcessed int       `json:"commands_processed" db:"commands_processed"`
	ErrorsCount       int       `json:"errors_count" db:"errors_count"`
	Date              time.Time `json:"date" db:"date"`
}

// Bot request types
type CreateBotRequest struct {
	Username    string  `json:"username" binding:"required,min=3,max=50"`
	DisplayName string  `json:"display_name" binding:"required,min=1,max=100"`
	AvatarURL   *string `json:"avatar_url"`
	Description *string `json:"description"`
	LuaCode     string  `json:"lua_code"`
}

type UpdateBotRequest struct {
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	Description *string `json:"description"`
	LuaCode     *string `json:"lua_code"`
	IsActive    *bool   `json:"is_active"`
}
