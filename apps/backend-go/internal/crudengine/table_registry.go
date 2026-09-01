package crudengine

import (
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/profiles"
)

// ─── Table Registry ─────────────────────────────────────────────────────────
//
// The generic CRUD surface (Engine.HandleTableRequest + the
// generic CRUD routes) serves ~30 tables. Every fact the surface knows about a
// table — whether it is routable, which middleware group serves reads and
// writes, which methods are registered, which columns a client may write, how
// rows are scoped to the caller, and how reads are visibility-gated — used to
// live in ~8 separate switch statements:
//
//   - routes.go         : per-table route registrations across 3 groups
//   - allowedTables     : the handler's allow-list (engine.go)
//   - genericReadDeniedTable / genericWriteDeniedTable (engine.go)
//   - writableColumnsForTable (engine.go)
//   - genericReadScopeUser (engine.go)
//   - isGomosubManagementTable (engine.go)
//   - genericGomosubVisibility / genericEmojiVisibility (engine.go)
//   - upsertInsertQuery gating (crud.go)
//   - invalidateCacheForTableResult (crud.go): the per-table cache
//     invalidation switch — now TableMeta.InvalidateCache, a hook referenced
//     here and implemented in table_hooks.go
//   - emitAchievementEvents (achievement_emit.go): the per-table
//     achievement switch — now TableMeta.EmitAchievements (same file)
//   - the inline per-table branch blocks of handlePost/handlePut/handleDelete
//     (crud.go): body guards (emoji/gomosub/wall), the upsert statement
//     switch (upsertInsertQuery), the wall side-effect chains (notifications,
//     WebSocket, stats, dependent caches) and the wall-comment soft delete —
//     now TableMeta.PrepareBody / BuildUpsert / AfterWrite / SoftDeleteSQL /
//     EnrichedResponse (table_write_hooks.go)
//
// Adding a table required touching all of them, and a missed one silently
// broke an endpoint ("GET-only routes made Gin return 404" — the recurring
// bug) or served stale data (missing cache invalidation — the other
// recurring bug). This file is the single source of truth: the routes are
// generated from it (registerGenericTableRoutes in routes.go) and every
// switch above now consults it. Adding a table = adding one entry here,
// including its cache-invalidation and achievement hooks (table_hooks.go) if
// the write needs them.

// TableReadAccess selects the middleware group a table's generic GET route is
// registered on.
type TableReadAccess int

const (
	// NoRead: no generic GET route is registered for this table.
	NoRead TableReadAccess = iota
	// GuestRead: GET is registered on the OptionalAuth `rest` group (guests
	// allowed, viewer-keyed data cache, global rate limiter).
	GuestRead
	// ProtectedRead: GET is registered behind AuthCacheMiddleware + CSRF.
	ProtectedRead
)

// TableWriteGroup selects the middleware group a table's generic write routes
// are registered on.
type TableWriteGroup int

const (
	// NoWrites: no generic write routes are registered for this table.
	NoWrites TableWriteGroup = iota
	// GenericWrite: writes go through AuthCacheMiddleware + CSRF.
	GenericWrite
	// RLSWrite: writes go through the authenticated group with the RLS
	// middleware chain (emoji tables).
	RLSWrite
)

// TableRoute is one generic HTTP route for a table.
type TableRoute struct {
	Method   string // "GET", "POST", "PUT" or "DELETE"
	Wildcard bool   // also register /<table>/*path
}

// OwnershipKind describes how the generic write path binds rows to the
// authenticated caller (anti-impersonation / anti-IDOR, K1/H2).
type OwnershipKind int

const (
	// OwnNone: writes are not ownership-scoped by the generic handler.
	OwnNone OwnershipKind = iota
	// OwnSingle: the user_id column is forced to the caller on POST and
	// PUT/DELETE are scoped `user_id = caller`.
	OwnSingle
	// OwnWallPost: author_id is forced to the caller on POST (the wall owner
	// may be another user when privacy allows); PUT/DELETE are scoped
	// `author_id = caller OR user_id = caller`.
	OwnWallPost
	// OwnWallRepost: user_id AND wall_user_id are forced to the caller on POST;
	// PUT/DELETE are scoped `user_id = caller`.
	OwnWallRepost
)

