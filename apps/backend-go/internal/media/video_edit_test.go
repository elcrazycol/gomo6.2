package media

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestParseVideoEdit(t *testing.T) {
	t.Run("empty is not an error", func(t *testing.T) {
		got, err := ParseVideoEdit("  ")
		if err != nil || got != nil {
			t.Fatalf("ParseVideoEdit(empty) = (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("trim only", func(t *testing.T) {
		got, err := ParseVideoEdit(`{"start":1.25,"end":8.4}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Start != 1.25 || got.End != 8.4 || got.HasCrop() {
			t.Fatalf("unexpected edit: %+v", got)
		}
		if !got.HasTrim() {
			t.Fatal("HasTrim = false, want true")
		}
	})

	t.Run("crop only", func(t *testing.T) {
		got, err := ParseVideoEdit(`{"crop":{"x":0.1,"y":0.05,"w":0.8,"h":0.9}}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !got.HasCrop() || got.HasTrim() {
			t.Fatalf("unexpected edit: %+v", got)
		}
	})

	t.Run("muted", func(t *testing.T) {
		got, err := ParseVideoEdit(`{"muted":true}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !got.Muted || got.HasTransform() || got.HasTrim() || got.HasCrop() {
			t.Fatalf("unexpected edit: %+v", got)
		}
	})

	t.Run("poster", func(t *testing.T) {
		got, err := ParseVideoEdit(`{"poster":2.5}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Poster != 2.5 {
			t.Fatalf("unexpected poster: %+v", got)
		}
	})

	bad := map[string]string{
		"negative start":    `{"start":-1}`,
		"end before start":  `{"start":5,"end":3}`,
		"end equals start":  `{"start":5,"end":5}`,
		"crop too small":    `{"crop":{"x":0,"y":0,"w":0.001,"h":0.5}}`,
		"crop out of frame": `{"crop":{"x":0.5,"y":0,"w":0.6,"h":0.5}}`,
		"bad rotation":      `{"rotate":45}`,
		"negative poster":   `{"poster":-1}`,
		"unknown field":     `{"zoom":2}`,
		"not json":          `{`,
	}
	for name, raw := range bad {
		t.Run("rejects "+name, func(t *testing.T) {
			if _, err := ParseVideoEdit(raw); err == nil {
				t.Fatalf("ParseVideoEdit(%s) = nil error, want failure", raw)
			}
		})
	}
}

func TestVideoEditTrimDuration(t *testing.T) {
	capSeconds := maxVideoDuration.Seconds()
	cases := []struct {
		name string
		edit *VideoEdit
		want float64
	}{
		{"nil edit", nil, capSeconds},
		{"no trim", &VideoEdit{}, capSeconds},
		{"range", &VideoEdit{Start: 1, End: 4}, 3},
		{"range over cap is clamped", &VideoEdit{Start: 0, End: capSeconds * 4}, capSeconds},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.edit.trimDuration(); got != tc.want {
				t.Fatalf("trimDuration = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestVideoEditPosterOffset(t *testing.T) {
	cases := []struct {
		name string
		edit *VideoEdit
		want float64
	}{
		{"nil", nil, 0},
		{"unset", &VideoEdit{}, 0},
		{"absolute", &VideoEdit{Poster: 4}, 4},
		{"relative to trim start", &VideoEdit{Start: 1.5, Poster: 4}, 2.5},
		{"before the trim start clamps to 0", &VideoEdit{Start: 3, Poster: 1}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.edit.posterOffset(); got != tc.want {
				t.Fatalf("posterOffset = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBuildVideoFilter(t *testing.T) {
	if got := buildVideoFilter(nil); strings.Contains(got, "crop=") {
		t.Fatalf("no-edit filter must not crop: %s", got)
	}
	got := buildVideoFilter(&VideoEdit{Crop: &CropRect{X: 0.1, Y: 0.05, W: 0.8, H: 0.9}})
	for _, want := range []string{"crop=", "iw*0.800000", "ih*0.900000", "iw*0.100000", "ih*0.050000", "fps=30", "scale="} {
		if !strings.Contains(got, want) {
			t.Fatalf("filter %q missing %q", got, want)
		}
	}

	transformCases := []struct {
		name  string
		edit  VideoEdit
		wants []string
	}{
		{"mirror", VideoEdit{Mirror: true}, []string{"hflip"}},
		{"rotate 90", VideoEdit{Rotate: 90}, []string{"transpose=1"}},
		{"rotate 180", VideoEdit{Rotate: 180}, []string{"hflip,vflip"}},
		{"rotate 270", VideoEdit{Rotate: 270}, []string{"transpose=2"}},
		{"rotate 450 normalizes to 90", VideoEdit{Rotate: 450}, []string{"transpose=1"}},
	}
	for _, tc := range transformCases {
		t.Run(tc.name, func(t *testing.T) {
			filter := buildVideoFilter(&tc.edit)
			for _, want := range tc.wants {
				if !strings.Contains(filter, want) {
					t.Fatalf("filter %q missing %q", filter, want)
				}
			}
		})
	}

	t.Run("transform runs before crop", func(t *testing.T) {
		filter := buildVideoFilter(&VideoEdit{Mirror: true, Rotate: 90, Crop: &CropRect{X: 0, Y: 0, W: 1, H: 1}})
		mirror := strings.Index(filter, "hflip")
		rotate := strings.Index(filter, "transpose=1")
		crop := strings.Index(filter, "crop=")
		if mirror < 0 || rotate < 0 || crop < 0 || !(mirror < rotate && rotate < crop) {
			t.Fatalf("expected hflip < transpose < crop in %q", filter)
		}
	})
}

// makeTestVideo renders a tiny H.264/AAC clip locally so the integration tests
// exercise the real ffmpeg pipeline.
func makeTestVideo(t *testing.T) []byte {
	t.Helper()
	dir := t.TempDir()
	out := filepath.Join(dir, "src.mp4")
	cmd := exec.Command("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out)
	if outBytes, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg fixture failed: %v\n%s", err, outBytes)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return data
}

func probeDurationSeconds(t *testing.T, data []byte) float64 {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "probe.mp4")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write probe input: %v", err)
	}
	out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration",
		"-of", "json", path).Output()
	if err != nil {
		t.Fatalf("ffprobe duration failed: %v", err)
	}
	var res struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &res); err != nil {
		t.Fatalf("decode ffprobe: %v", err)
	}
	d, err := strconv.ParseFloat(res.Format.Duration, 64)
	if err != nil {
		t.Fatalf("parse duration %q: %v", res.Format.Duration, err)
	}
	return d
}

func TestGenerateVideoVariantsIntegration(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	data := makeTestVideo(t)

	t.Run("nil edit keeps the clip", func(t *testing.T) {
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Video) == 0 || len(got.Poster) == 0 {
			t.Fatal("expected non-empty video and poster")
		}
		if d := probeDurationSeconds(t, got.Video); d < 1.8 || d > 2.3 {
			t.Fatalf("duration = %v, want ~2s", d)
		}
		if !got.HasAudio {
			t.Fatal("source audio must be preserved")
		}
		if got.IsAnimated() {
			t.Fatal("a clip with audio must not be animated")
		}
		if got.Width != 320 || got.Height != 240 {
			t.Fatalf("output dims = %dx%d, want 320x240", got.Width, got.Height)
		}
	})

	t.Run("trim shortens the clip", func(t *testing.T) {
		edit := &VideoEdit{Start: 0.5, End: 1.5}
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", edit)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if d := probeDurationSeconds(t, got.Video); d < 0.7 || d > 1.4 {
			t.Fatalf("duration = %v, want ~1s", d)
		}
	})

	t.Run("crop reshapes the frame", func(t *testing.T) {
		edit := &VideoEdit{Crop: &CropRect{X: 0, Y: 0, W: 0.5, H: 0.5}}
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", edit)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		dir := t.TempDir()
		path := filepath.Join(dir, "cropped.mp4")
		if err := os.WriteFile(path, got.Video, 0o600); err != nil {
			t.Fatalf("write cropped: %v", err)
		}
		streams, err := probeVideoStreams(context.Background(), path)
		if err != nil {
			t.Fatalf("probe cropped: %v", err)
		}
		v := firstStream(streams, "video")
		if v.Width != 160 || v.Height != 120 {
			t.Fatalf("cropped frame = %dx%d, want 160x120", v.Width, v.Height)
		}
	})

	t.Run("rotate 90 swaps the frame", func(t *testing.T) {
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", &VideoEdit{Rotate: 90})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		dir := t.TempDir()
		path := filepath.Join(dir, "rotated.mp4")
		if err := os.WriteFile(path, got.Video, 0o600); err != nil {
			t.Fatalf("write rotated: %v", err)
		}
		streams, err := probeVideoStreams(context.Background(), path)
		if err != nil {
			t.Fatalf("probe rotated: %v", err)
		}
		v := firstStream(streams, "video")
		if v.Width != 240 || v.Height != 320 {
			t.Fatalf("rotated frame = %dx%d, want 240x320", v.Width, v.Height)
		}
		if got.Width != 240 || got.Height != 320 {
			t.Fatalf("reported dims = %dx%d, want 240x320", got.Width, got.Height)
		}
	})

	t.Run("mirror and rotate together", func(t *testing.T) {
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", &VideoEdit{Mirror: true, Rotate: 90})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Video) == 0 {
			t.Fatal("expected non-empty video")
		}
	})

	t.Run("poster frame is taken at the picked time", func(t *testing.T) {
		first, err := GenerateVideoVariants(context.Background(), data, ".mp4", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		later, err := GenerateVideoVariants(context.Background(), data, ".mp4", &VideoEdit{Poster: 1.5})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(first.Poster) == 0 || len(later.Poster) == 0 {
			t.Fatal("expected non-empty posters")
		}
		// testsrc changes every frame, so the two posters must differ.
		if bytes.Equal(first.Poster, later.Poster) {
			t.Fatal("poster at 1.5s must differ from the first-frame poster")
		}
	})

	t.Run("out-of-range poster clamps instead of failing", func(t *testing.T) {
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", &VideoEdit{Poster: 999})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Poster) == 0 {
			t.Fatal("expected a clamped poster")
		}
	})

	t.Run("mute drops the audio track", func(t *testing.T) {
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", &VideoEdit{Muted: true})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		dir := t.TempDir()
		path := filepath.Join(dir, "muted.mp4")
		if err := os.WriteFile(path, got.Video, 0o600); err != nil {
			t.Fatalf("write muted: %v", err)
		}
		streams, err := probeVideoStreams(context.Background(), path)
		if err != nil {
			t.Fatalf("probe muted: %v", err)
		}
		if a := firstStream(streams, "audio"); a.CodecName != "" {
			t.Fatalf("expected no audio stream, got %q", a.CodecName)
		}
		if v := firstStream(streams, "video"); v.Width != 320 || v.Height != 240 {
			t.Fatalf("muted frame = %dx%d, want 320x240", v.Width, v.Height)
		}
		if !got.IsAnimated() {
			t.Fatal("a short soundless clip must be surfaced as animated")
		}
	})

	t.Run("trim and crop together", func(t *testing.T) {
		edit := &VideoEdit{Start: 0.5, End: 1.5, Crop: &CropRect{X: 0.25, Y: 0.25, W: 0.5, H: 0.5}}
		got, err := GenerateVideoVariants(context.Background(), data, ".mp4", edit)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Video) == 0 {
			t.Fatal("expected non-empty video")
		}
	})

	t.Run("honors context cancellation", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
		defer cancel()
		if _, err := GenerateVideoVariants(ctx, data, ".mp4", nil); err == nil {
			t.Fatal("expected an error for an already-cancelled context")
		}
	})
}

// makeTestGif renders a tiny animated GIF so the conversion path is exercised
// with a real gif input.
func makeTestGif(t *testing.T) []byte {
	t.Helper()
	dir := t.TempDir()
	out := filepath.Join(dir, "anim.gif")
	cmd := exec.Command("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1", out)
	if outBytes, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg gif fixture failed: %v\n%s", err, outBytes)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read gif fixture: %v", err)
	}
	return data
}

func TestGenerateVideoVariantsFromGif(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	data := makeTestGif(t)

	got, err := GenerateVideoVariants(context.Background(), data, ".gif", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got.FromGif {
		t.Fatal("FromGif = false, want true")
	}
	if got.HasAudio {
		t.Fatal("a converted gif must not carry audio")
	}
	if !got.IsAnimated() {
		t.Fatal("a converted gif must be animated")
	}
	if got.Width != 160 || got.Height != 120 {
		t.Fatalf("converted dims = %dx%d, want 160x120", got.Width, got.Height)
	}

	dir := t.TempDir()
	path := filepath.Join(dir, "from-gif.mp4")
	if err := os.WriteFile(path, got.Video, 0o600); err != nil {
		t.Fatalf("write converted: %v", err)
	}
	streams, err := probeVideoStreams(context.Background(), path)
	if err != nil {
		t.Fatalf("probe converted: %v", err)
	}
	v := firstStream(streams, "video")
	if v.CodecName != "h264" || v.Width != 160 || v.Height != 120 {
		t.Fatalf("converted stream = %s %dx%d, want h264 160x120", v.CodecName, v.Width, v.Height)
	}
}
