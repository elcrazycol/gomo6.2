package search

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ErrDisabled is returned by write operations when no engine is configured.
var ErrDisabled = errors.New("search: meilisearch is not configured")

// Config configures the search service. An empty URL disables it entirely:
// every method degrades to a no-op and the PostgreSQL full-text fallback stays
// in charge.
type Config struct {
	URL         string
	MasterKey   string
	IndexPrefix string
}

// Service is the application-facing handle to the search engine. A Service
// built with an empty Config.URL is disabled: Enabled reports false and
// mutations return ErrDisabled, so callers can be wired up before the engine
// exists in the environment.
type Service struct {
	client  *client
	prefix  string
	schemas []indexSchema
	byKey   map[string]indexSchema
}

// New builds a Service. It never returns nil and never dials the engine; a
// missing URL yields a disabled Service.
func New(cfg Config) *Service {
	s := &Service{
		prefix:  strings.TrimSpace(cfg.IndexPrefix),
		schemas: indexSchemas(),
		byKey:   make(map[string]indexSchema),
	}
	for _, sc := range s.schemas {
		s.byKey[sc.key] = sc
	}
	if strings.TrimSpace(cfg.URL) == "" {
		return s
	}
	s.client = newClient(cfg.URL, strings.TrimSpace(cfg.MasterKey))
	return s
}

// Enabled reports whether an engine is configured.
func (s *Service) Enabled() bool { return s != nil && s.client != nil }

// IndexUID returns the physical Meilisearch index UID for a logical index key.
func (s *Service) IndexUID(key string) string {
	if s == nil {
		return key
	}
	if s.prefix == "" {
		return key
	}
	return s.prefix + key
}

// indexUID validates the logical key and resolves its physical UID.
func (s *Service) indexUID(key string) (string, error) {
	if _, ok := s.byKey[key]; !ok {
		return "", fmt.Errorf("search: unknown index %q", key)
	}
	return s.IndexUID(key), nil
}

// Health pings the engine.
func (s *Service) Health(ctx context.Context) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	return s.client.health(ctx)
}

// EnsureIndexes creates every index and applies its settings. It is idempotent:
// re-running updates settings in place. Settings are applied before documents
// because Meilisearch rejects documents whose fields are not yet declared
// filterable/sortable.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	for _, sc := range s.schemas {
		uid := s.IndexUID(sc.key)

		// Creating an existing index yields a failed task with code
		// index_already_exists; treat that as success rather than pre-checking
		// (which would race with a concurrent creator).
		createUID, err := s.client.submit(ctx, http.MethodPost, "/indexes", map[string]interface{}{
			"uid":        uid,
			"primaryKey": sc.primaryKey,
		})
		if err != nil {
			return fmt.Errorf("create index %s: %w", uid, err)
		}
		if err := s.client.waitTask(ctx, createUID); err != nil && !isAlreadyExists(err) {
			return fmt.Errorf("create index %s: %w", uid, err)
		}

		settingsUID, err := s.client.submit(ctx, http.MethodPatch, "/indexes/"+uid+"/settings", map[string]interface{}{
			"searchableAttributes": sc.searchable,
			"filterableAttributes": sc.filterable,
			"sortableAttributes":   sc.sortable,
		})
		if err != nil {
			return fmt.Errorf("update settings %s: %w", uid, err)
		}
		if err := s.client.waitTask(ctx, settingsUID); err != nil {
			return fmt.Errorf("update settings %s: %w", uid, err)
		}
	}
	return nil
}

// UpsertDocuments adds or fully replaces documents in one index. docs may be any
// JSON-serialisable collection (the *Doc types in this package) and is sent in a
// single request, so callers should batch large updates.
func (s *Service) UpsertDocuments(ctx context.Context, key string, docs interface{}) error {
	uid, err := s.indexUID(key)
	if err != nil {
		return err
	}
	if !s.Enabled() {
		return ErrDisabled
	}
	uidNum, err := s.client.submit(ctx, http.MethodPost, "/indexes/"+uid+"/documents", docs)
	if err != nil {
		return fmt.Errorf("upsert %s: %w", uid, err)
	}
	return s.client.waitTask(ctx, uidNum)
}

