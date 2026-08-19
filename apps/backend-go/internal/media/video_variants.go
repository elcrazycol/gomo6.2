package media

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
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

	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	// A tiny, very long source can otherwise turn into a much larger 2 Mbps
	// rendition. Probe before transcoding and keep a single wall clip bounded.
	probe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input)
	durationOutput, err := probe.Output()
	if err != nil {
		return nil, fmt.Errorf("unsupported or damaged video")
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(durationOutput)), 64)
	if err != nil || duration <= 0 || duration > maxVideoDuration.Seconds() {
		return nil, fmt.Errorf("video must be between 1 second and %d minutes", int(maxVideoDuration.Minutes()))
	}
	// CRF 28 + 720p gives phone recordings a substantial reduction while
	// preserving faces and text. faststart makes playback begin quickly.
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
		"-map", "0:v:0", "-map", "0:a?",
		"-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-maxrate", "2M", "-bufsize", "4M", "-threads", "2",
		"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output)
	if _, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("processing timed out")
		}
		return nil, fmt.Errorf("unsupported or damaged video")
	}
	posterCmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", output,
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
