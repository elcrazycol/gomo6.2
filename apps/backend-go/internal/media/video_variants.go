package media

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
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
	// shortClipDuration is the point below which a slower x264 preset is
	// effectively free on the 1-CPU box while producing noticeably smaller
	// files than `ultrafast`.
	shortClipDuration = 10 * time.Second
	// maxAnimatedDuration bounds the "soundless clip = GIF" heuristic. Longer
	// clips are never surfaced as animated, so the flag cannot be faked.
	maxAnimatedDuration = 10 * time.Second
)

// VideoVariants is the compact, streamable video plus its JPEG poster.
// The source is intentionally not retained: normalizing clips saves storage,
// bandwidth and browser codec surprises.
type VideoVariants struct {
	Video  []byte
	Poster []byte
	// HasAudio, Duration and Width/Height describe the *output*, so callers can
	// derive media facts (the animated flag, the reserved layout box) without
	// trusting the client.
	HasAudio bool
	Duration time.Duration
	Width    int
	Height   int
	// FromGif marks a clip that was converted from a real .gif; it is always
	// animated regardless of length.
	FromGif bool
}

// IsAnimated reports whether the finished clip should be surfaced as an
// animated (GIF-like) attachment: a converted .gif, or any soundless clip short
// enough to loop. Deriving this from the output means a client cannot fake it,
// and silent screen recordings qualify automatically.
func (v *VideoVariants) IsAnimated() bool {
	if v == nil {
		return false
	}
	if v.FromGif {
		return true
	}
	if v.HasAudio {
		return false
	}
	return v.Duration > 0 && v.Duration <= maxAnimatedDuration
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

// probeDuration returns a file's container duration, or 0 when unknown.
func probeDuration(ctx context.Context, path string) time.Duration {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error",
		"-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path).Output()
	if err != nil {
		return 0
	}
	seconds, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || seconds <= 0 {
		return 0
	}
	return time.Duration(seconds * float64(time.Second))
}

// probeOutputInfo reports the finished file's media facts: whether it carries
// audio, its duration and its video dimensions. These drive the server-side
// `animated` decision and the width/height clients reserve space with.
func probeOutputInfo(ctx context.Context, path string) (hasAudio bool, duration time.Duration, width, height int, err error) {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error",
		"-show_entries", "stream=codec_type,width,height",
		"-show_entries", "format=duration",
		"-of", "json", path).Output()
	if err != nil {
		return false, 0, 0, 0, err
	}
	var res struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &res); err != nil {
		return false, 0, 0, 0, err
	}
	for _, s := range res.Streams {
		if s.CodecType == "audio" {
			hasAudio = true
		}
		if s.CodecType == "video" {
			width, height = s.Width, s.Height
		}
	}
	if seconds, parseErr := strconv.ParseFloat(res.Format.Duration, 64); parseErr == nil && seconds > 0 {
		duration = time.Duration(seconds * float64(time.Second))
	}
	return hasAudio, duration, width, height, nil
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
//
// edit is the optional trim/crop picked in the client video editor. A nil edit
// (or one without trim/crop) reproduces the original behavior. A crop always
// forces the transcode path, since stream copy cannot reshape pixels.
func GenerateVideoVariants(parent context.Context, data []byte, ext string, edit *VideoEdit) (*VideoVariants, error) {
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
	fromGif := video.CodecName == "gif"
	// Short clips get a slower (but still nearly free) preset for noticeably
	// smaller files; longer ones keep the ultrafast 1-CPU setting. Prefer the
	// real source length over the requested trim cap when it is shorter.
	effectiveSeconds := edit.trimDuration()
	if src := probeDuration(ctx, input); src > 0 {
		if remaining := src.Seconds() - edit.startSeconds(); remaining > 0 && remaining < effectiveSeconds {
			effectiveSeconds = remaining
		}
	}
	x264Preset := "ultrafast"
	if effectiveSeconds <= shortClipDuration.Seconds() {
		x264Preset = "faster"
	}
	// Trim is expressed as a duration cap; start is an input seek so the cut is
	// cheap even for long sources.
	duration := fmt.Sprintf("%.3f", edit.trimDuration())
	seekArgs := []string{}
	if start := edit.startSeconds(); start > 0 {
		seekArgs = append(seekArgs, "-ss", fmt.Sprintf("%.3f", start))
	}
	// A muted clip drops audio, so an exotic (or absent) audio codec no longer
	// blocks the stream-copy fast path.
	audioForCopy := audio
	if edit.IsMuted() {
		audioForCopy = streamInfo{}
	}
	if probeErr == nil && !edit.HasCrop() && !edit.HasTransform() && canStreamCopy(video, audioForCopy) {
		// Fast path: near-instant remux, ~zero CPU. Stream copy preserves
		// rotation side data, while -map_metadata -1 drops global (container)
		// metadata and per-stream tags — GPS/title chunks in phone MP4s live
		// at the container level and are removed. A trim-only edit still
		// qualifies: -ss before -i seeks to the nearest keyframe, and -t caps
		// the output to the selected range.
		args := append([]string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y"}, seekArgs...)
		args = append(args, "-i", input, "-t", duration, "-map", "0:v:0")
		if edit.IsMuted() {
			args = append(args, "-an")
		} else {
			args = append(args, "-map", "0:a?")
		}
		args = append(args, "-c", "copy",
			"-map_metadata", "-1", "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1",
			"-movflags", "+faststart", output)
		cmd := exec.CommandContext(ctx, "ffmpeg", args...)
		if _, err := cmd.CombinedOutput(); err != nil {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("processing timed out")
			}
			return nil, fmt.Errorf("unsupported or damaged video")
		}
	} else {
		// 1-CPU VPS tuning: a light x264 preset + a 30fps cap + no forced
		// threading keep the encode cheap. Short clips use `faster` (nearly
		// free for a few seconds, much smaller output); long ones stay on
		// `ultrafast`. 60fps clips encode ~2x faster after dropping frames, and
		// x264's frame-thread sync on a single core only slows it down (the old
		// `-threads 2` was counterproductive here). CRF 26 compensates the
		// faster preset, and the 2M maxrate keeps the output compact.
		args := append([]string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y"}, seekArgs...)
		args = append(args, "-i", input, "-t", duration, "-map", "0:v:0")
		if edit.IsMuted() {
			args = append(args, "-an")
		} else {
			args = append(args, "-map", "0:a?")
		}
		// Optional orientation/crop first, then drop to 30fps before scaling
		// (cheaper) and scale to 720p. H.264 requires even dimensions for
		// yuv420p, so pad only the final row / column when a camera produces an
		// odd-sized frame.
		args = append(args, "-vf", buildVideoFilter(edit),
			"-c:v", "libx264", "-preset", x264Preset, "-crf", "26", "-maxrate", "2M", "-bufsize", "4M",
			// yuv420p keeps the output universally playable — required for GIF
			// sources, which decode to a paletted/rgb frame otherwise.
			"-pix_fmt", "yuv420p")
		if !edit.IsMuted() {
			args = append(args, "-c:a", "aac", "-b:a", "128k")
		}
		args = append(args, "-movflags", "+faststart", output)
		cmd := exec.CommandContext(ctx, "ffmpeg", args...)
		if _, err := cmd.CombinedOutput(); err != nil {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("processing timed out")
			}
			return nil, fmt.Errorf("unsupported or damaged video")
		}
	}
	// Probe the finished file first: its facts drive both the poster offset
	// clamp and the server-side `animated` decision.
	hasAudio, outDuration, outWidth, outHeight, probeOutErr := probeOutputInfo(ctx, output)
	if probeOutErr != nil {
		hasAudio = !edit.IsMuted() && audio.CodecName != ""
		outDuration = time.Duration(effectiveSeconds * float64(time.Second))
		outWidth, outHeight = video.Width, video.Height
		if edit != nil && normalizedRotation(edit.Rotate)%180 != 0 {
			outWidth, outHeight = outHeight, outWidth
		}
	}
	// Poster: the frame the user picked, offset into the trimmed output and
	// clamped so a stale pick can never seek past the end. Defaults to the
	// first frame, which also keeps short clips valid.
	posterOffset := edit.posterOffset()
	if outDuration > 0 {
		// Keep a margin so the seek always lands on a real frame; the last frame
		// can be up to one frame interval before the container duration.
		if maxOffset := outDuration.Seconds() - 0.2; posterOffset > maxOffset {
			posterOffset = maxOffset
		}
	}
	if posterOffset < 0 {
		posterOffset = 0
	}
	posterArgs := func(seek float64) []string {
		return []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
			"-ss", fmt.Sprintf("%.3f", seek), "-i", output,
			"-frames:v", "1", "-vf", "scale=w='min(640,iw)':h=-2", "-q:v", "5", poster}
	}
	if _, err := exec.CommandContext(ctx, "ffmpeg", posterArgs(posterOffset)...).CombinedOutput(); err != nil {
		// A pick that still lands past the end must never fail the upload:
		// fall back to the first frame.
		if _, fallbackErr := exec.CommandContext(ctx, "ffmpeg", posterArgs(0)...).CombinedOutput(); fallbackErr != nil {
			return nil, fmt.Errorf("create preview")
		}
	}
	videoBytes, err := os.ReadFile(output)
	if err != nil || len(videoBytes) == 0 {
		return nil, fmt.Errorf("read compressed video")
	}
	preview, err := os.ReadFile(poster)
	if err != nil || len(preview) == 0 {
		return nil, fmt.Errorf("read video preview")
	}
	return &VideoVariants{
		Video:    videoBytes,
		Poster:   preview,
		HasAudio: hasAudio,
		Duration: outDuration,
		Width:    outWidth,
		Height:   outHeight,
		FromGif:  fromGif,
	}, nil
}
