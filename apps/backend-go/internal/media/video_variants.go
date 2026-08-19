package media

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const maxVideoDuration = 5 * time.Minute

// VideoVariants is the compact, streamable video plus its JPEG poster.
// The source is intentionally not retained: normalizing clips saves storage,
// bandwidth and browser codec surprises.
type VideoVariants struct {
	Video  []byte
	Poster []byte
}

// GenerateVideoVariants converts a user clip to 720p H.264/AAC MP4 and a
// compact JPEG preview. ffmpeg is included in the production backend image.
func GenerateVideoVariants(parent context.Context, data []byte, ext string) (*VideoVariants, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty video")
	}
	dir, err := os.MkdirTemp("", "gomo6-video-*")
	if err != nil {
		return nil, fmt.Errorf("create temporary directory: %w", err)
	}
	defer os.RemoveAll(dir)
	if ext == "" {
		ext = ".mp4"
	}
	input := filepath.Join(dir, "input"+ext)
	output := filepath.Join(dir, "video.mp4")
	poster := filepath.Join(dir, "poster.jpg")
	if err := os.WriteFile(input, data, 0o600); err != nil {
		return nil, fmt.Errorf("write input: %w", err)
	}

	ctx, cancel := context.WithTimeout(parent, 3*time.Minute)
	defer cancel()
	// 1-CPU VPS tuning: `-preset ultrafast` + a 30fps cap + no forced threading
	// keep the encode light. 60fps clips encode ~2x faster after dropping
	// frames, and x264's frame-thread sync on a single core only slows it down
	// (the old `-threads 2` was counterproductive here). CRF 26 compensates the
	// ultrafast preset, and the 2M maxrate keeps the output compact, so the
	// stored MP4 stays small despite the faster preset. `-t` is deliberately in
	// the transcode command instead of a separate ffprobe gate: MP4/MOV files
	// with valid media but unusual duration metadata still upload correctly. It
	// also bounds output size and CPU time for a tiny but very long source.
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
		"-t", fmt.Sprintf("%d", int(maxVideoDuration.Seconds())), "-map", "0:v:0", "-map", "0:a?",
		// Drop to 30fps before scaling (cheaper), then scale to 720p. H.264
		// requires even dimensions for yuv420p, so pad only the final row /
		// column when a camera produces an odd-sized frame.
		"-vf", "fps=30,scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-maxrate", "2M", "-bufsize", "4M",
		"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output)
	if _, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("processing timed out")
		}
		return nil, fmt.Errorf("unsupported or damaged video")
	}
	// Use the first frame rather than seeking to one second: short clips are
	// valid videos too and may end before the old one-second seek point.
	posterCmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", "0", "-i", output,
		"-frames:v", "1", "-vf", "scale=w='min(640,iw)':h=-2", "-q:v", "5", poster)
	if _, err := posterCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("create preview")
	}
	video, err := os.ReadFile(output)
	if err != nil || len(video) == 0 {
		return nil, fmt.Errorf("read compressed video")
	}
	preview, err := os.ReadFile(poster)
	if err != nil || len(preview) == 0 {
		return nil, fmt.Errorf("read video preview")
	}
	return &VideoVariants{Video: video, Poster: preview}, nil
}
