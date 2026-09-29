// Package bg runs best-effort background work on a bounded number of worker
// goroutines.
//
// Request handlers and event loops must never spawn a goroutine per event:
// under a burst (reconnect storm, like flood, push fan-out) that produces an
// unbounded number of goroutines, each potentially holding a DB connection or
// a Redis client, and the process degrades until Postgres refuses connections.
//
// A Pool fixes the worker count up front. Go enqueues without blocking and
// reports whether the task was accepted; when the queue is full the task is
// dropped and counted instead of piling up. Callers use it only for work that
// is safe to drop (cache writes, realtime fan-out) — the client either refetches
// or the next event republishes.
package bg

import (
	"fmt"
	"io"
	"log"
	"sort"
	"sync"
	"sync/atomic"
)

// Pool is a fixed-size worker set with a bounded task queue.
type Pool struct {
	name    string
	workers int
	tasks   chan func()
	dropped atomic.Uint64
	once    sync.Once
}

var (
	registryMu sync.Mutex
	registry   = map[string]*Pool{}
)

// New creates a pool and registers it for metrics. workers and queueLen are
// clamped to a minimum of 1 so a misconfigured value cannot deadlock the pool.
func New(name string, workers, queueLen int) *Pool {
	if workers < 1 {
		workers = 1
	}
	if queueLen < 1 {
		queueLen = 1
	}
	p := &Pool{
		name:    name,
		workers: workers,
		tasks:   make(chan func(), queueLen),
	}
	registryMu.Lock()
	registry[name] = p
	registryMu.Unlock()
	return p
}

// Go enqueues fn for execution. It never blocks: when the queue is full the task
// is dropped and Go returns false. Workers start lazily on first use. fn runs on
// a worker goroutine; a panic is recovered and logged so it cannot kill the pool.
func (p *Pool) Go(fn func()) bool {
	if p == nil || fn == nil {
		return false
	}
	p.once.Do(func() {
		for i := 0; i < p.workers; i++ {
			go p.run()
		}
	})
	select {
	case p.tasks <- fn:
		return true
	default:
		n := p.dropped.Add(1)
		// Log sparsely: a saturated pool must not itself become a log flood.
		if n == 1 || n%1000 == 0 {
			log.Printf("[bg] %s: queue full, dropped %d task(s)", p.name, n)
		}
		return false
	}
}

func (p *Pool) run() {
	for fn := range p.tasks {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[bg] %s: task panicked: %v", p.name, r)
				}
			}()
			fn()
		}()
	}
}

// Name returns the pool name.
func (p *Pool) Name() string { return p.name }

// QueueLen returns the number of tasks waiting to be executed.
func (p *Pool) QueueLen() int {
	if p == nil {
		return 0
	}
	return len(p.tasks)
}

// Dropped returns how many tasks were rejected because the queue was full.
func (p *Pool) Dropped() uint64 {
	if p == nil {
		return 0
	}
	return p.dropped.Load()
}

// WritePrometheus emits pool queue-depth and drop counters. Registered with the
// metrics package by the server so /metrics exposes background pressure.
func WritePrometheus(w io.Writer) {
	registryMu.Lock()
	pools := make([]*Pool, 0, len(registry))
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		pools = append(pools, registry[name])
	}
	registryMu.Unlock()

	for _, p := range pools {
		fmt.Fprintf(w, "# TYPE bg_queue_length gauge\nbg_queue_length{pool=%q} %d\n", p.name, p.QueueLen())
		fmt.Fprintf(w, "# TYPE bg_dropped_total counter\nbg_dropped_total{pool=%q} %d\n", p.name, p.Dropped())
	}
}
