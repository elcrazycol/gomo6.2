package search

import (
	"context"
	"database/sql"
	"fmt"
)

// batchSize caps how many documents go into one Meilisearch request. The engine
// accepts far larger payloads, but a modest batch keeps memory and retry cost
// predictable on a small VPS.
const batchSize = 500

// ReindexStats reports how many documents were pushed per index.
type ReindexStats struct {
	Users     int
	Boards    int
	Threads   int
	Posts     int
	WallPosts int
}

// ReindexAll rebuilds every index from PostgreSQL. It is the recovery path for
// the best-effort write-path sync (which drops events under load) and the
// initial backfill for a fresh engine.
//
// Each index is cleared before it is repopulated, so stale documents — a profile
// that turned private, a deleted post — cannot survive a rebuild. That also
// means a full rebuild briefly empties each index; run it before enabling search
// or during low traffic rather than against a hot production query path.
func (s *Service) ReindexAll(ctx context.Context, db *sql.DB) (ReindexStats, error) {
	var stats ReindexStats
	if !s.Enabled() {
		return stats, ErrDisabled
	}
	if err := s.EnsureIndexes(ctx); err != nil {
		return stats, err
	}

	for _, key := range []string{IndexUsers, IndexBoards, IndexThreads, IndexPosts, IndexWallPosts} {
		if err := s.DeleteAllDocuments(ctx, key); err != nil {
			return stats, err
		}
	}

	var err error
	if stats.Users, err = s.reindexUsers(ctx, db); err != nil {
		return stats, err
	}
	if stats.Boards, err = s.reindexBoards(ctx, db); err != nil {
		return stats, err
	}
	if stats.Threads, err = s.reindexThreads(ctx, db); err != nil {
		return stats, err
	}
	if stats.Posts, err = s.reindexPosts(ctx, db); err != nil {
		return stats, err
	}
	if stats.WallPosts, err = s.reindexWallPosts(ctx, db); err != nil {
		return stats, err
	}
	return stats, nil
}

func (s *Service) reindexUsers(ctx context.Context, db *sql.DB) (int, error) {
	return reindexTable(ctx, db, usersBaseQuery, scanUserDoc,
		func(ctx context.Context, docs []UserDoc) error {
			return s.UpsertDocuments(ctx, IndexUsers, docs)
		})
}

func (s *Service) reindexBoards(ctx context.Context, db *sql.DB) (int, error) {
	return reindexTable(ctx, db, boardsBaseQuery, scanBoardDoc,
		func(ctx context.Context, docs []BoardDoc) error {
			return s.UpsertDocuments(ctx, IndexBoards, docs)
		})
}

func (s *Service) reindexThreads(ctx context.Context, db *sql.DB) (int, error) {
	return reindexTable(ctx, db, threadsBaseQuery, scanThreadDoc,
		func(ctx context.Context, docs []ThreadDoc) error {
			return s.UpsertDocuments(ctx, IndexThreads, docs)
		})
}

func (s *Service) reindexPosts(ctx context.Context, db *sql.DB) (int, error) {
	return reindexTable(ctx, db, postsBaseQuery, scanPostDoc,
		func(ctx context.Context, docs []PostDoc) error {
			return s.UpsertDocuments(ctx, IndexPosts, docs)
		})
}

func (s *Service) reindexWallPosts(ctx context.Context, db *sql.DB) (int, error) {
	return reindexTable(ctx, db, wallPostsBaseQuery, scanWallPostDoc,
		func(ctx context.Context, docs []WallPostDoc) error {
			return s.UpsertDocuments(ctx, IndexWallPosts, docs)
		})
}

// reindexTable streams a query and pushes documents in batches of batchSize.
func reindexTable[T any](
	ctx context.Context,
	db *sql.DB,
	query string,
	scan func(rowScanner) (T, error),
	flush func(context.Context, []T) error,
) (int, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	total := 0
	batch := make([]T, 0, batchSize)
	for rows.Next() {
		doc, err := scan(rows)
		if err != nil {
			return total, err
		}
		batch = append(batch, doc)
		if len(batch) == batchSize {
			if err := flush(ctx, batch); err != nil {
				return total, err
			}
			total += len(batch)
			batch = batch[:0]
		}
	}
	if err := rows.Err(); err != nil {
		return total, err
	}
	if len(batch) > 0 {
		if err := flush(ctx, batch); err != nil {
			return total, err
		}
		total += len(batch)
	}
	return total, nil
}

func nullInt64Ptr(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

// String renders the stats for logs and CLI output.
func (s ReindexStats) String() string {
	return fmt.Sprintf("%d users, %d boards, %d threads, %d posts, %d wall posts",
		s.Users, s.Boards, s.Threads, s.Posts, s.WallPosts)
}
