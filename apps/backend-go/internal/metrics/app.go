package metrics

import (
	"fmt"
	"io"
	"sync/atomic"
)

// AppMetrics counts product-level events (registrations, content, chat).
//
// Like MessengerMetrics these are plain atomics so /metrics stays
// dependency-free. Each counter is incremented at the single write choke point
// of its feature, so the number cannot drift from what the database actually
// accepted.
type AppMetrics struct {
	registrations atomic.Uint64
	threads       atomic.Uint64
	posts         atomic.Uint64
	wallPosts     atomic.Uint64
	chatMessages  atomic.Uint64
}

// App is the process-wide product-metrics instance.
var App = &AppMetrics{}

// RegistrationCreated counts a successful account creation.
func (a *AppMetrics) RegistrationCreated() { a.registrations.Add(1) }

// ThreadCreated counts a successfully created thread.
func (a *AppMetrics) ThreadCreated() { a.threads.Add(1) }

// PostCreated counts a successfully created post inside a thread.
func (a *AppMetrics) PostCreated() { a.posts.Add(1) }

// WallPostCreated counts a successfully created profile-wall post.
func (a *AppMetrics) WallPostCreated() { a.wallPosts.Add(1) }

// ChatMessageSent counts a successfully persisted messenger message.
func (a *AppMetrics) ChatMessageSent() { a.chatMessages.Add(1) }

// TableCreated maps a generic CRUD insert to a product counter. Only content
// tables are counted; everything else is ignored.
func (a *AppMetrics) TableCreated(table string) {
	if table == "profile_wall_posts" {
		a.WallPostCreated()
	}
}

// writeTo renders the product counters. Called by the /metrics handler.
func (a *AppMetrics) writeTo(w io.Writer) {
	_, _ = fmt.Fprintf(w,
		"# TYPE app_registrations_total counter\n"+
			"app_registrations_total %d\n"+
			"# TYPE app_threads_created_total counter\n"+
			"app_threads_created_total %d\n"+
			"# TYPE app_posts_created_total counter\n"+
			"app_posts_created_total %d\n"+
			"# TYPE app_wall_posts_created_total counter\n"+
			"app_wall_posts_created_total %d\n"+
			"# TYPE app_chat_messages_total counter\n"+
			"app_chat_messages_total %d\n",
		a.registrations.Load(),
		a.threads.Load(),
		a.posts.Load(),
		a.wallPosts.Load(),
		a.chatMessages.Load(),
	)
}
