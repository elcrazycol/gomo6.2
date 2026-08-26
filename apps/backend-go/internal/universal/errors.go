package universal

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// serverError logs the real error and returns a generic 500 to the client.
// NEVER leaks raw error messages to the client. Local copy of the handlers
// helper so this package stays one-directionally dependent on api/handlers.
func serverError(c *gin.Context, context string, err error) {
	log.Printf("[Universal] %s: %v", context, err)
	_ = c.Error(err)
	c.AbortWithStatusJSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
}
