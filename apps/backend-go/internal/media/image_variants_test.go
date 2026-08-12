package media

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

func TestGenerateImageVariants(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 1600, 900))
	for y := 0; y < 900; y++ {
		for x := 0; x < 1600; x++ {
			source.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 120, A: 255})
		}
	}
	var input bytes.Buffer
	if err := png.Encode(&input, source); err != nil {
		t.Fatalf("encode test image: %v", err)
	}

	variants, err := GenerateImageVariants(input.Bytes())
	if err != nil {
		t.Fatalf("GenerateImageVariants: %v", err)
	}
	if variants.Width != 1600 || variants.Height != 900 {
		t.Fatalf("unexpected dimensions: %dx%d", variants.Width, variants.Height)
	}
	if len(variants.Preview) == 0 || variants.PreviewType != "image/jpeg" {
		t.Fatalf("missing JPEG preview")
	}
	if !strings.HasPrefix(variants.LQIP, "data:image/jpeg;base64,") {
		t.Fatalf("unexpected LQIP prefix")
	}
	lqip, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(variants.LQIP, "data:image/jpeg;base64,"))
	if err != nil || len(lqip) == 0 {
		t.Fatalf("invalid LQIP: %v", err)
	}
	if len(lqip) >= 2048 {
		t.Fatalf("LQIP is too large: %d bytes", len(lqip))
	}
}

// TestGenerateImageVariants_StripsMetadataFromOriginal guards the upload hot
// path: upload.go persists generated.Original INSTEAD of the raw upload bytes,
// so the returned Original must be free of EXIF/GPS metadata.
func TestGenerateImageVariants_StripsMetadataFromOriginal(t *testing.T) {
	in := jpegWithExif(t)
	if !bytes.Contains(in, []byte("Exif\x00\x00")) {
		t.Fatal("test precondition failed: EXIF payload missing from input")
	}

	variants, err := GenerateImageVariants(in)
	if err != nil {
		t.Fatalf("GenerateImageVariants: %v", err)
	}
	if len(variants.Original) == 0 {
		t.Fatal("Original is empty")
	}
	if bytes.Contains(variants.Original, []byte("Exif")) {
		t.Fatal("Original retained EXIF metadata — the upload path would store it")
	}
	if _, _, err := image.Decode(bytes.NewReader(variants.Original)); err != nil {
		t.Fatalf("stripped Original no longer decodes: %v", err)
	}
}

func TestGenerateImageVariantsRejectsInvalidData(t *testing.T) {
	if _, err := GenerateImageVariants([]byte("not-an-image")); err == nil {
		t.Fatal("expected invalid image error")
	}
}

func TestGenerateImageVariantsRejectsOversizedDimensions(t *testing.T) {
	// DecodeConfig reads the PNG header and must reject this without allocating
	// a 40M+ pixel raster.
	input := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x2e\xe0\x00\x00\x2e\xe0\x08\x02\x00\x00\x00")
	if _, err := GenerateImageVariants(input); err == nil {
		t.Fatal("expected oversized image error")
	}
}
