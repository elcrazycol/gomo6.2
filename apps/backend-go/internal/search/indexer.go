package search

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/gomo6/backend/internal/bg"
)

// indexPool bounds the write-path indexing work. Like the achievements pool it
// is deliberately bounded, not `go SyncX(...)` per write: a reply flood or a
// bulk import would otherwise spawn unbounded goroutines, each holding a DB
// connection and an index request. When the queue is full the task is dropped —
// indexing is best-effort and ReindexAll recovers anything missed.
var indexPool = bg.New("search", 4, 4096)

// Indexer mirrors individual Postgres rows into the search indexes as they are
// written. This is the write-path half of the search pipeline: the reindexer
// (reindex.go) rebuilds everything, the Indexer keeps it current.
//
// Every Sync* method re-reads the row by id rather than trusting a payload from
// the write site. That is deliberate: it keeps the document shape in one place
// (the base queries), makes "last write wins" automatic, and means privacy
// transitions are handled for free — when a profile turns private or a board
// turns private, the row no longer matches the query, so the stale document is
// deleted instead of updated.
//
// All methods are asynchronous, non-blocking, and safe to call on a nil
// *Indexer, so a write site announces a change without a nil check and without
// risking the request path.
type Indexer struct {
	db  *sql.DB
	svc *Service
}

// NewIndexer builds an Indexer. It returns nil when the engine is not configured
// so call sites can keep a nil field and still call it safely.
func NewIndexer(db *sql.DB, svc *Service) *Indexer {
	if db == nil || svc == nil || !svc.Enabled() {
		return nil
	}
	return &Indexer{db: db, svc: svc}
}

// SyncUser mirrors users.id after a register, profile edit, avatar swap or
// public-id change. A private profile yields no row and is removed from the index.
func (i *Indexer) SyncUser(id string) {
	syncDoc(i, "user", IndexUsers, usersBaseQuery+" AND u.id = $1", scanUserDoc, id)
}

// SyncBoard mirrors boards.id after a board/gomosub create or update.
func (i *Indexer) SyncBoard(id string) {
	syncDoc(i, "board", IndexBoards, boardsBaseQuery+" AND id = $1", scanBoardDoc, id)
}

// SyncThread mirrors threads.id after a thread create, edit or delete.
func (i *Indexer) SyncThread(id string) {
	syncDoc(i, "thread", IndexThreads, threadsBaseQuery+" AND t.id = $1", scanThreadDoc, id)
}

// SyncPost mirrors posts.id after a reply create, edit or delete.
func (i *Indexer) SyncPost(id string) {
	syncDoc(i, "post", IndexPosts, postsBaseQuery+" AND p.id = $1", scanPostDoc, id)
}

// syncDoc schedules one row sync on the pool. Generic functions cannot be
// methods in Go, so it takes the Indexer explicitly; the Sync* methods above are
// the typed entry points.
func syncDoc[T any](i *Indexer, label, indexKey, query string, scan func(rowScanner) (T, error), id string) {
	if i == nil || id == "" {
		return
	}
	indexPool.Go(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := syncNow(ctx, i, indexKey, query, scan, id); err != nil {
			log.Printf("[search] sync %s %s failed: %v", label, id, err)
		}
	})
}

// syncNow performs a single row sync synchronously. It is the deterministic core
// the pool runs, kept separate so tests can exercise it without racing a worker.
func syncNow[T any](ctx context.Context, i *Indexer, indexKey, query string, scan func(rowScanner) (T, error), id string) error {
	doc, err := scan(i.db.QueryRowContext(ctx, query, id))
	switch {
	case err == sql.ErrNoRows:
		// Not indexable (deleted, remote, private profile, private board,
		// private post) — make sure no stale document survives.
		return i.svc.DeleteDocument(ctx, indexKey, id)
	case err != nil:
		return err
	default:
		return i.svc.UpsertDocuments(ctx, indexKey, []T{doc})
	}
}
