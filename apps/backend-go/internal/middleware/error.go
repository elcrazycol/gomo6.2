package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		// Only synthesize a response for errors the handler did NOT already
		// serialize. Handlers that call httpx.ServerError()/AbortWithStatusJSON
		// write the body themselves (pushing the error to c.Errors purely for
		// logs); appending a second JSON document here corrupted every client's
		// parse ("Unexpected non-whitespace character after JSON") on 5xx
		// responses.
		if c.Writer.Written() || c.IsAborted() {
			return
		}

		// Check for errors
		for _, err := range c.Errors {
			switch e := err.Err.(type) {
			case *HTTPError:
				c.JSON(e.StatusCode, gin.H{
					"error": e.Message,
				})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "Internal server error",
				})
			}
			return
		}
	}
}

type HTTPError struct {
	StatusCode int
	Message    string
}

func (e *HTTPError) Error() string {
	return e.Message
}

func NewHTTPError(statusCode int, message string) *HTTPError {
	return &HTTPError{
		StatusCode: statusCode,
		Message:    message,
	}
}
