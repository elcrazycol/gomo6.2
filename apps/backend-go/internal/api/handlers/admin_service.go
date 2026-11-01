package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crudengine"
	"github.com/gomo6/backend/internal/logsafe"
	"github.com/gomo6/backend/internal/models"
	storageHandlers "github.com/gomo6/backend/internal/storage/handlers"
	"github.com/gomo6/backend/internal/stories"
)

// ─── Admin-operated service account ──────────────────────────────────────────
// The official notification account (@gomo6) can never log in and its
// messenger is cut off. Everything published in its name — wall posts,
// stories, avatar, banner, bio — goes through THESE endpoints, which:
//  1. require a platform admin (adminOnlyMiddleware),
//  2. require a FRESH passkey ceremony per action (X-Reauth-Token header,
//     single-use, 5 minutes — a stolen admin session alone cannot post),
//  3. execute the request with the claims swapped to the service identity,
//     so all ordinary validation, ownership checks and side effects
//     (notifications, search index, achievements, WS fan-out) run unchanged,
//  4. audit-log every action with the real admin id.
//
// The swap is contained: it applies only to routes registered below, and the
// service identity can never read messenger (DenyServiceAccount) even here.

// ServiceAccountName is the login name of the notification account.
func ServiceAccountName() string {
	return serviceAccountUsername()
}

// serviceAccountUsername is the login name of the notification account.
func serviceAccountUsername() string {
	if u := strings.TrimSpace(os.Getenv("SERVICE_ACCOUNT_USERNAME")); u != "" {
		return u
	}
	return "gomo6"
}

// RequireFreshReauth burns a single-use passkey re-authentication token from
// the X-Reauth-Token header. The token is bound to the caller's user id.
func RequireFreshReauth(authSvc *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsI, exists := c.Get("claims")
		claims, ok := claimsI.(*auth.Claims)
		if !exists || !ok || claims == nil || claims.UserID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			c.Abort()
			return
		}
		token := strings.TrimSpace(c.GetHeader("X-Reauth-Token"))
		if token == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Fresh passkey re-authentication required (X-Reauth-Token)"))
			c.Abort()
			return
		}
		if err := authSvc.ConsumeReauthToken(claims.UserID, token); err != nil {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Invalid or expired re-auth token"))
			c.Abort()
			return
		}
		c.Next()
	}
}

// AdminServiceHandler executes allow-listed writes as the service account.
type AdminServiceHandler struct {
	db              *sql.DB
	engine          *crudengine.Engine
	storiesHandler  *stories.Handler
	storageHandler  *storageHandlers.StorageHandler
	profilesHandler *ProfilesHandler
}

// NewAdminServiceHandler wires the admin service surface.
func NewAdminServiceHandler(db *sql.DB, engine *crudengine.Engine, storiesHandler *stories.Handler, storageHandler *storageHandlers.StorageHandler, profilesHandler *ProfilesHandler) *AdminServiceHandler {
	return &AdminServiceHandler{
		db: db, engine: engine, storiesHandler: storiesHandler,
		storageHandler: storageHandler, profilesHandler: profilesHandler,
	}
}

type serviceIdentity struct {
	ID       string
	Username string
}

// loadServiceIdentity resolves the notification account. Fail-closed: when it
// does not exist (not seeded yet) every service action is refused rather than
// executed as anyone else.
func (h *AdminServiceHandler) loadServiceIdentity() (serviceIdentity, bool) {
	var id, username string
	err := h.db.QueryRow(
		`SELECT id, username FROM users WHERE username = $1 AND COALESCE(is_service, false)`,
		serviceAccountUsername()).Scan(&id, &username)
	if err != nil {
		return serviceIdentity{}, false
	}
	return serviceIdentity{ID: id, Username: username}, true
}

// ServiceSudoMiddleware swaps the request identity to the service account for
// the allow-listed routes below. The real admin id is stashed for the audit
// log. Must run after auth + adminOnly + RequireFreshReauth.
func (h *AdminServiceHandler) ServiceSudoMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsI, exists := c.Get("claims")
		claims, ok := claimsI.(*auth.Claims)
		if !exists || !ok || claims == nil || claims.UserID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			c.Abort()
			return
		}
		svc, found := h.loadServiceIdentity()
		if !found {
			c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Service account is not set up"))
			c.Abort()
			return
		}
		c.Set("adminID", claims.UserID)
		c.Set("claims", &auth.Claims{
			UserID:   svc.ID,
			Username: svc.Username,
			Domain:   claims.Domain,
		})
		logsafe.Printf("[ADMIN-SERVICE] admin=%s action=%s %s", claims.UserID, c.Request.Method, c.Request.URL.Path)
		c.Next()
	}
}

// ServiceAccountInfo returns the service identity (so the panel knows whose
// wall/media keys to use). Admin-only; read-only, no reauth needed.
func (h *AdminServiceHandler) ServiceAccountInfo(c *gin.Context) {
	svc, found := h.loadServiceIdentity()
	if !found {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Service account is not set up"))
		return
	}
	var displayName *string
	_ = h.db.QueryRow(`SELECT display_name FROM users WHERE id = $1`, svc.ID).Scan(&displayName)
	name := svc.Username
	if displayName != nil && *displayName != "" {
		name = *displayName
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"user_id":      svc.ID,
		"username":     svc.Username,
		"display_name": name,
	}))
}

// ServiceWall proxies wall-post writes through the generic engine with the
// table forced to profile_wall_posts — same validation and side effects
// (notifications, search, achievements, WS) as a normal post.
func (h *AdminServiceHandler) ServiceWall(c *gin.Context) {
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Service engine unavailable"))
		return
	}
	c.Request.URL.Path = "/api/v1/profile_wall_posts"
	h.engine.HandleTableRequest(c)
}

// ServiceCustomization proxies profile-customization writes (banner,
// background, theme) with the table forced to profile_customization.
func (h *AdminServiceHandler) ServiceCustomization(c *gin.Context) {
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Service engine unavailable"))
		return
	}
	c.Request.URL.Path = "/api/v1/profile_customization"
	h.engine.HandleTableRequest(c)
}

// ServiceStory publishes a story as the service account (author = service via
// swapped claims, so media-key ownership checks pass for service keys).
func (h *AdminServiceHandler) ServiceStory(c *gin.Context) {
	if h.storiesHandler == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Stories unavailable"))
		return
	}
	h.storiesHandler.CreateStory(c)
}

// ServiceUpload uploads a file namespaced to the service account (bucket +
// key from multipart form, key must start with the service user id — enforced
// by the storage handler against the swapped claims).
func (h *AdminServiceHandler) ServiceUpload(c *gin.Context) {
	if h.storageHandler == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Storage unavailable"))
		return
	}
	h.storageHandler.UploadFileWithKey(c)
}

// ServiceProfile updates the service account's own profile fields
// (bio/display_name/avatar_url) through the standard profile handler with the
// id param pinned to the service identity.
func (h *AdminServiceHandler) ServiceProfile(c *gin.Context) {
	if h.profilesHandler == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Profiles unavailable"))
		return
	}
	claimsI, _ := c.Get("claims")
	claims, _ := claimsI.(*auth.Claims)
	if claims == nil {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	c.Params = gin.Params{{Key: "id", Value: claims.UserID}}
	h.profilesHandler.UpdateProfile(c)
}
