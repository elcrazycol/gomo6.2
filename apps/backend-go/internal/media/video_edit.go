package media

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// CropRect is a crop window expressed as fractions (0..1) of the displayed
// (auto-rotated) frame. Fractions keep the contract resolution-independent and
// correct even when the source carries rotation side data: the browser measures
// the already-rotated frame it renders, and ffmpeg's filter graph runs after
// autorotate, so both sides agree on the same coordinate space.
type CropRect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// VideoEdit is the optional trim + crop + orientation the user picked in the
// client video editor. A nil *VideoEdit means "store the clip as-is" — the
// legacy behavior.
type VideoEdit struct {
	// Start/End are seconds. End == 0 means "until the platform cap".
	Start float64   `json:"start"`
	End   float64   `json:"end"`
	Crop  *CropRect `json:"crop"`
	// Rotate is a clockwise rotation in degrees: 0, 90, 180 or 270.
	Rotate int `json:"rotate"`
	// Mirror flips the frame horizontally.
	Mirror bool `json:"mirror"`
	// Muted drops the audio track entirely (the client's "GIF" mode). The
	// stored clip is silent; the API surfaces it as `animated` downstream.
	Muted bool `json:"muted"`
}

const (
	// minCropFraction rejects degenerate crop windows (and division-by-zero-ish
	// filters) while staying far below any hand-draggable frame.
	minCropFraction = 0.02
	// fractionEpsilon absorbs float rounding when a client sends a full-frame
	// crop (x=0, w=1) or a fraction that only just touches the edge.
	fractionEpsilon = 1e-6
)

// HasTrim reports whether a non-default time range was selected.
func (e *VideoEdit) HasTrim() bool {
	return e != nil && (e.Start > 0 || e.End > 0)
}

// HasCrop reports whether a crop window was selected.
func (e *VideoEdit) HasCrop() bool {
	return e != nil && e.Crop != nil
}

// HasTransform reports whether the frame is rotated or mirrored. Transforms
// cannot ride the stream-copy fast path — they always need a re-encode.
func (e *VideoEdit) HasTransform() bool {
	return e != nil && (normalizedRotation(e.Rotate) != 0 || e.Mirror)
}

// IsMuted reports whether the audio track should be dropped.
func (e *VideoEdit) IsMuted() bool {
	return e != nil && e.Muted
}

// normalizedRotation folds any degree value into one of 0/90/180/270.
func normalizedRotation(degrees int) int {
	return ((degrees % 360) + 360) % 360
}

// trimDuration returns the output duration cap implied by the edit: the
// selected range when End is set, otherwise the platform maximum.
func (e *VideoEdit) trimDuration() float64 {
	if e != nil && e.End > 0 && e.End > e.Start {
		if d := e.End - e.Start; d < maxVideoDuration.Seconds() {
			return d
		}
	}
	return maxVideoDuration.Seconds()
}

// startSeconds returns the input seek offset (0 when unset).
func (e *VideoEdit) startSeconds() float64 {
	if e == nil || e.Start < 0 {
		return 0
	}
	return e.Start
}

func (e *VideoEdit) validate() error {
	for _, v := range []float64{e.Start, e.End} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return fmt.Errorf("video trim must be a positive number of seconds")
		}
	}
	if e.End > 0 && e.End <= e.Start {
		return fmt.Errorf("video end must be greater than start")
	}
	switch normalizedRotation(e.Rotate) {
	case 0, 90, 180, 270:
	default:
		return fmt.Errorf("video rotation must be 0, 90, 180 or 270 degrees")
	}
	if c := e.Crop; c != nil {
		for _, v := range []float64{c.X, c.Y, c.W, c.H} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("invalid crop")
			}
		}
		if c.X < 0 || c.Y < 0 || c.W < minCropFraction || c.H < minCropFraction {
			return fmt.Errorf("invalid crop")
		}
		if c.X+c.W > 1+fractionEpsilon || c.Y+c.H > 1+fractionEpsilon {
			return fmt.Errorf("crop exceeds frame")
		}
	}
	return nil
}

// ParseVideoEdit decodes the optional `video_edit` multipart field. Empty input
// is not an error: it returns (nil, nil) so callers keep the legacy behavior.
func ParseVideoEdit(raw string) (*VideoEdit, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	var e VideoEdit
	if err := dec.Decode(&e); err != nil {
		return nil, fmt.Errorf("invalid video_edit: %w", err)
	}
	if err := e.validate(); err != nil {
		return nil, err
	}
	return &e, nil
}

// buildCropFilter renders the crop expression relative to the filter input's
// own dimensions (iw/ih), i.e. after ffmpeg autorotate — so rotation metadata
// never desyncs the client's frame from the encoded one. Width/height/x/y are
// floored to even values so the yuv420p encoder never sees odd chroma planes;
// because every term only shrinks, x+w and y+h stay inside the frame.
func buildCropFilter(c *CropRect) string {
	return fmt.Sprintf(
		"crop=w='trunc(iw*%.6f/2)*2':h='trunc(ih*%.6f/2)*2':x='trunc(iw*%.6f/2)*2':y='trunc(ih*%.6f/2)*2'",
		c.W, c.H, c.X, c.Y,
	)
}

// buildVideoFilter returns the -vf graph for the transcode path: an optional
// orientation (mirror/rotate), then an optional crop, then the existing 30fps +
// 720p cap. Orientation and crop run before scale so the client's crop fractions
// (measured on the displayed frame) and the cap both apply to the final image.
func buildVideoFilter(edit *VideoEdit) string {
	scale := fmt.Sprintf(
		"fps=30,scale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
		maxVideoWidth, maxVideoHeight,
	)
	if edit == nil {
		return scale
	}
	parts := make([]string, 0, 4)
	// Mirror first (in the pre-rotation space) to match the client's CSS
	// `rotate(...) scaleX(...)` order, then rotate.
	if edit.Mirror {
		parts = append(parts, "hflip")
	}
	switch normalizedRotation(edit.Rotate) {
	case 90:
		parts = append(parts, "transpose=1") // 90° clockwise
	case 180:
		parts = append(parts, "hflip", "vflip")
	case 270:
		parts = append(parts, "transpose=2") // 90° counterclockwise
	}
	if edit.Crop != nil {
		parts = append(parts, buildCropFilter(edit.Crop))
	}
	parts = append(parts, scale)
	return strings.Join(parts, ",")
}
