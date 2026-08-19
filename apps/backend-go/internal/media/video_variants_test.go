package media

import "testing"

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
