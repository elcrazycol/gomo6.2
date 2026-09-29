package bg

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPool_GoRunsTask(t *testing.T) {
	p := New("test-run", 2, 8)

	done := make(chan struct{})
	if !p.Go(func() { close(done) }) {
		t.Fatal("Go returned false on an empty queue")
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("task did not run")
	}
}

func TestPool_DropsWhenQueueFull(t *testing.T) {
	p := New("test-drop", 1, 1)

	started := make(chan struct{})
	block := make(chan struct{})
	p.Go(func() {
		close(started)
		<-block
	})
	<-started // worker is now busy, queue is empty

	if !p.Go(func() {}) {
		t.Fatal("first queued task should be accepted")
	}
	if p.Go(func() {}) {
		t.Fatal("second queued task should be dropped: queue holds one item")
	}
	if got := p.Dropped(); got != 1 {
		t.Fatalf("Dropped() = %d, want 1", got)
	}

	close(block)
}

func TestPool_RecoversFromPanic(t *testing.T) {
	p := New("test-panic", 1, 4)

	panicked := make(chan struct{})
	p.Go(func() {
		defer close(panicked)
		panic("boom")
	})
	<-panicked

	// The worker must still be alive after recovering.
	done := make(chan struct{})
	if !p.Go(func() { close(done) }) {
		t.Fatal("pool rejected a task after a panic")
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("worker died after a panic")
	}
}

func TestPool_NilSafe(t *testing.T) {
	var p *Pool
	if p.Go(func() {}) {
		t.Fatal("nil pool accepted a task")
	}
	if p.QueueLen() != 0 || p.Dropped() != 0 {
		t.Fatal("nil pool stats should be zero")
	}
}

func TestPool_WorkersBoundConcurrency(t *testing.T) {
	p := New("test-bound", 2, 64)

	var mu sync.Mutex
	inFlight, maxInFlight := 0, 0
	release := make(chan struct{})
	var wg sync.WaitGroup

	for i := 0; i < 8; i++ {
		wg.Add(1)
		ok := p.Go(func() {
			defer wg.Done()
			mu.Lock()
			inFlight++
			if inFlight > maxInFlight {
				maxInFlight = inFlight
			}
			mu.Unlock()
			<-release
			mu.Lock()
			inFlight--
			mu.Unlock()
		})
		if !ok {
			t.Fatal("task dropped unexpectedly")
		}
	}

	time.Sleep(100 * time.Millisecond)
	close(release)
	wg.Wait()

	if maxInFlight > 2 {
		t.Fatalf("maxInFlight = %d, want <= 2", maxInFlight)
	}
}

func TestWritePrometheus_IncludesRegisteredPools(t *testing.T) {
	p := New("test-prom-unique", 1, 1)

	var buf bytes.Buffer
	WritePrometheus(&buf)
	out := buf.String()

	if !strings.Contains(out, `bg_queue_length{pool="test-prom-unique"}`) {
		t.Fatalf("missing queue gauge:\n%s", out)
	}
	if !strings.Contains(out, `bg_dropped_total{pool="test-prom-unique"}`) {
		t.Fatalf("missing dropped counter:\n%s", out)
	}
	_ = p
}
