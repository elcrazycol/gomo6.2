package wall

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// PreparePostBody fixes a wall post's authorship on PUT and validates/derives
// the post document. The author is always the caller, and the wall owner column
// must never be moved onto another user's wall through a generic update (that
// would bypass the POST privacy check allow_wall_posts_from_others).
func (s *Service) PreparePostBody(c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method == "PUT" {
		userID := httpx.AuthenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return false
		}
		data["author_id"] = userID
		if wall, ok := data["user_id"].(string); ok && wall != "" && wall != userID {
			delete(data, "user_id")
		}
	}
	return s.preparePostDocument(c, method, data)
}

// preparePostDocument validates content_json/attachments and, in enforce mode,
// overwrites the derived columns (content/title/image_url/attachments). Modes
// come from WALL_DOC_VALIDATION: "off", "log" (default) or "enforce". The
// log-only default lets the validator run against existing documents without
// rejecting them.
func (s *Service) preparePostDocument(c *gin.Context, method string, data map[string]interface{}) bool {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("WALL_DOC_VALIDATION")))
	if mode == "off" {
		return true
	}
	doc := contentJSONMap(data["content_json"])
	if doc == nil {
		return true // legacy plain-text post — nothing to validate
	}

	authorID := httpx.AuthenticatedUserID(c)
	if method == "PUT" {
		// The wall owner may edit, but attachments belong to the post author.
		authorID = s.postAuthorForRequest(c, authorID)
	}
	attachments := attachmentsSlice(data["attachments"])

	problems := ValidatePostDocument(doc)
	problems = append(problems, ValidateAttachmentRefs(doc, attachments)...)
	problems = append(problems, ValidateAttachmentsOwnership(doc, attachments, authorID)...)

	if len(problems) > 0 {
		if mode == "enforce" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(problems[0]))
			return false
		}
		for _, problem := range problems {
			log.Printf("[wall-doc] validation (log-only): %s", problem)
		}
		return true
	}

	if mode == "enforce" {
		content, title, imageURL, used := DerivePostFields(doc, attachments)
		data["content"] = content
		data["title"] = title
		if imageURL != nil {
			data["image_url"] = *imageURL
		} else {
			data["image_url"] = nil
		}
		if used != nil {
			data["attachments"] = used
		}
	}
	return true
}

// postAuthorForRequest returns the author_id of the wall post being edited, so
// attachment ownership is checked against the post author rather than the
// caller. Falls back to the caller when the row cannot be resolved.
func (s *Service) postAuthorForRequest(c *gin.Context, fallback string) string {
	id := eqQueryID(c.Query("id"))
	if id == "" {
		return fallback
	}
	var authorID string
	if err := s.db.QueryRowContext(c.Request.Context(),
		"SELECT author_id FROM profile_wall_posts WHERE id = $1", id).Scan(&authorID); err != nil {
		if err != sql.ErrNoRows {
			log.Printf("[wall-doc] author lookup: %v", err)
		}
		return fallback
	}
	if authorID == "" {
		return fallback
	}
	return authorID
}

// eqQueryID extracts the value from a PostgREST-style `id=eq.<uuid>` filter.
func eqQueryID(raw string) string {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "eq.") {
		return ""
	}
	return strings.TrimPrefix(raw, "eq.")
}

// PrepareCommentBody fixes a comment's tree position on PUT: post_id and
// parent_id are fixed at creation — re-pointing them would bypass the
// POST-time privacy check (EnforceTargetPrivacy) and could forge orphan
// comments on a foreign wall or detach a reply subtree from the visible
// branch.
func (s *Service) PrepareCommentBody(c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method != "PUT" {
		return true
	}
	delete(data, "post_id")
	delete(data, "parent_id")
	return true
}

// UpsertPostLikes inserts a like or turns the re-like into a
// no-op UPDATE; (xmax = 0) AS inserted tells the caller whether this was a
// genuinely new like (the only case that notifies the post author).
func UpsertPostLikes(data map[string]interface{}) (query string, args []interface{}, ok bool) {
	pid, hasPID := data["post_id"]
	uid, hasUID := data["user_id"]
	if !hasPID || !hasUID {
		return "", nil, false
	}
	q := `INSERT INTO profile_wall_post_likes (post_id, user_id) VALUES ($1, $2)
ON CONFLICT (post_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
RETURNING *, (xmax = 0) AS inserted`
	return q, []interface{}{pid, uid}, true
}
