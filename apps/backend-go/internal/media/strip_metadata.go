package media

import (
	"bytes"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
)

// stripOriginalImage re-encodes a decoded image in its original format without
// metadata (EXIF, GPS, XMP, ICCP, text chunks). JPEG/PNG re-encode the already
// decoded image.Image; GIF re-decodes via DecodeAll so animation frames are
// preserved. Formats without a pure-Go encoder in this build (WebP) return the
// original bytes unchanged — camera photos, where GPS EXIF actually appears,
// are JPEG and are fully stripped.
func stripOriginalImage(data []byte, img image.Image, format string) ([]byte, error) {
	switch format {
	case "jpeg":
		var out bytes.Buffer
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 90}); err != nil {
			return nil, err
		}
		return out.Bytes(), nil
	case "png":
		var out bytes.Buffer
		if err := png.Encode(&out, img); err != nil {
			return nil, err
		}
		return out.Bytes(), nil
	case "gif":
		anim, err := gif.DecodeAll(bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		var out bytes.Buffer
		if err := gif.EncodeAll(&out, anim); err != nil {
			return nil, err
		}
		return out.Bytes(), nil
	default:
		return data, nil
	}
}

// StripImageMetadata strips EXIF/metadata from an image given its file
// extension. It is used on upload paths that bypass GenerateImageVariants
// (avatars). The image must already have been validated as decodable by the
// caller.
func StripImageMetadata(data []byte, ext string) ([]byte, error) {
	var format string
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		format = "jpeg"
	case ".png":
		format = "png"
	case ".gif":
		format = "gif"
	}
	if format == "" {
		// WebP (and any unknown extension) has no encoder in this build — the
		// original bytes are kept.
		return data, nil
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", format, err)
	}
	stripped, err := stripOriginalImage(data, img, format)
	if err != nil {
		return nil, fmt.Errorf("re-encode %s: %w", format, err)
	}
	return stripped, nil
}

// ValidateImageShape verifies the bytes decode as a supported image with sane
// dimensions. It is used on upload paths that bypass GenerateImageVariants
// (avatars), so an HTML/JS blob can never be stored under an image extension.
func ValidateImageShape(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("empty image")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("decode image config: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxImageWidth || config.Height > maxImageHeight || config.Width*config.Height > maxImagePixels {
		return fmt.Errorf("invalid image dimensions")
	}
	return nil
}
