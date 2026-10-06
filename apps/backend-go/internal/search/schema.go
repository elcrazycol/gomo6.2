package search

// Logical index keys used by the application. The physical Meilisearch index
// UID is prefixed by Service.IndexUID so several deployments can share one
// engine without colliding.
const (
	IndexUsers     = "users"
	IndexBoards    = "boards"
	IndexThreads   = "threads"
	IndexPosts     = "posts"
	IndexWallPosts = "wall_posts"
)

// VisibilityPublic is the boards.visibility value for boards whose content may
// be indexed. See privacy.go for the rules that depend on it.
const VisibilityPublic = "public"

// indexSchema describes one search index: its primary key and the attributes
// Meilisearch must know about ahead of time. Filterable/sortable attributes
// cannot be set implicitly — documents carrying undeclared fields are rejected
// at index time — so this list is the contract shared by the reindexer and (in
// a later phase) the write-path sync.
type indexSchema struct {
	key        string
	primaryKey string
	searchable []string
	filterable []string
	sortable   []string
}

func indexSchemas() []indexSchema {
	return []indexSchema{
		{
			key:        IndexUsers,
			primaryKey: "id",
			searchable: []string{"username", "display_name"},
			// public_id is filterable so an exact profile lookup can bypass the
			// search term; created_at backs the `since` filter. is_remote keeps a
			// future remote-user index possible.
			filterable: []string{"public_id", "is_remote", "created_at"},
			sortable:   []string{"created_at"},
		},
		{
			key:        IndexBoards,
			primaryKey: "id",
			searchable: []string{"name", "slug", "description"},
			// created_at backs the `since` filter (applied to every category).
			filterable: []string{"is_gomosub", "created_at"},
			sortable:   []string{"created_at"},
		},
		{
			key:        IndexThreads,
			primaryKey: "id",
			searchable: []string{"title", "content", "author_username", "board_name"},
			filterable: []string{
				"board_id", "board_slug", "board_is_gomosub", "board_visibility",
				"author_id", "created_at", "updated_at",
			},
			sortable: []string{"created_at", "updated_at"},
		},
		{
			key:        IndexPosts,
			primaryKey: "id",
			searchable: []string{"content", "author_username", "thread_title", "board_name"},
			filterable: []string{
				"thread_id", "board_id", "board_slug", "board_is_gomosub",
				"board_visibility", "author_id", "created_at",
			},
			sortable: []string{"created_at"},
		},
		{
			key:        IndexWallPosts,
			primaryKey: "id",
			searchable: []string{"title", "content", "author_username", "wall_username"},
			filterable: []string{
				"author_id", "wall_user_id", "wall_visibility", "created_at", "updated_at",
			},
			sortable: []string{"created_at", "updated_at"},
		},
	}
}

// UserDoc is the index representation of a users row.
type UserDoc struct {
	ID          string `json:"id"`
	PublicID    *int64 `json:"public_id,omitempty"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	IsRemote    bool   `json:"is_remote"`
	CreatedAt   int64  `json:"created_at"`
}

// BoardDoc is the index representation of a boards row.
type BoardDoc struct {
	ID            string `json:"id"`
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	CoverImageURL string `json:"cover_image_url,omitempty"`
	IsGomosub     bool   `json:"is_gomosub"`
	CreatedAt     int64  `json:"created_at"`
}

// ThreadDoc is the index representation of a threads row (denormalised with the
// board and author fields the UI renders in a result list).
type ThreadDoc struct {
	ID              string `json:"id"`
	PublicID        *int64 `json:"public_id,omitempty"`
	Title           string `json:"title"`
	Content         string `json:"content"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
	BoardID         string `json:"board_id"`
	BoardSlug       string `json:"board_slug"`
	BoardName       string `json:"board_name"`
	BoardIsGomosub  bool   `json:"board_is_gomosub"`
	BoardVisibility string `json:"board_visibility"`
	AuthorID        string `json:"author_id,omitempty"`
	AuthorUsername  string `json:"author_username,omitempty"`
	AuthorAvatarURL string `json:"author_avatar_url,omitempty"`
}

// PostDoc is the index representation of a posts row.
type PostDoc struct {
	ID              string `json:"id"`
	Content         string `json:"content"`
	CreatedAt       int64  `json:"created_at"`
	ThreadID        string `json:"thread_id"`
	ThreadPublicID  *int64 `json:"thread_public_id,omitempty"`
	ThreadTitle     string `json:"thread_title"`
	BoardID         string `json:"board_id"`
	BoardSlug       string `json:"board_slug"`
	BoardName       string `json:"board_name"`
	BoardIsGomosub  bool   `json:"board_is_gomosub"`
	BoardVisibility string `json:"board_visibility"`
	AuthorID        string `json:"author_id,omitempty"`
	AuthorUsername  string `json:"author_username,omitempty"`
	AuthorAvatarURL string `json:"author_avatar_url,omitempty"`
}

// WallPostDoc is the index representation of a profile_wall_posts row. It is
// denormalised with the author and wall-owner usernames so a result renders
// without joins. Only posts on publicly visible walls are indexed — see the
// base query and the wall visibility predicate.
type WallPostDoc struct {
	ID             string `json:"id"`
	PublicID       *int64 `json:"public_id,omitempty"`
	Title          string `json:"title,omitempty"`
	Content        string `json:"content"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at"`
	AuthorID       string `json:"author_id,omitempty"`
	AuthorUsername string `json:"author_username,omitempty"`
	WallUserID     string `json:"wall_user_id,omitempty"`
	WallUsername   string `json:"wall_username,omitempty"`
	WallVisibility string `json:"wall_visibility"`
}
