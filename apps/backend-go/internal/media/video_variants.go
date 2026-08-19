package media

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

const (
	maxVideoDuration = 3 * time.Minute
	// Output caps for the transcode path; the stream-copy fast path refuses
	// sources above these so the stored clip always fits the same bounds.
	maxVideoWidth  = 1280
	maxVideoHeight = 720
	// maxSkipBitrate is the ceiling for the stream-copy fast path: a source at
	// or below it remuxes to a compact file in seconds with ~zero CPU. Fatter
	// uploads (camera originals) still go through the transcode so they are
	// squeezed down to the 2M cap instead of being stored as-is.
	maxSkipBitrate = 3_000_000
)

// VideoVariants is the compact, streamable video plus its JPEG poster.
// The source is intentionally not retained: normalizing clips saves storage,
// bandwidth and browser codec surprises.
type VideoVariants struct {
	Video  []byte
	Poster []byte
}

// streamInfo mirrors the ffprobe -show_entries stream=... JSON subset we
// consult to decide between the stream-copy fast path and a full transcode.
type streamInfo struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	BitRate   string `json:"bit_rate"`
}

// probeVideoStreams runs ffprobe over the input and returns every stream.
// Errors are returned to the caller, which falls back to a full transcode:
// an unprobeable file should still be attempted rather than rejected.
func probeVideoStreams(ctx context.Context, path string) ([]streamInfo, error) {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error",
		"-show_entries", "stream=codec_type,codec_name,width,height,bit_rate",
		"-of", "json", path).Output()
	if err != nil {
		return nil, err
	}
	var res struct {
		Streams []streamInfo `json:"streams"`
	}
	if err := json.Unmarshal(out, &res); err != nil {
		return nil, err
	}
	return res.Streams, nil
}

func firstStream(streams []streamInfo, codecType string) streamInfo {
	for _, s := range streams {
		if s.CodecType == codecType {
			return s
		}
	}
	return streamInfo{}
}

// canStreamCopy reports whether the upload can be remuxed instead of
// transcoded: already H.264 with even, in-bounds dimensions, a compact
// bitrate, and browser-friendly (or no) audio. The remux strips container
// metadata (GPS, titles) the same way the transcode does; only codec-level
// tags could survive a copy, which is the accepted tradeoff for the ~zero-CPU
// fast path on the 1-CPU server. Anything unusual falls back to the transcode.
func canStreamCopy(video, audio streamInfo) bool {
	if video.CodecName != "h264" || video.Width <= 0 || video.Height <= 0 {
		return false
	}
	if video.Width%2 != 0 || video.Height%2 != 0 {
		return false
	}
	if video.Width > maxVideoWidth || video.Height > maxVideoHeight {
		return false
	}
	// Bitrate is reported as a string ("1200000") or "N/A"; anything we
	// cannot parse conservatively goes through the transcode.
	bitrate, err := strconv.Atoi(video.BitRate)
	if err != nil || bitrate <= 0 || bitrate > maxSkipBitrate {
		return false
	}
	switch audio.CodecName {
	case "", "aac", "mp3":
		return true
	}
	return false
}

// GenerateVideoVariants converts a user clip to a compact 720p H.264/AAC MP4
// and a JPEG preview. Clips that are already compact H.264/AAC MP4 are remuxed
// (stream copy) in seconds with ~zero CPU; everything else is transcoded with
// the 1-CPU-friendly ultrafast settings. ffmpeg/ffprobe are included in the
// production backend image.
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
	// `-t` is deliberately in the processing commands instead of a separate
	// duration gate: MP4/MOV files with valid media but unusual duration
	// metadata still upload correctly, and it bounds output size and CPU time
	// for a tiny but very long source.
	streams, probeErr := probeVideoStreams(ctx, input)
	video, audio := firstStream(streams, "video"), firstStream(streams, "audio")
	if probeErr == nil && canStreamCopy(video, audio) {
		// Fast path: near-instant remux, ~zero CPU. Stream copy preserves
		// rotation side data, while -map_metadata -1 drops global (container)
		// metadata and per-stream tags — GPS/title chunks in phone MP4s live
		// at the container level and are removed.
		cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
			"-t", fmt.Sprintf("%d", int(maxVideoDuration.Seconds())),
			"-map", "0:v:0", "-map", "0:a?", "-c", "copy",
			"-map_metadata", "-1", "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1",
			"-movflags", "+faststart", output)
		if _, err := cmd.CombinedOutput(); err != nil {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("processing timed out")
			}
			return nil, fmt.Errorf("unsupported or damaged video")
		}
	} else {
		// 1-CPU VPS tuning: `-preset ultrafast` + a 30fps cap + no forced
		// threading keep the encode light. 60fps clips encode ~2x faster after
		// dropping frames, and x264's frame-thread sync on a single core only
		// slows it down (the old `-threads 2` was counterproductive here). CRF
		// 26 compensates the ultrafast preset, and the 2M maxrate keeps the
		// output compact despite the faster preset.
		scale := fmt.Sprintf("fps=30,scale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
			maxVideoWidth, maxVideoHeight)
		cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
			"-t", fmt.Sprintf("%d", int(maxVideoDuration.Seconds())), "-map", "0:v:0", "-map", "0:a?",
			// Drop to 30fps before scaling (cheaper), then scale to 720p.
			// H.264 requires even dimensions for yuv420p, so pad only the
			// final row / column when a camera produces an odd-sized frame.
			"-vf", scale,
			"-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-maxrate", "2M", "-bufsize", "4M",
			"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output)
		if _, err := cmd.CombinedOutput(); err != nil {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("processing timed out")
			}
			return nil, fmt.Errorf("unsupported or damaged video")
		}
	}
	// Use the first frame rather than seeking to one second: short clips are
	// valid videos too and may end before the old one-second seek point.
	posterCmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", "0", "-i", output,
		"-frames:v", "1", "-vf", "scale=w='min(640,iw)':h=-2", "-q:v", "5", poster)
	if _, err := posterCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("create preview")
	}
	videoBytes, err := os.ReadFile(output)
	if err != nil || len(videoBytes) == 0 {
		return nil, fmt.Errorf("read compressed video")
	}
	preview, err := os.ReadFile(poster)
	if err != nil || len(preview) == 0 {
		return nil, fmt.Errorf("read video preview")
	}
	return &VideoVariants{Video: videoBytes, Poster: preview}, nil
}
