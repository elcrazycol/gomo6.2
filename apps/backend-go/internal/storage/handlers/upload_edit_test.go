package handlers

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// The video editor sends its trim/crop as a `video_edit` multipart field next
// to the file. Reading the file must not swallow the other fields, otherwise
// the server silently stores the unedited clip.
func TestUploadFileWithKeyReadsVideoEditAfterFile(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	filePart, err := writer.CreateFormFile("file", "clip.mp4")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := filePart.Write([]byte("fake-mp4-bytes")); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.WriteField("bucket", "content"); err != nil {
		t.Fatalf("write bucket: %v", err)
	}
	if err := writer.WriteField("key", "user-1/clip.mp4"); err != nil {
		t.Fatalf("write key: %v", err)
	}
	const edit = `{"start":1,"end":2,"crop":{"x":0.1,"y":0.1,"w":0.5,"h":0.5}}`
	if err := writer.WriteField("video_edit", edit); err != nil {
		t.Fatalf("write video_edit: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest("POST", "/storage/v1/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = req

	handler := &StorageHandler{}
	if _, _, err := handler.readUploadFile(ctx); err != nil {
		t.Fatalf("readUploadFile: %v", err)
	}
	if got := ctx.PostForm("video_edit"); got != edit {
		t.Fatalf("video_edit after reading the file = %q, want %q", got, edit)
	}
}
