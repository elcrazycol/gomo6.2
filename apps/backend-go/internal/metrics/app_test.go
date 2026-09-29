package metrics

import (
	"bytes"
	"strings"
	"testing"
)

func TestAppMetrics_CountersAndRendering(t *testing.T) {
	a := &AppMetrics{}
	a.RegistrationCreated()
	a.ThreadCreated()
	a.PostCreated()
	a.ChatMessageSent()
	a.TableCreated("profile_wall_posts")
	a.TableCreated("some_other_table") // must be ignored

	var buf bytes.Buffer
	a.writeTo(&buf)
	out := buf.String()

	for _, want := range []string{
		"app_registrations_total 1",
		"app_threads_created_total 1",
		"app_posts_created_total 1",
		"app_wall_posts_created_total 1",
		"app_chat_messages_total 1",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in /metrics output:\n%s", want, out)
		}
	}
}

// The global instance must be usable without any setup (it is referenced from
// request handlers).
func TestAppMetrics_GlobalInstanceRenders(t *testing.T) {
	var buf bytes.Buffer
	App.writeTo(&buf)
	if !strings.Contains(buf.String(), "app_registrations_total") {
		t.Fatal("global App metrics did not render")
	}
}
