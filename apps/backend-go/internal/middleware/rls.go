package middleware

import (
	"bytes"
	"database/sql"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/metrics"
)

const (
	messengerTxContextKey   = "messenger_tx"
	messengerTxRequiredKey  = "messenger_tx_required"
	messengerCommitHooksKey = "messenger_commit_hooks"
)

type messengerBufferedWriter struct {
	gin.ResponseWriter
	header  http.Header
	body    bytes.Buffer
	status  int
	written bool
}

func newMessengerBufferedWriter() *messengerBufferedWriter {
	return &messengerBufferedWriter{
		header: make(http.Header),
		status: http.StatusOK,
	}
}

func (w *messengerBufferedWriter) Header() http.Header { return w.header }

func (w *messengerBufferedWriter) WriteHeader(code int) {
	if w.written {
		return
	}
	w.status = code
	w.written = true
}

func (w *messengerBufferedWriter) WriteHeaderNow() { w.WriteHeader(w.status) }

func (w *messengerBufferedWriter) Write(p []byte) (int, error) {
	if !w.written {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(p)
}

func (w *messengerBufferedWriter) WriteString(value string) (int, error) {
	return w.Write([]byte(value))
}

func (w *messengerBufferedWriter) Status() int { return w.status }

func (w *messengerBufferedWriter) Size() int {
	if !w.written {
		return -1
	}
	return w.body.Len()
}

func (w *messengerBufferedWriter) Written() bool { return w.written }

// Flush records the response as started but intentionally does not flush the
// network. Messenger handlers are ordinary REST handlers and must not expose
// a response before the database transaction commits.
func (w *messengerBufferedWriter) Flush() { w.WriteHeaderNow() }

func (w *messengerBufferedWriter) copyTo(dst gin.ResponseWriter) error {
	for key, values := range w.header {
		dst.Header()[key] = append([]string(nil), values...)
	}
	if !w.written {
		return nil
	}
	dst.WriteHeader(w.status)
	if len(w.body.Bytes()) == 0 {
		return nil
	}
	_, err := dst.Write(w.body.Bytes())
	return err
}

func writeMessengerCommitError(dst gin.ResponseWriter) {
	dst.Header().Set("Content-Type", "application/json; charset=utf-8")
	dst.WriteHeader(http.StatusInternalServerError)
	_, _ = dst.Write([]byte(`{"error":"Internal server error"}`))
}

// QueueMessengerAfterCommit queues a side effect until the request transaction
// has committed successfully. Direct handler tests without the middleware keep
// the historical behavior and execute the hook immediately.
func QueueMessengerAfterCommit(c *gin.Context, hook func()) {
	if hook == nil {
		return
	}
	if required, _ := c.Get(messengerTxRequiredKey); required == true {
		if _, ok := c.Value(messengerTxContextKey).(*sql.Tx); !ok {
			_ = c.Error(sql.ErrTxDone)
			return
		}
	}
	if _, ok := c.Value(messengerTxContextKey).(*sql.Tx); !ok {
		hook()
		return
	}

	var hooks []func()
	if value, exists := c.Get(messengerCommitHooksKey); exists {
		hooks, _ = value.([]func())
	}
	hooks = append(hooks, hook)
	c.Set(messengerCommitHooksKey, hooks)
}

func runMessengerAfterCommit(c *gin.Context) {
	value, exists := c.Get(messengerCommitHooksKey)
	if !exists {
		return
	}
	for _, hook := range value.([]func()) {
		hook()
	}
}

func discardMessengerAfterCommit(c *gin.Context) {
	c.Set(messengerCommitHooksKey, nil)
}

// MessengerTransactionMiddleware binds the authenticated request to one
// PostgreSQL transaction. SET LOCAL is scoped to that transaction and cannot
// leak between pooled connections or users.
//
// Every messenger handler must use the transaction stored under messenger_tx.
func MessengerTransactionMiddleware(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsInterface, exists := c.Get("claims")
		claims, claimsOK := claimsInterface.(*auth.Claims)
		if !exists || !claimsOK || claims == nil || claims.UserID == "" {
			c.AbortWithStatusJSON(401, gin.H{"error": "Authentication required"})
			return
		}

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			metrics.Messenger.RecordDBTxError()
			log.Printf("[RLS] begin messenger transaction failed for %s: %v", claims.UserID, err)
			c.AbortWithStatusJSON(500, gin.H{"error": "Internal server error"})
			return
		}
		defer tx.Rollback()

		if _, err := tx.ExecContext(c.Request.Context(),
			"SELECT set_config('app.current_user_id', $1, true)", claims.UserID,
		); err != nil {
			metrics.Messenger.RecordDBTxError()
			log.Printf("[RLS] set_config failed for %s: %v", claims.UserID, err)
			c.AbortWithStatusJSON(500, gin.H{"error": "Internal server error"})
			return
		}

		c.Set(messengerTxContextKey, tx)
		c.Set(messengerTxRequiredKey, true)
		originalWriter := c.Writer
		bufferedWriter := newMessengerBufferedWriter()
		c.Writer = bufferedWriter
		c.Next()
		c.Writer = originalWriter

		// HTTP status alone is not enough: a handler may have already written a
		// 200 response before discovering a database error. Handlers report such
		// failures through c.Error, so never commit a request with Gin errors.
		if c.Errors.Last() != nil || bufferedWriter.Status() >= 400 || c.IsAborted() {
			discardMessengerAfterCommit(c)
			if err := bufferedWriter.copyTo(originalWriter); err != nil {
				log.Printf("[RLS] failed to flush error response for %s: %v", claims.UserID, err)
			}
			return
		}
		if err := tx.Commit(); err != nil {
			metrics.Messenger.RecordDBTxError()
			discardMessengerAfterCommit(c)
			log.Printf("[RLS] commit messenger transaction failed for %s: %v", claims.UserID, err)
			writeMessengerCommitError(originalWriter)
			return
		}
		if err := bufferedWriter.copyTo(originalWriter); err != nil {
			log.Printf("[RLS] failed to flush committed response for %s: %v", claims.UserID, err)
		}
		runMessengerAfterCommit(c)
	}
}

// RLSSetConfigMiddleware is retained for non-messenger callers for API
// compatibility. It no longer attempts to set a transaction-local value on a
// pooled *sql.DB connection, because that value would not bind to the handler's
// queries. Use MessengerTransactionMiddleware for messenger routes.
func RLSSetConfigMiddleware(_ *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
	}
}