// TableMeta declares everything the generic CRUD surface knows about a table.
type TableMeta struct {
	Name string

	// Routing — drives registerGenericTableRoutes (routes.go).
	ReadAccess   TableReadAccess
	ReadWildcard bool
	Writes       []TableRoute
	WriteGroup   TableWriteGroup

	// Security.
	ReadDenied      bool            // generic GET returns 403 (sensitive tables)
	WriteDenied     bool            // generic writes return 403 (server-managed tables)
	WritableColumns map[string]bool // mass-assignment allow-list (H2/CWE-915); nil = unrestricted
	PostOwner       OwnershipKind   // POST ownership forcing (K1)
	WriteOwner      OwnershipKind   // PUT/DELETE ownership scope (K1)

	// Read scoping / visibility.
	UserScopedRead    bool // GET scoped to the caller's user_id
	GomosubManagement bool // writes require gomosub board management permission (H1)
	GomosubVisibility bool // GET gated to boards the caller may see
	EmojiVisibility   bool // GET gated to packs the caller may see

	// HandlerScope is a per-table SQL predicate template that ownership-scopes
	// PUT/DELETE writes in handlePut/handleDelete for tables whose scoping is
	// handler-driven rather than the generic WriteOwner scope. Non-empty marks
	// the table as handler-managed AND is the enforcement: the handlers read
	// this field and append the predicate with the authenticated user id bound
	// to the (single) `%d` argument index — so a table marked here is actually
	// scoped, and the declaration can never drift from the enforcement. Set for
	// the emoji tables: `author_id = $%d` (emoji_packs) / `pack_id IN (SELECT
	// id FROM emoji_packs WHERE author_id = $%d)` (custom_emojis), so a client
	// can only edit its own packs and emojis. The registry consistency test
	// (table_registry_test.go) requires every write route (POST/PUT/DELETE) to
	// be covered by PostOwner/WriteOwner, GomosubManagement, or HandlerScope —
	// a new writable table can never get unscoped write routes silently (that
	// would let any caller update/delete another user's rows: an IDOR).
	HandlerScope string

	// Upsert.
	Upsert bool // POST uses INSERT ... ON CONFLICT (BuildUpsert builds the statement)

	// Write side effects. Both are run by the generic write paths after the
	// row is written (POST/upsert/PUT/DELETE), with the written row. Nil
	// fields mean: no registry-declared cache invalidation (the dispatcher
	// falls back to the generic cache.InvalidateForTable) / no achievement
	// events. Implementations live in table_hooks.go — this file only
	// references them, so the declaration and the behavior cannot drift.
	InvalidateCache  TableInvalidator   // nil = generic table invalidation
	EmitAchievements AchievementEmitter // nil = no achievement events

	// Per-table write behavior, implemented in table_write_hooks.go. The
	// dispatchers in crud.go are a pure template over these fields — a
	// table's full write profile (body guards, statement shape, side effects,
	// delete semantics, response enrichment) is declared here, so adding a
	// table cannot leave an unregistered branch in the engine.
	PrepareBody      BodyPreparer      // nil = no pre-write body guards
	BuildUpsert      UpsertStmtBuilder // nil = plain INSERT (see Upsert flag)
	AfterWrite       WriteHook         // nil = no per-table side effects
	SoftDeleteSQL    string            // non-empty = DELETE runs UPDATE <table> SET <this>
	EnrichedResponse bool              // POST/PUT respond with the enriched wall payload

	// Per-table read behavior. ReadHandler fully replaces the generic GET
	// handler (specialized wall/achievement queries); SanitizeReadRow
	// post-processes each row of a generic GET result (read-time sanitization
	// of user-supplied data). Nil fields = generic read surface.
	ReadHandler     ReadOverride // nil = generic GET (query-builder surface)
	SanitizeReadRow RowSanitizer // nil = no read-time row sanitization
}

