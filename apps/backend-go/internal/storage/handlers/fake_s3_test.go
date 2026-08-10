package handlers

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/storage"
)

// testEncryptionKey is a fixed 32-byte master key. crypto.Init uses sync.Once,
// so every test in this package must agree on the same value: the first test
// that encrypts a messenger object locks it in for the whole binary.
const testEncryptionKey = "0123456789abcdef0123456789abcdef"

func TestMain(m *testing.M) {
	os.Setenv("MESSENGER_ENCRYPTION_KEY", testEncryptionKey)
	code := m.Run()
	os.Exit(code)
}

// fakeS3Object is a single stored object in the in-memory S3.
type fakeS3Object struct {
	data        []byte
	contentType string
}

// fakeS3 is a minimal in-memory S3-compatible server that speaks just enough
// of the API for the storage client: HeadBucket, PutObject, GetObject (with
// Range support), HeadObject, DeleteObject and ListObjectsV2.
type fakeS3 struct {
	mu      sync.Mutex
	objects map[string]fakeS3Object
}

func newFakeS3() *fakeS3 {
	return &fakeS3{objects: make(map[string]fakeS3Object)}
}

func (f *fakeS3) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()

		path := strings.TrimPrefix(r.URL.Path, "/")
		bucket, key := path, ""
		if idx := strings.Index(path, "/"); idx >= 0 {
			bucket, key = path[:idx], path[idx+1:]
		}
		objKey := bucket + "/" + key

		switch r.Method {
		case http.MethodHead:
			if key == "" {
				// HeadBucket — pretend every allowed bucket exists.
				w.WriteHeader(http.StatusOK)
				return
			}
			if _, ok := f.objects[objKey]; ok {
				w.WriteHeader(http.StatusOK)
				return
			}
			http.Error(w, "Not Found", http.StatusNotFound)
		case http.MethodPut:
			data, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "read body", http.StatusBadRequest)
				return
			}
			f.objects[objKey] = fakeS3Object{data: data, contentType: r.Header.Get("Content-Type")}
			w.Header().Set("ETag", `"fake-etag"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			if key == "" {
				// ListObjectsV2 (used by orphan cleanup) — empty listing is fine.
				w.Header().Set("Content-Type", "application/xml")
				fmt.Fprintf(w, `<ListBucketResult><Name>%s</Name></ListBucketResult>`, bucket)
				return
			}
			obj, ok := f.objects[objKey]
			if !ok {
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprint(w, `<Error><Code>NoSuchKey</Code><Message>not found</Message></Error>`)
				return
			}
			data := obj.data
			status := http.StatusOK
			if rh := r.Header.Get("Range"); rh != "" {
				if start, end, ok := parseRangeHeader(rh, len(data)); ok {
					status = http.StatusPartialContent
					w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(data)))
					data = data[start : end+1]
				}
			}
			if obj.contentType != "" {
				w.Header().Set("Content-Type", obj.contentType)
			}
			w.Header().Set("ETag", `"fake-etag"`)
			w.WriteHeader(status)
			_, _ = w.Write(data)
		case http.MethodDelete:
			delete(f.objects, objKey)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}

func parseRangeHeader(rh string, size int) (int, int, bool) {
	if !strings.HasPrefix(rh, "bytes=") {
		return 0, 0, false
	}
	spec := strings.TrimPrefix(rh, "bytes=")
	dash := strings.Index(spec, "-")
	if dash < 0 {
		return 0, 0, false
	}
	start := 0
	if s := spec[:dash]; s != "" {
		v, err := strconv.Atoi(s)
		if err != nil || v < 0 {
			return 0, 0, false
		}
		start = v
	}
	end := size - 1
	if e := spec[dash+1:]; e != "" {
		v, err := strconv.Atoi(e)
		if err != nil || v < 0 {
			return 0, 0, false
		}
		end = v
	}
	if start > end || start >= size {
		return 0, 0, false
	}
	if end >= size {
		end = size - 1
	}
	return start, end, true
}

// get returns the raw bytes stored for a bucket/key pair (still encrypted for
// the "uploads" bucket, exactly as they sit in Garage).
func (f *fakeS3) get(bucket, key string) ([]byte, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	obj, ok := f.objects[bucket+"/"+key]
	return obj.data, ok
}

// put seeds an object directly (bypassing the HTTP API) for tests that need a
// known initial state.
func (f *fakeS3) put(bucket, key string, data []byte, contentType string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[bucket+"/"+key] = fakeS3Object{data: data, contentType: contentType}
}

// setupStorageHandlerWithS3 builds a StorageHandler wired to a fake S3 server
// and a real storage client — the same construction as production, minus
// Garage. Pass db=nil for public-bucket flows; pass sqlmock for the private
// messenger authorization paths.
func setupStorageHandlerWithS3(t *testing.T, db *sql.DB) (*StorageHandler, *fakeS3) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	f := newFakeS3()
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)

	t.Setenv("GARAGE_S3_ENDPOINT", srv.URL)
	t.Setenv("GARAGE_S3_ACCESS_KEY", "test-access-key")
	t.Setenv("GARAGE_S3_SECRET_KEY", "test-secret-key")
	t.Setenv("GARAGE_S3_REGION", "garage")

	client, err := storage.NewStorageClient()
	if err != nil {
		t.Fatalf("NewStorageClient: %v", err)
	}
	return NewStorageHandler(client, db), f
}
