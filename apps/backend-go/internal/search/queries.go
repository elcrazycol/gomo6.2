package search

import "database/sql"

// The base queries are the single source of truth for how a Postgres row maps
// to an index document and — critically — for the privacy clauses that decide
// whether a row is indexable at all. Both the full rebuild (reindex.go) and the
// write-path sync (indexer.go) build on them: the rebuild runs the query as-is,
// the sync appends an id predicate. Keeping them together means the two paths
// can never drift apart on privacy.

const usersBaseQuery = `
	SELECT u.id, u.public_id, u.username, COALESCE(u.display_name, ''),
	       COALESCE(u.avatar_url, ''), COALESCE(u.is_remote, false),
	       COALESCE(EXTRACT(EPOCH FROM u.created_at)::bigint, 0)
	FROM users u
	LEFT JOIN privacy_settings ps ON ps.user_id = u.id
	WHERE COALESCE(u.is_remote, false) = false
	  AND COALESCE(ps.private_profile, false) = false`

const boardsBaseQuery = `
	SELECT id, slug, name, COALESCE(description, ''), COALESCE(cover_image_url, ''),
	       COALESCE(is_gomosub, false),
	       COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0)
	FROM boards
	WHERE COALESCE(visibility, 'public') = 'public'`

const threadsBaseQuery = `
	SELECT t.id, t.public_id, t.title, COALESCE(t.content, ''),
	       COALESCE(EXTRACT(EPOCH FROM t.created_at)::bigint, 0),
	       COALESCE(EXTRACT(EPOCH FROM t.updated_at)::bigint, 0),
	       t.board_id, b.slug, b.name, COALESCE(b.is_gomosub, false), 'public',
	       COALESCE(t.user_id::text, ''), COALESCE(u.username, ''), COALESCE(u.avatar_url, '')
	FROM threads t
	JOIN boards b ON b.id = t.board_id
	LEFT JOIN users u ON u.id = t.user_id
	WHERE COALESCE(b.visibility, 'public') = 'public'`

const postsBaseQuery = `
	SELECT p.id, COALESCE(p.content, ''),
	       COALESCE(EXTRACT(EPOCH FROM p.created_at)::bigint, 0),
	       p.thread_id, t.public_id, t.title,
	       t.board_id, b.slug, b.name, COALESCE(b.is_gomosub, false), 'public',
	       COALESCE(p.user_id::text, ''), COALESCE(u.username, ''), COALESCE(u.avatar_url, '')
	FROM posts p
	JOIN threads t ON t.id = p.thread_id
	JOIN boards b ON b.id = t.board_id
	LEFT JOIN users u ON u.id = p.user_id
	WHERE COALESCE(b.visibility, 'public') = 'public'
	  AND COALESCE(p.is_private, false) = false`

// rowScanner is satisfied by both *sql.Row and *sql.Rows, so one scan function
// serves the list (rebuild) and the single-row (sync) paths.
type rowScanner interface {
	Scan(dest ...interface{}) error
}

func scanUserDoc(s rowScanner) (UserDoc, error) {
	var doc UserDoc
	var publicID sql.NullInt64
	if err := s.Scan(&doc.ID, &publicID, &doc.Username, &doc.DisplayName, &doc.AvatarURL, &doc.IsRemote, &doc.CreatedAt); err != nil {
		return doc, err
	}
	doc.PublicID = nullInt64Ptr(publicID)
	return doc, nil
}

func scanBoardDoc(s rowScanner) (BoardDoc, error) {
	var doc BoardDoc
	err := s.Scan(&doc.ID, &doc.Slug, &doc.Name, &doc.Description, &doc.CoverImageURL, &doc.IsGomosub, &doc.CreatedAt)
	return doc, err
}

func scanThreadDoc(s rowScanner) (ThreadDoc, error) {
	var doc ThreadDoc
	var publicID sql.NullInt64
	if err := s.Scan(
		&doc.ID, &publicID, &doc.Title, &doc.Content,
		&doc.CreatedAt, &doc.UpdatedAt,
		&doc.BoardID, &doc.BoardSlug, &doc.BoardName, &doc.BoardIsGomosub, &doc.BoardVisibility,
		&doc.AuthorID, &doc.AuthorUsername, &doc.AuthorAvatarURL,
	); err != nil {
		return doc, err
	}
	doc.PublicID = nullInt64Ptr(publicID)
	return doc, nil
}

func scanPostDoc(s rowScanner) (PostDoc, error) {
	var doc PostDoc
	var threadPublicID sql.NullInt64
	if err := s.Scan(
		&doc.ID, &doc.Content, &doc.CreatedAt,
		&doc.ThreadID, &threadPublicID, &doc.ThreadTitle,
		&doc.BoardID, &doc.BoardSlug, &doc.BoardName, &doc.BoardIsGomosub, &doc.BoardVisibility,
		&doc.AuthorID, &doc.AuthorUsername, &doc.AuthorAvatarURL,
	); err != nil {
		return doc, err
	}
	doc.ThreadPublicID = nullInt64Ptr(threadPublicID)
	return doc, nil
}
