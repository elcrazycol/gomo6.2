package media

import (
	"bytes"
	"encoding/binary"
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
// preserved. WebP has no pure-Go encoder, so its RIFF container is edited in
// place: the EXIF/XMP chunks are dropped and their VP8X feature bits cleared.
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
	case "webp":
		return stripWebPMetadata(data), nil
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
	case ".webp":
		// No decoder round-trip is needed: strip the container in place.
		return stripWebPMetadata(data), nil
	}
	if format == "" {
		// Unknown extension — the original bytes are kept.
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

// WebP VP8X feature-flag bits (libwebp format_constants.h). The flags byte is
// the first byte of the VP8X payload.
const (
	webpFlagICCP = 0x20
	webpFlagEXIF = 0x08
	webpFlagXMP  = 0x04
)

// stripWebPMetadata removes the EXIF and XMP metadata chunks from a WebP RIFF
// container and clears their VP8X feature bits, leaving the image bitstream
// untouched.
//
// WebP has no pure-Go encoder in this build, so a decode/re-encode strip is
// impossible — but the RIFF container can be edited directly: metadata lives in
// dedicated "EXIF"/"XMP " chunks, so dropping them (and updating the RIFF size
// and VP8X flags) removes GPS/camera data without re-encoding pixels.
//
// Fail-safe: if the container does not look like a well-formed RIFF/WEBP file,
// or a chunk declares a size that runs past the buffer, the original bytes are
// returned unchanged rather than risk corrupting a user's image.
func stripWebPMetadata(data []byte) []byte {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return data
	}

	// RIFF size covers everything after the 8-byte header. Fall back to the real
	// buffer length if the declared size is implausible (trailing padding, etc.).
	end := len(data)
	if riffSize := int(binary.LittleEndian.Uint32(data[4:8])); riffSize >= 4 && 8+riffSize <= len(data) {
		end = 8 + riffSize
	}

	out := make([]byte, 0, len(data))
	out = append(out, data[0:12]...) // "RIFF" + size placeholder + "WEBP"
	stripped := false

	for off := 12; off+8 <= end; {
		fourcc := string(data[off : off+4])
		size := int(binary.LittleEndian.Uint32(data[off+4 : off+8]))
		if size < 0 || off+8+size > end {
			return data // malformed chunk: do not touch the file
		}
		payloadEnd := off + 8 + size
		next := payloadEnd
		if size%2 == 1 { // RIFF chunks are padded to an even size
			if payloadEnd >= end {
				return data
			}
			next = payloadEnd + 1
		}

		switch {
		case fourcc == "EXIF" || fourcc == "XMP ":
			// Drop the chunk (and its padding) entirely.
			stripped = true
		case fourcc == "VP8X" && size >= 10 && data[off+8]&(webpFlagEXIF|webpFlagXMP) != 0:
			chunk := append([]byte(nil), data[off:payloadEnd]...)
			chunk[8] &= ^byte(webpFlagEXIF | webpFlagXMP)
			out = append(out, chunk...)
			if payloadEnd < next {
				out = append(out, data[payloadEnd]) // keep the pad byte
			}
			stripped = true
		default:
			out = append(out, data[off:next]...)
		}
		off = next
	}

	if !stripped {
		return data
	}
	binary.LittleEndian.PutUint32(out[4:8], uint32(len(out)-8))
	return out
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
