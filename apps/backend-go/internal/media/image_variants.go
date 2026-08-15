package media

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"

	"go.n16f.net/thumbhash"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	previewMaxWidth  = 720
	previewMaxHeight = 480
	lqipMaxDimension = 24
	maxImageWidth    = 12000
	maxImageHeight   = 12000
	maxImagePixels   = 40_000_000
)

// ImageVariants contains a compact preview, an inline low-quality placeholder,
// a ThumbHash of the original and the metadata-stripped original. Original is a
// re-encode of the uploaded image in its own format with EXIF/GPS/XMP removed
// (H2.2) — callers persist it INSTEAD of the raw upload bytes so camera
// metadata never reaches viewers. Formats without a pure-Go encoder (WebP)
// fall back to the raw bytes.
type ImageVariants struct {
	Preview     []byte
	Original    []byte
	LQIP        string
	ThumbHash   string
	Width       int
	Height      int
	PreviewType string
}

// GenerateImageVariants decodes a supported raster image and creates a JPEG
// preview plus a tiny JPEG data URL. JPEG is used for derivatives because its
// encoder is part of the Go standard library and works in the CGO-disabled
// production image. WebP is accepted as input; AVIF is deliberately left to a
// future codec-enabled worker rather than making the API binary fragile.
func GenerateImageVariants(data []byte) (*ImageVariants, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty image")
	}

	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode image config: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxImageWidth || config.Height > maxImageHeight || config.Width*config.Height > maxImagePixels {
		return nil, fmt.Errorf("image dimensions are too large")
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}

	// H2.2: strip EXIF/GPS while the image is already decoded — no second
	// decode on the upload hot path. JPEG/PNG re-encode the in-memory image;
	// GIF re-decodes with DecodeAll to preserve animation frames.
	original, err := stripOriginalImage(data, img, format)
	if err != nil {
		return nil, fmt.Errorf("strip image metadata: %w", err)
	}
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("invalid image dimensions")
	}

	preview := resizeToFit(img, previewMaxWidth, previewMaxHeight)
	previewBytes, err := encodeJPEG(preview, 80)
	if err != nil {
		return nil, fmt.Errorf("encode preview: %w", err)
	}

	lqip := resizeToFit(img, lqipMaxDimension, lqipMaxDimension)
	lqipBytes, err := encodeJPEG(lqip, 25)
	if err != nil {
		return nil, fmt.Errorf("encode lqip: %w", err)
	}

	// ThumbHash is a ~30-byte perceptual hash that the client renders as an
	// instant colored placeholder. EncodeImage resizes internally (≤128px), so
	// the full decoded image can be passed straight through. base64 keeps it
	// JSON-friendly for the attachment meta column.
	thumbHash := base64.StdEncoding.EncodeToString(thumbhash.EncodeImage(img))

	return &ImageVariants{
		Preview:     previewBytes,
		Original:    original,
		LQIP:        "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(lqipBytes),
		ThumbHash:   thumbHash,
		Width:       width,
		Height:      height,
		PreviewType: "image/jpeg",
	}, nil
}

func resizeToFit(src image.Image, maxWidth, maxHeight int) *image.NRGBA {
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	scale := 1.0
	if width > maxWidth {
		scale = minFloat(scale, float64(maxWidth)/float64(width))
	}
	if height > maxHeight {
		scale = minFloat(scale, float64(maxHeight)/float64(height))
	}
	newWidth := maxInt(1, int(float64(width)*scale+0.5))
	newHeight := maxInt(1, int(float64(height)*scale+0.5))

	dst := image.NewNRGBA(image.Rect(0, 0, newWidth, newHeight))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, draw.Over, nil)
	return dst
}

func encodeJPEG(img image.Image, quality int) ([]byte, error) {
	// JPEG has no alpha channel. Composite transparent PNG/WebP pixels on a
	// neutral white background instead of allowing transparent black to leak
	// into previews and LQIPs.
	bounds := img.Bounds()
	background := image.NewRGBA(bounds)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			alpha := uint32(pixel.A)
			background.Set(x, y, color.RGBA{
				R: uint8((uint32(pixel.R)*alpha + 255*(255-alpha)) / 255),
				G: uint8((uint32(pixel.G)*alpha + 255*(255-alpha)) / 255),
				B: uint8((uint32(pixel.B)*alpha + 255*(255-alpha)) / 255),
				A: 255,
			})
		}
	}

	var out bytes.Buffer
	if err := jpeg.Encode(&out, background, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
