package handlers

// ─── Table Registry ─────────────────────────────────────────────────────────
//
// The generic CRUD surface (UniversalHandler.HandleTableRequest + the
// universal routes) serves ~30 tables. Every fact the surface knows about a
// table — whether it is routable, which middleware group serves reads and
// writes, which methods are registered, which columns a client may write, how
// rows are scoped to the caller, and how reads are visibility-gated — used to
// live in ~8 separate switch statements:
//
//   - routes.go         : per-table route registrations across 3 groups
//   - allowedTables     : the handler's allow-list (universal.go)
//   - genericReadDeniedTable / genericWriteDeniedTable (universal.go)
//   - writableColumnsForTable (universal.go)
//   - genericReadScopeUser (universal.go)
//   - isGomosubManagementTable (universal.go)
//   - genericGomosubVisibility / genericEmojiVisibility (universal.go)
//   - upsertInsertQuery gating (universal_crud.go)
//
// Adding a table required touching all of them, and a missed one silently
// broke an endpoint ("GET-only routes made Gin return 404" — the recurring
// bug) or served stale data (missing cache invalidation). This file is the
// single source of truth: the routes are generated from it
// (registerGenericTableRoutes in routes.go) and every switch above now
// consults it. Adding a table = adding one entry here.

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

	// Upsert.
	Upsert bool // POST uses INSERT ... ON CONFLICT (upsertInsertQuery)
}

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
	},
	{
		Name:              "channels",
		ReadAccess:        GuestRead,
		ReadWildcard:      true,
		Writes:            fullWrites(),
		WriteGroup:        GenericWrite,
		GomosubManagement: true,
		GomosubVisibility: true,
	},
	{
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
	},
	{
		Name:              "gomosub_roles",
		ReadAccess:        ProtectedRead,
		ReadWildcard:      true,
		Writes:            fullWrites(),
		WriteGroup:        GenericWrite,
		GomosubManagement: true,
		GomosubVisibility: true,
	},
	{
		Name:           "gomosub_rules_acceptance",
		ReadAccess:     ProtectedRead,
		ReadWildcard:   true,
		Writes:         postPutWrites(),
		WriteGroup:     GenericWrite,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
		Upsert:         true,
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
		Name:           "privacy_settings",
		ReadAccess:     ProtectedRead,
		ReadWildcard:   true,
		Writes:         postPutWrites(),
		WriteGroup:     GenericWrite,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
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
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		Upsert:         true,
	},
	{
		Name:           "profile_wall_comment_likes",
		ReadAccess:     GuestRead,
		ReadWildcard:   true,
		Writes:         fullWrites(),
		WriteGroup:     GenericWrite,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
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
		// handlePut, so the comment tree cannot be re-parented retroactively.
		WritableColumns: map[string]bool{"content": true, "content_json": true, "post_id": true, "parent_id": true},
		// The generic GET handler is overridden by handleProfileWallPostCommentsGet.
		PostOwner:  OwnSingle,
		WriteOwner: OwnSingle,
	},
	{
		Name:         "profile_wall_post_likes",
		ReadAccess:   GuestRead,
		ReadWildcard: true,
		Writes:       fullWrites(),
		WriteGroup:   GenericWrite,
		// user_id is forced to the caller by OwnSingle.
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
		Upsert:         true,
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
		UserScopedRead: true,
		PostOwner:      OwnWallRepost,
		WriteOwner:     OwnSingle,
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
		// The generic GET handler is overridden by handleProfileWallPostsGet.
		UserScopedRead: true,
		PostOwner:      OwnWallPost,
		WriteOwner:     OwnWallPost,
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
		// let a client forge unlocks). The generic GET handler is overridden
		// by handleUserAchievementsGet.
		WriteDenied:    true,
		UserScopedRead: true,
	},
	{
		Name:       "user_bans",
		ReadDenied: true,
		// Same posture as reports: reads are sensitive, no routes registered.
	},
	{
		Name:           "user_daily_visits",
		ReadAccess:     ProtectedRead,
		ReadWildcard:   true,
		Writes:         postPutWrites(),
		WriteGroup:     GenericWrite,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		WriteOwner:     OwnSingle,
		Upsert:         true,
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
		Name:           "user_terms_acceptance",
		ReadAccess:     ProtectedRead,
		ReadWildcard:   true,
		Writes:         postOnlyWrites(),
		WriteGroup:     GenericWrite,
		UserScopedRead: true,
		PostOwner:      OwnSingle,
		Upsert:         true,
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

// GenericTables returns the registry entries. routes.go iterates it to
// generate the universal CRUD routes.
func GenericTables() []TableMeta {
	return genericTables
}
