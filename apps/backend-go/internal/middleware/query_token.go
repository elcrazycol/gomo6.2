package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RejectQueryTokenMiddleware prevents bearer credentials from appearing in URLs.
// It is mounted globally so routes that do not use AuthCacheMiddleware cannot
// accidentally reintroduce the legacy ?token= authentication convention.
func RejectQueryTokenMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, present := c.GetQuery("token"); present {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"error": "Query-string tokens are not supported; use Authorization or a secure cookie",
			})
			return
		}
		c.Next()
	}
}
