package universal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// setupUniversalHandler creates a UniversalHandler with a mock DB (hub=nil, redis=nil).
func setupUniversalHandler(t *testing.T) (*UniversalHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	handler := NewUniversalHandler(db, nil) // hub=nil skips websocket events
	return handler, mock
}

// newUniversalRequestContext creates a gin context for UniversalHandler with specified method, path, body, and claims.
func newUniversalRequestContext(method, path string, body interface{}, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			panic(fmt.Sprintf("failed to marshal test body: %v", err))
		}
		bodyReader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")

	// Parse query params from path
	if parts := strings.SplitN(path, "?", 2); len(parts) == 2 {
		req.URL.RawQuery = parts[1]
	}

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	if claims != nil {
		c.Set("claims", claims)
	}

	return c, w
}