// TableInvalidator invalidates the Redis caches that embed data of a row
// written through the generic CRUD surface. Runs after the write with the
// written row; h.redis is guaranteed non-nil by the dispatcher.
type TableInvalidator func(h *Engine, c *gin.Context, result map[string]interface{})

// AchievementEmitter fires the achievement events implied by a row written
// through the generic CRUD surface. Runs after the write, best-effort
// (emissions are async and swallowed); h.achEngine is guaranteed non-nil by
// the dispatcher.
type AchievementEmitter func(h *Engine, result map[string]interface{})

// BodyPreparer mutates/validates the parsed JSON body before ownership forcing
// and the statement build. Carries the per-table K1/H1/L5 guards that cannot
// be expressed as declarative flags: forcing authored columns (emoji_packs),
// rejecting client-supplied server-managed fields (gomosub_memberships
// role_id), stripping columns the write must not move (wall post/comment PUT),
// and cross-table ownership validations (custom_emojis pack ownership).
// Returns false to abort the write (the response was already written).
type BodyPreparer func(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool

// UpsertStmtBuilder builds the INSERT ... ON CONFLICT statement of an upsert
// table, or ok=false when the body does not apply (the dispatcher then falls
// through to a plain INSERT). Implementations used to live in the
// upsertInsertQuery switch; they are now declared per table so the statement
// shape of a table lives next to its other registry facts.
type UpsertStmtBuilder func(data map[string]interface{}) (query string, args []interface{}, ok bool)

// WriteHook runs the per-table side effects of a written row: wall
// notifications, WebSocket broadcasts, unified profile stats and
// dependent-cache invalidations the generic invalidation cannot express.
// Runs on POST/PUT/DELETE with the method and the written row. Like the cache
// hooks it must be nil-safe: h.redis / h.hub / h.achEngine may be nil in tests
// and degraded deployments, and every optional interaction must be skipped.
type WriteHook func(h *Engine, c *gin.Context, method string, result map[string]interface{})

// ReadOverride fully replaces the generic GET handler of a table (the wall
// list queries and the achievements catalog have their own SQL, privacy
// embedding and pagination that the query-builder surface cannot express).
// Declared per table so a specialized read is wired in one place — the
// dispatcher consults the registry instead of a table-name branch list, so
// adding a table can re-use the mechanism without touching handleGet. The
// override owns the whole response.
type ReadOverride func(h *Engine, c *gin.Context)

// RowSanitizer post-processes one row of a generic GET result before the
// response is written — the read-time counterpart of the write-path
// sanitizers (defense-in-depth for rows written before server-side
// sanitization existed). Must never fail the request: it only mutates the
// row in place.
type RowSanitizer func(row map[string]interface{})

// fullWrites is the most common write surface: POST/PUT/DELETE with the
// wildcard variant each.
func fullWrites() []TableRoute {
	return []TableRoute{
		{Method: "POST", Wildcard: true},
		{Method: "PUT", Wildcard: true},
		{Method: "DELETE", Wildcard: true},
	}
}

// postPutWrites is the write surface of upsert-style tables: POST + PUT with
// the wildcard variant each.
func postPutWrites() []TableRoute {
	return []TableRoute{
		{Method: "POST", Wildcard: true},
		{Method: "PUT", Wildcard: true},
	}
}

// postOnlyWrites is the write surface of tables the client only creates.
func postOnlyWrites() []TableRoute {
	return []TableRoute{{Method: "POST", Wildcard: true}}
}

// genericTables is the registry. Entries are sorted by name — keep them that
// way when adding a table. All routes, permissions and scopes of the generic
// CRUD surface are derived from this list.
var genericTables = []TableMeta{
	{
		Name: "achievements",
		// Readable by guests; rows are created by migrations only (WriteDenied
		// would let a client forge achievements).
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		WriteDenied:  true,
	},
	{
		Name:              "channel_permissions",
		ReadAccess:        ProtectedRead,
		ReadWildcard:      true,
		Writes:            fullWrites(),
		WriteGroup:        GenericWrite,
		GomosubManagement: true,
		GomosubVisibility: true,
		PrepareBody:       stripChannelPermissionsBoardID,
		InvalidateCache:   invalidateChannelPermissionsCache,
	},
	{
		Name:              "channels",
		ReadAccess:        GuestRead,
		ReadWildcard:      true,
		Writes:            fullWrites(),
		WriteGroup:        GenericWrite,
		GomosubManagement: true,
		GomosubVisibility: true,
		InvalidateCache:   invalidateChannelsCache,
	}, {
		Name: "custom_emojis",
		// image_url is validated against the authenticated user's storage by
		// validateCustomEmojiAsset; unicode_triggers by
		// validateCustomEmojiTriggers (migration 087).
		ReadAccess: GuestRead,
		Writes:     []TableRoute{{Method: "POST"}, {Method: "PUT", Wildcard: true}, {Method: "DELETE", Wildcard: true}},
		WriteGroup: RLSWrite,
		WritableColumns: map[string]bool{
			"pack_id": true, "name": true, "image_url": true, "is_animated": true, "sort_order": true,
			"unicode_triggers": true,
		},
		EmojiVisibility: true,
		HandlerScope:    "pack_id IN (SELECT id FROM emoji_packs WHERE author_id = $%d)",
		PrepareBody:     prepareCustomEmojisBody,
		InvalidateCache: invalidateCustomEmojisCache,
	},
	{
		Name: "emoji_packs",
		// emoji_count / subscriber_count are maintained by triggers and the
		// subscription flow — a client must never be able to inflate them.
		ReadAccess: GuestRead,
		Writes:     []TableRoute{{Method: "POST"}, {Method: "PUT", Wildcard: true}, {Method: "DELETE", Wildcard: true}},
		WriteGroup: RLSWrite,
		WritableColumns: map[string]bool{
			"name": true, "slug": true, "description": true, "icon_url": true, "is_public": true,
		},
		EmojiVisibility: true,
		HandlerScope:    "author_id = $%d",
		PrepareBody:     prepareEmojiPacksBody,
		InvalidateCache: invalidateEmojiPacksCache,
	},
	{
		Name:              "gomosub_invites",
		ReadAccess:        ProtectedRead,
		ReadWildcard:      true,
		ReadDenied:        true,
		WriteDenied:       true,
		GomosubManagement: false,
	},
	{
		Name:              "gomosub_memberships",
		ReadAccess:        ProtectedRead,
		ReadWildcard:      true,
		Writes:            fullWrites(),
		WriteGroup:        GenericWrite,
		UserScopedRead:    true,
		GomosubManagement: true,
		PrepareBody:       prepareGomosubMembershipsBody,
		InvalidateCache:   invalidateGomosubMembershipsCache,
		EmitAchievements:  emitGomosubMembershipsAchievements,
	},
	{
		Name:              "gomosub_roles",
		ReadAccess:        ProtectedRead,
		ReadWildcard:      true,
		Writes:            fullWrites(),
		WriteGroup:        GenericWrite,
		GomosubManagement: true,
		GomosubVisibility: true,
		InvalidateCache:   invalidateGomosubRolesCache,
	},
	{
		Name:             "gomosub_rules_acceptance",
		ReadAccess:       ProtectedRead,
		ReadWildcard:     true,
		Writes:           postPutWrites(),
		WriteGroup:       GenericWrite,
		UserScopedRead:   true,
		PostOwner:        OwnSingle,
		WriteOwner:       OwnSingle,
		Upsert:           true,
		BuildUpsert:      upsertGomosubRulesAcceptance,
		InvalidateCache:  invalidateGomosubRulesAcceptanceCache,
		EmitAchievements: emitGomosubRulesAcceptanceAchievements,
	},
	{
		Name:         "poll_votes",
		ReadAccess:   ProtectedRead,
		ReadWildcard: true,
		// user_id is forced to the caller by OwnSingle.
		WritableColumns: map[string]bool{"poll_id": true, "option_ids": true, "option_index": true},
		UserScopedRead:  true,
		PostOwner:       OwnSingle,
		WriteOwner:      OwnSingle,
	},
	{
		Name:         "polls",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		// Rows are created by the poll feature's explicit handlers; a generic
		// write could forge polls (WriteDenied).
		WriteDenied: true,
	},
	{
		Name:            "privacy_settings",
		ReadAccess:      ProtectedRead,
		ReadWildcard:    true,
		Writes:          postPutWrites(),
		WriteGroup:      GenericWrite,
		UserScopedRead:  true,
		PostOwner:       OwnSingle,
		WriteOwner:      OwnSingle,
		AfterWrite:      afterPrivacySettingsWrite,
		InvalidateCache: invalidatePrivacySettingsCache,
	},
	{
		Name: "profile_album_posts",
		// Both foreign keys are client-supplied at creation; the POST body
		// guard (prepareAlbumPostBody) verifies the album belongs to the
		// caller and the post sits on the caller's wall (L5 fail-closed
		// lookups). PUT/DELETE are scoped to the caller's own albums via
		// HandlerScope (this table has no user_id column — ownership is
		// inherited from the album). Reads join the wall posts and gate on
		// the album owner's wall privacy.
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       []TableRoute{{Method: "POST", Wildcard: true}, {Method: "DELETE", Wildcard: true}},
		WriteGroup:   GenericWrite,
		WritableColumns: map[string]bool{
			"album_id": true, "post_id": true,
		},
		HandlerScope:    "album_id IN (SELECT id FROM profile_albums WHERE user_id = $%d)",
		PrepareBody:     prepareAlbumPostBody,
		ReadHandler:     (*Engine).handleProfileAlbumPostsGet,
		InvalidateCache: invalidateProfileAlbumPostsCache,
	},
	{
		Name: "profile_albums",
		// Only the name is client-writable; user_id/created_at/updated_at are
		// server-managed (OwnSingle forces user_id on POST and scopes
		// PUT/DELETE to the caller). Reads are gated by the album owner's
		// wall privacy — the same rule as the wall itself — and embed a
		// post_count.
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       fullWrites(),
		WriteGroup:   GenericWrite,
		WritableColumns: map[string]bool{
			"name": true,
		},
		PostOwner:       OwnSingle,
		WriteOwner:      OwnSingle,
		PrepareBody:     prepareAlbumBody,
		ReadHandler:     (*Engine).handleProfileAlbumsGet,
		InvalidateCache: invalidateProfileAlbumsCache,
	},
	{
		Name:         "profile_customization",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       postOnlyWrites(),
		WriteGroup:   GenericWrite,
		// POST-only surface: the upsert path (upsertInsertQuery) handles the
		// partial updates and CSS sanitization. PostOwner applies; WriteOwner
		// intentionally stays OwnNone — there are no PUT/DELETE routes and a
		// generic scoped PUT must keep behaving exactly as today (unscoped).
		// Read-time sanitization of rows written before the write-path
		// sanitizer existed (defense-in-depth, L6). The sanitizers live in the
		// profiles domain package.
		SanitizeReadRow:  profiles.SanitizeProfileCustomizationRow,
		UserScopedRead:   true,
		PostOwner:        OwnSingle,
		Upsert:           true,
		BuildUpsert:      upsertProfileCustomization,
		InvalidateCache:  invalidateProfileCustomizationCache,
		EmitAchievements: emitProfileCustomizationAchievements,
	},
	{
		Name:             "profile_wall_comment_likes",
		ReadAccess:       GuestRead,
		ReadWildcard:     true,
		Writes:           fullWrites(),
		WriteGroup:       GenericWrite,
		UserScopedRead:   true,
		PostOwner:        OwnSingle,
		WriteOwner:       OwnSingle,
		AfterWrite:       afterWallCommentLikeWrite,
		EmitAchievements: emitProfileWallCommentLikesAchievements,
	},
	{
		Name:         "profile_wall_post_comments",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       fullWrites(),
		WriteGroup:   GenericWrite,
		// user_id is forced to the caller by OwnSingle (POST) / the ownership
		// scope (PUT). is_deleted is server-managed — it is set only by the
		// soft-delete DELETE path, so a client can neither un-delete a comment
		// nor flag someone else's as deleted through a generic PUT. post_id /
		// parent_id are writable ONLY at creation (they must survive the POST
		// body for the wall-privacy gate) and are stripped from PUT in
		// prepareWallCommentBody, so the comment tree cannot be re-parented
		// retroactively.
		WritableColumns: map[string]bool{"content": true, "content_json": true, "post_id": true, "parent_id": true},
		// Reads are served by the specialized wall-comments query
		// (handleProfileWallPostCommentsGet) — the generic list cannot embed
		// the comment author, the interaction counts and the privacy gates.
		ReadHandler:      (*Engine).handleProfileWallPostCommentsGet,
		PostOwner:        OwnSingle,
		WriteOwner:       OwnSingle,
		PrepareBody:      prepareWallCommentBody,
		AfterWrite:       afterWallCommentWrite,
		SoftDeleteSQL:    `content = NULL, content_json = NULL, user_id = NULL, is_deleted = TRUE, updated_at = NOW()`,
		EnrichedResponse: true,
		InvalidateCache:  invalidateProfileWallPostCommentsCache,
		EmitAchievements: emitProfileWallPostCommentsAchievements,
	},
	{
		Name:         "profile_wall_post_likes",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       fullWrites(),
		WriteGroup:   GenericWrite,
		// user_id is forced to the caller by OwnSingle.
		UserScopedRead:   true,
		PostOwner:        OwnSingle,
		WriteOwner:       OwnSingle,
		Upsert:           true,
		BuildUpsert:      upsertProfileWallPostLikes,
		AfterWrite:       afterWallPostLikeWrite,
		InvalidateCache:  invalidateProfileWallPostLikesCache,
		EmitAchievements: emitProfileWallPostLikesAchievements,
	},
	{
		Name:         "profile_wall_post_reposts",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       fullWrites(),
		WriteGroup:   GenericWrite,
		// user_id AND wall_user_id are always forced to the caller (OwnWallRepost):
		// a repost is authored by and placed on the caller's own wall — a
		// client-controlled wall_user_id would be a foreign-wall bypass.
		UserScopedRead:   true,
		PostOwner:        OwnWallRepost,
		WriteOwner:       OwnSingle,
		AfterWrite:       afterWallRepostWrite,
		EmitAchievements: emitProfileWallPostRepostsAchievements,
	},
	{
		Name:         "profile_wall_posts",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       fullWrites(),
		WriteGroup:   GenericWrite,
		// OwnWallPost: the author is always the caller; the wall owner may be
		// another user, but only when their privacy settings allow it and the
		// caller may view the wall (enforcePostOwnership / enforceWallTargetPrivacy).
		// Reads are served by the specialized wall-list query
		// (handleProfileWallPostsGet) — it embeds the author, the interaction
		// counts and the per-owner privacy gates the generic surface cannot.
		ReadHandler:      (*Engine).handleProfileWallPostsGet,
		UserScopedRead:   true,
		PostOwner:        OwnWallPost,
		WriteOwner:       OwnWallPost,
		PrepareBody:      prepareWallPostBody,
		AfterWrite:       afterWallPostWrite,
		EnrichedResponse: true,
		InvalidateCache:  invalidateProfileWallPostsCache,
		EmitAchievements: emitProfileWallPostsAchievements,
	},
	{
		Name:       "reports",
		ReadDenied: true,
		// Reads are too sensitive for the compatibility surface (they must go
		// through explicit business handlers). No routes are registered.
		// Writes stay allow-listed (WriteDenied=false) to preserve the
		// pre-registry posture — reports go through dedicated handlers anyway.
	},
	{
		Name:           "thread_custom_message_visits",
		ReadAccess:     ProtectedRead,
		ReadWildcard:   true,
		Writes:         postPutWrites(),
		WriteGroup:     GenericWrite,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
		Upsert:         true,
		BuildUpsert:    upsertThreadCustomMessageVisits,
	},
	{
		Name:         "thread_subscriptions",
		ReadAccess:   ProtectedRead,
		ReadWildcard: true,
		// user_id is forced to the caller by OwnSingle.
		WritableColumns: map[string]bool{"thread_id": true},
		UserScopedRead:  true,
		PostOwner:       OwnSingle,
		WriteOwner:      OwnSingle,
	},
	{
		Name:         "user_achievements",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		// Rows are written by the achievement checker only (WriteDenied would
		// let a client forge unlocks). Reads are served by the dedicated
		// achievements query (handleUserAchievementsGet) which resolves the
		// category schema and personal unlock state in one pass.
		ReadHandler:    (*Engine).handleUserAchievementsGet,
		WriteDenied:    true,
		UserScopedRead: true,
	},
	{
		Name:       "user_bans",
		ReadDenied: true,
		// Same posture as reports: reads are sensitive, no routes registered.
	},
	{
		Name:             "user_daily_visits",
		ReadAccess:       ProtectedRead,
		ReadWildcard:     true,
		Writes:           postPutWrites(),
		WriteGroup:       GenericWrite,
		UserScopedRead:   true,
		PostOwner:        OwnSingle,
		WriteOwner:       OwnSingle,
		Upsert:           true,
		BuildUpsert:      upsertUserDailyVisits,
		EmitAchievements: emitUserDailyVisitsAchievements,
	},
	{
		Name:       "user_emoji_subscriptions",
		ReadAccess: GuestRead,
		Writes:     []TableRoute{{Method: "POST"}, {Method: "DELETE"}},
		WriteGroup: RLSWrite,
		// user_id is forced to the caller by OwnSingle.
		WritableColumns: map[string]bool{"pack_id": true},
		UserScopedRead:  true,
		PostOwner:       OwnSingle,
		WriteOwner:      OwnSingle,
		InvalidateCache: invalidateUserEmojiSubscriptionsCache,
	},
	{
		Name:           "user_placeholders",
		ReadAccess:     GuestRead,
		ReadWildcard:   true,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
	},
	{
		Name:         "user_roles",
		ReadAccess:   ProtectedRead,
		ReadWildcard: true,
		// H2 (security audit): server-managed tables must never be written
		// through the generic CRUD surface — any authenticated user could
		// INSERT/PUT a row granting themselves the admin/moderator role
		// (privilege escalation). Reads stay allowed.
		WriteDenied:    true,
		UserScopedRead: true,
	},
	{
		Name:           "user_session_time",
		ReadAccess:     ProtectedRead,
		ReadWildcard:   true,
		Writes:         postPutWrites(),
		WriteGroup:     GenericWrite,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
		Upsert:         true,
		BuildUpsert:    upsertUserSessionTime,
		AfterWrite:     afterUserSessionTimeWrite,
	},
	{
		Name:           "user_settings_changes",
		ReadAccess:     ProtectedRead,
		ReadWildcard:   true,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
	},
	{
		Name:            "user_terms_acceptance",
		ReadAccess:      ProtectedRead,
		ReadWildcard:    true,
		Writes:          postOnlyWrites(),
		WriteGroup:      GenericWrite,
		UserScopedRead:  true,
		PostOwner:       OwnSingle,
		Upsert:          true,
		BuildUpsert:     upsertUserTermsAcceptance,
		InvalidateCache: invalidateUserTermsAcceptanceCache,
	},
}

// genericTablesByName indexes the registry for O(1) lookups.
var genericTablesByName = func() map[string]*TableMeta {
	m := make(map[string]*TableMeta, len(genericTables))
	for i := range genericTables {
		m[genericTables[i].Name] = &genericTables[i]
	}
	return m
}()

// GenericTableByName returns the registry entry for a table, or nil when the
// table is not part of the generic CRUD surface. nil doubles as the
// allow-list: a table not in the registry is rejected by
// HandleTableRequest before any SQL is built.
func GenericTableByName(name string) *TableMeta {
	return genericTablesByName[name]
}

// GenericTables returns a copy of the registry entries. routes.go iterates it
// to generate the generic CRUD routes. A copy (instead of the internal slice)
// keeps callers from mutating the shared backing array and silently desyncing
// genericTablesByName, which the handler allow-list and every permission check
// read.
func GenericTables() []TableMeta {
	return append([]TableMeta(nil), genericTables...)
}
