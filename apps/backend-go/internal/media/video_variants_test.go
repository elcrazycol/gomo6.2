package media

import (
	"testing"
	"time"
)

func TestVideoVariantsIsAnimated(t *testing.T) {
	cases := []struct {
		name string
		v    VideoVariants
		want bool
	}{
		{"soundless short", VideoVariants{Duration: 3 * time.Second}, true},
		{"soundless at the cap", VideoVariants{Duration: maxAnimatedDuration}, true},
		{"soundless long", VideoVariants{Duration: maxAnimatedDuration + time.Second}, false},
		{"has audio", VideoVariants{HasAudio: true, Duration: 3 * time.Second}, false},
		{"unknown duration", VideoVariants{}, false},
		{"converted gif is always animated", VideoVariants{FromGif: true, HasAudio: true, Duration: time.Hour}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.v.IsAnimated(); got != tc.want {
				t.Fatalf("IsAnimated = %v, want %v", got, tc.want)
			}
		})
	}

	var nilVariants *VideoVariants
	if nilVariants.IsAnimated() {
		t.Fatal("nil VideoVariants must not be animated")
	}
}

func TestCanStreamCopy(t *testing.T) {
	cases := []struct {
		name  string
		video streamInfo
		audio streamInfo
		want  bool
	}{
		{"compact h264 + aac", streamInfo{CodecName: "h264", Width: 1280, Height: 720, BitRate: "2000000"}, streamInfo{CodecName: "aac"}, true},
		{"no audio track", streamInfo{CodecName: "h264", Width: 854, Height: 480, BitRate: "1500000"}, streamInfo{}, true},
		{"mp3 audio", streamInfo{CodecName: "h264", Width: 640, Height: 360, BitRate: "1000000"}, streamInfo{CodecName: "mp3"}, true},
		{"hevc must transcode", streamInfo{CodecName: "hevc", Width: 1280, Height: 720, BitRate: "2000000"}, streamInfo{CodecName: "aac"}, false},
		{"too wide", streamInfo{CodecName: "h264", Width: 1920, Height: 1080, BitRate: "2000000"}, streamInfo{CodecName: "aac"}, false},
		{"too tall", streamInfo{CodecName: "h264", Width: 720, Height: 1280, BitRate: "2000000"}, streamInfo{CodecName: "aac"}, false},
		{"fat bitrate must transcode", streamInfo{CodecName: "h264", Width: 1280, Height: 720, BitRate: "6000000"}, streamInfo{CodecName: "aac"}, false},
		{"unknown bitrate must transcode", streamInfo{CodecName: "h264", Width: 1280, Height: 720, BitRate: "N/A"}, streamInfo{CodecName: "aac"}, false},
		{"odd dimensions must transcode", streamInfo{CodecName: "h264", Width: 719, Height: 480, BitRate: "1000000"}, streamInfo{CodecName: "aac"}, false},
		{"exotic audio must transcode", streamInfo{CodecName: "h264", Width: 1280, Height: 720, BitRate: "2000000"}, streamInfo{CodecName: "ac3"}, false},
		{"no video stream", streamInfo{}, streamInfo{CodecName: "aac"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := canStreamCopy(tc.video, tc.audio); got != tc.want {
				t.Fatalf("canStreamCopy = %v, want %v", got, tc.want)
			}
		})
	}
}
