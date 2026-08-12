package media

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

// jpegWithExif builds a tiny JPEG and injects an APP1 segment containing a
// fake "Exif\0\0" payload right after the SOI marker — the shape of a real
// camera JPEG carrying GPS metadata.
func jpegWithExif(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 32), G: uint8(y * 32), B: 120, A: 255})
		}
	}
	var base bytes.Buffer
	if err := jpeg.Encode(&base, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatalf("encode base jpeg: %v", err)
	}
	b := base.Bytes()
	exifPayload := append([]byte("Exif\x00\x00"), bytes.Repeat([]byte{0x42}, 96)...)
	segLen := len(exifPayload) + 2
	segment := append([]byte{0xFF, 0xE1, byte(segLen >> 8), byte(segLen & 0xFF)}, exifPayload...)
	out := append([]byte{}, b[:2]...) // SOI
	out = append(out, segment...)
	out = append(out, b[2:]...)
	return out
}

// pngWithTextChunk builds a tiny PNG and injects a tEXt chunk (e.g. GPS/comment
// metadata) immediately before IEND.
func pngWithTextChunk(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 60), G: uint8(y * 60), B: 90, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode base png: %v", err)
	}
	b := buf.Bytes()
	body := b[:len(b)-12] // strip IEND chunk
	text := "tEXtComment\x00GPS:51.5074,-0.1278"
	chunk := make([]byte, 4+4+len(text)+4)
	binary.BigEndian.PutUint32(chunk[0:4], uint32(len(text)))
	copy(chunk[4:8], "tEXt")
	copy(chunk[8:8+len(text)], text)
	crc := crc32.ChecksumIEEE(chunk[4 : 8+len(text)])
	binary.BigEndian.PutUint32(chunk[8+len(text):], crc)
	out := append(append([]byte{}, body...), chunk...)
	out = append(out, b[len(b)-12:]...)
	return out
}

func TestStripImageMetadata_JPEGRemovesEXIF(t *testing.T) {
	in := jpegWithExif(t)
	if !bytes.Contains(in, []byte("Exif\x00\x00")) {
		t.Fatal("test precondition failed: EXIF payload missing from input")
	}

	out, err := StripImageMetadata(in, ".jpg")
	if err != nil {
		t.Fatalf("StripImageMetadata: %v", err)
	}
	if bytes.Contains(out, []byte("Exif")) {
		t.Fatal("EXIF metadata survived re-encoding")
	}
	if _, _, err := image.Decode(bytes.NewReader(out)); err != nil {
		t.Fatalf("stripped jpeg no longer decodes: %v", err)
	}
}

func TestStripImageMetadata_PNGRemovesTextChunks(t *testing.T) {
	in := pngWithTextChunk(t)
	if !bytes.Contains(in, []byte("GPS:")) {
		t.Fatal("test precondition failed: tEXt chunk missing from input")
	}

	out, err := StripImageMetadata(in, ".png")
	if err != nil {
		t.Fatalf("StripImageMetadata: %v", err)
	}
	if bytes.Contains(out, []byte("tEXt")) || bytes.Contains(out, []byte("GPS:")) {
		t.Fatal("text metadata survived re-encoding")
	}
	decoded, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("stripped png no longer decodes: %v", err)
	}
	if decoded.Bounds().Dx() != 4 || decoded.Bounds().Dy() != 4 {
		t.Fatalf("unexpected dimensions after strip: %v", decoded.Bounds())
	}
}

func TestStripImageMetadata_GIFPreservesAnimation(t *testing.T) {
	pal := color.Palette{color.RGBA{0, 0, 0, 255}, color.RGBA{255, 255, 255, 255}, color.RGBA{255, 0, 0, 255}}
	anim := &gif.GIF{
		Image: []*image.Paletted{
			{Palette: pal, Rect: image.Rect(0, 0, 4, 4), Stride: 4, Pix: make([]uint8, 16)},
			{Palette: pal, Rect: image.Rect(0, 0, 4, 4), Stride: 4, Pix: make([]uint8, 16)},
		},
		Delay: []int{10, 20},
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, anim); err != nil {
		t.Fatalf("encode test gif: %v", err)
	}

	out, err := StripImageMetadata(buf.Bytes(), ".gif")
	if err != nil {
		t.Fatalf("StripImageMetadata: %v", err)
	}
	reloaded, err := gif.DecodeAll(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("stripped gif no longer decodes: %v", err)
	}
	if len(reloaded.Image) != 2 {
		t.Fatalf("animation frames lost: got %d, want 2", len(reloaded.Image))
	}
}

func TestStripImageMetadata_WebPPassesThrough(t *testing.T) {
	// WebP has no encoder in this build — the original bytes must be kept
	// untouched so uploads do not break.
	in := []byte("RIFF....WEBPVP8 fake-webp-bytes")
	out, err := StripImageMetadata(in, ".webp")
	if err != nil {
		t.Fatalf("StripImageMetadata(webp): %v", err)
	}
	if !bytes.Equal(out, in) {
		t.Fatal("webp bytes were modified despite no encoder being available")
	}
}

func TestValidateImageShape_RejectsNonImage(t *testing.T) {
	if err := ValidateImageShape([]byte("<html><script>alert(1)</script></html>")); err == nil {
		t.Fatal("expected HTML blob to be rejected as an image")
	}
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode: %v", err)
	}
	if err := ValidateImageShape(buf.Bytes()); err != nil {
		t.Fatalf("valid png rejected: %v", err)
	}
}
