package handlers

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/storage"
)

const (
	orphanCleanupInterval = 6 * time.Hour
	orphanGracePeriod     = 24 * time.Hour
	orphanCleanupBatch    = 500
)

// StartOrphanCleanup starts a low-frequency maintenance loop for uploads that
// were persisted but never attached to a chat message. The grace period covers
// normal upload->send retries; only the private messenger bucket is scanned.
func (h *StorageHandler) StartOrphanCleanup() {
	if h == nil || h.client == nil || h.db == nil {
		return
	}
	go func() {
		// Run once after startup, then periodically. Failures are logged and do
		// not affect request handling or server readiness.
		h.cleanupOrphanMessengerObjects()
		ticker := time.NewTicker(orphanCleanupInterval)
		defer ticker.Stop()
		for range ticker.C {
			h.cleanupOrphanMessengerObjects()
		}
	}()
}

func (h *StorageHandler) cleanupOrphanMessengerObjects() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	cutoff := time.Now().UTC().Add(-orphanGracePeriod)
	removed := 0
	err := h.client.ForEachObject(ctx, "uploads", "", func(object storage.ListedObject) error {
		if removed >= orphanCleanupBatch || object.LastModified.IsZero() || object.LastModified.After(cutoff) {
			return nil
		}
		key := object.Key
		if !strings.Contains(key, "/messenger/") {
			return nil
		}
		lookupKey := attachmentKeyForLookup(key)
		var referenced bool
		if err := h.db.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM message_attachments WHERE url = $1
			)`, lookupKey).Scan(&referenced); err != nil {
			log.Printf("storage cleanup: check %s: %v", key, err)
			return nil
		}
		if referenced {
			return nil
		}

		if err := h.client.DeleteFile("uploads", key); err != nil {
			log.Printf("storage cleanup: delete %s: %v", key, err)
			return nil
		}
		removed++
		if !isPreviewKey(key) && isImageKey(key) {
			_ = h.client.DeleteFile("uploads", key+".preview.jpg")
		}
		return nil
	})
	if err != nil {
		log.Printf("storage cleanup: list uploads: %v", err)
	}
	if removed > 0 {
		log.Printf("storage cleanup: removed %d unreferenced messenger objects", removed)
	}
}