// UpdateDocuments merges fields into existing documents (a partial update,
// unlike UpsertDocuments which replaces the whole document).
func (s *Service) UpdateDocuments(ctx context.Context, key string, docs interface{}) error {
	uid, err := s.indexUID(key)
	if err != nil {
		return err
	}
	if !s.Enabled() {
		return ErrDisabled
	}
	uidNum, err := s.client.submit(ctx, http.MethodPut, "/indexes/"+uid+"/documents", docs)
	if err != nil {
		return fmt.Errorf("update %s: %w", uid, err)
	}
	return s.client.waitTask(ctx, uidNum)
}

// DeleteDocument removes a single document by primary key.
func (s *Service) DeleteDocument(ctx context.Context, key, id string) error {
	uid, err := s.indexUID(key)
	if err != nil {
		return err
	}
	if !s.Enabled() {
		return ErrDisabled
	}
	uidNum, err := s.client.submit(ctx, http.MethodDelete, "/indexes/"+uid+"/documents/"+id, nil)
	if err != nil {
		return fmt.Errorf("delete %s/%s: %w", uid, id, err)
	}
	return s.client.waitTask(ctx, uidNum)
}

// DeleteAllDocuments clears an index. Used by a full rebuild.
func (s *Service) DeleteAllDocuments(ctx context.Context, key string) error {
	uid, err := s.indexUID(key)
	if err != nil {
		return err
	}
	if !s.Enabled() {
		return ErrDisabled
	}
	uidNum, err := s.client.submit(ctx, http.MethodDelete, "/indexes/"+uid+"/documents", nil)
	if err != nil {
		return fmt.Errorf("clear %s: %w", uid, err)
	}
	return s.client.waitTask(ctx, uidNum)
}

func isAlreadyExists(err error) bool {
	return err != nil && strings.Contains(err.Error(), "index_already_exists")
}

// MultiQuery is one index query in a MultiSearch call.
type MultiQuery struct {
	// IndexKey is a logical index name (IndexUsers, IndexThreads, …).
	IndexKey string
	Query    string
	// Filter is a Meilisearch filter expression. Callers must build it only
	// from server-generated values (UUIDs, integers, fixed enums) — see
	// AndFilter — never from raw user text.
	Filter string
	Sort   []string
	Limit  int
	Offset int
}

// SearchResponse is the subset of a Meilisearch search result the API uses.
type SearchResponse struct {
	Hits               []map[string]interface{}
	EstimatedTotalHits int
	ProcessingTimeMs   int
}

// MultiSearch runs several index queries in one round trip and returns the
// results keyed by the logical index key.
func (s *Service) MultiSearch(ctx context.Context, queries []MultiQuery) (map[string]SearchResponse, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	if len(queries) == 0 {
		return map[string]SearchResponse{}, nil
	}

	uidToKey := make(map[string]string, len(queries))
	req := make([]multiQuery, 0, len(queries))
	for _, q := range queries {
		uid, err := s.indexUID(q.IndexKey)
		if err != nil {
			return nil, err
		}
		uidToKey[uid] = q.IndexKey
		req = append(req, multiQuery{
			IndexUID: uid,
			Query:    q.Query,
			Filter:   q.Filter,
			Sort:     q.Sort,
			Limit:    q.Limit,
			Offset:   q.Offset,
		})
	}

	items, err := s.client.multiSearch(ctx, req)
	if err != nil {
		return nil, err
	}
	out := make(map[string]SearchResponse, len(items))
	for _, item := range items {
		key := uidToKey[item.IndexUID]
		if key == "" {
			continue
		}
		out[key] = SearchResponse{
			Hits:               item.Hits,
			EstimatedTotalHits: item.EstimatedTotalHits,
			ProcessingTimeMs:   item.ProcessingTimeMs,
		}
	}
	return out, nil
}
