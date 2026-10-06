package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// client is a deliberately small Meilisearch REST client built on the standard
// library. The backend ships vendored and is built offline (no network at build
// time), so pulling in the official SDK — and its dependency tree — is not worth
// it for the handful of endpoints we call.
type client struct {
	baseURL   string
	masterKey string
	http      *http.Client
}

func newClient(baseURL, masterKey string) *client {
	return &client{
		baseURL:   strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		masterKey: masterKey,
		http:      &http.Client{Timeout: 30 * time.Second},
	}
}

// task is the subset of a Meilisearch task we care about. Task-creation
// responses use "taskUid"; the /tasks/{uid} endpoint uses "uid", so both are
// captured.
type task struct {
	UID      int64      `json:"taskUid"`
	Status   string     `json:"status"`
	Type     string     `json:"type"`
	IndexUID string     `json:"indexUid"`
	Error    *taskError `json:"error"`
}

type taskError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

// taskStatus models GET /tasks/{uid}.
type taskStatus struct {
	UID    int64      `json:"uid"`
	Status string     `json:"status"`
	Error  *taskError `json:"error"`
}

func (c *client) do(ctx context.Context, method, path string, body, out interface{}) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("meilisearch: marshal body: %w", err)
		}
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("meilisearch: build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.masterKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.masterKey)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("meilisearch: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	// Cap the body we read: Meilisearch error payloads are small, and we never
	// want a proxy response to exhaust memory.
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("meilisearch: %s %s: %s: %s", method, path, resp.Status, strings.TrimSpace(string(data)))
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("meilisearch: decode response: %w", err)
		}
	}
	return nil
}

// submit enqueues an asynchronous write and returns its task UID.
func (c *client) submit(ctx context.Context, method, path string, body interface{}) (int64, error) {
	var t task
	if err := c.do(ctx, method, path, body, &t); err != nil {
		return 0, err
	}
	return t.UID, nil
}

// waitTask blocks until the task reaches a terminal state. Meilisearch indexes
// asynchronously, so callers that depend on the effect being visible (settings
// before documents, a reindex before serving) must wait.
func (c *client) waitTask(ctx context.Context, uid int64) error {
	deadline := time.Now().Add(2 * time.Minute)
	for {
		var st taskStatus
		if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/tasks/%d", uid), nil, &st); err != nil {
			return err
		}
		switch st.Status {
		case "succeeded":
			return nil
		case "failed", "canceled":
			msg := "unknown error"
			code := ""
			if st.Error != nil {
				if st.Error.Message != "" {
					msg = st.Error.Message
				}
				code = st.Error.Code
			}
			if code != "" {
				return fmt.Errorf("meilisearch: task %d %s: %s (%s)", uid, st.Status, msg, code)
			}
			return fmt.Errorf("meilisearch: task %d %s: %s", uid, st.Status, msg)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("meilisearch: task %d timed out (status %q)", uid, st.Status)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func (c *client) health(ctx context.Context) error {
	return c.do(ctx, http.MethodGet, "/health", nil, nil)
}

// multiQuery is one query inside a POST /multi-search request.
type multiQuery struct {
	IndexUID string   `json:"indexUid"`
	Query    string   `json:"q"`
	Filter   string   `json:"filter,omitempty"`
	Sort     []string `json:"sort,omitempty"`
	Limit    int      `json:"limit,omitempty"`
	Offset   int      `json:"offset,omitempty"`
}

type multiSearchRequest struct {
	Queries []multiQuery `json:"queries"`
}

type multiSearchItem struct {
	IndexUID           string                   `json:"indexUid"`
	Hits               []map[string]interface{} `json:"hits"`
	EstimatedTotalHits int                      `json:"estimatedTotalHits"`
	ProcessingTimeMs   int                      `json:"processingTimeMs"`
}

type multiSearchResponse struct {
	Results []multiSearchItem `json:"results"`
}

// multiSearch runs several index queries in a single round trip. Meilisearch
// returns one result per query, tagged with its indexUid.
func (c *client) multiSearch(ctx context.Context, queries []multiQuery) ([]multiSearchItem, error) {
	var resp multiSearchResponse
	if err := c.do(ctx, http.MethodPost, "/multi-search", multiSearchRequest{Queries: queries}, &resp); err != nil {
		return nil, err
	}
	return resp.Results, nil
}
