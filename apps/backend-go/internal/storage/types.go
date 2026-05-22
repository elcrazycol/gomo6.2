package storage

type UploadRequest struct {
	Bucket      string `json:"bucket"`
	Key         string `json:"key"`
	ContentType string `json:"content_type"`
	Data        []byte `json:"data"`
}

type UploadResponse struct {
	Success bool      `json:"success"`
	File    *FileInfo `json:"file,omitempty"`
	Error   string    `json:"error,omitempty"`
}

type DownloadResponse struct {
	Success     bool   `json:"success"`
	Data        []byte `json:"data,omitempty"`
	ContentType string `json:"content_type,omitempty"`
	Error       string `json:"error,omitempty"`
}

type DeleteResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type PresignedURLResponse struct {
	Success bool   `json:"success"`
	URL     string `json:"url,omitempty"`
	Error   string `json:"error,omitempty"`
}

type PresignUploadRequest struct {
	Bucket      string `json:"bucket"`
	Key         string `json:"key"`
	ContentType string `json:"content_type"`
	Expires     int64  `json:"expires_seconds,omitempty"`
}

type PresignUploadResponse struct {
	Success   bool   `json:"success"`
	UploadURL string `json:"upload_url,omitempty"`
	Bucket    string `json:"bucket,omitempty"`
	Key       string `json:"key,omitempty"`
	Error     string `json:"error,omitempty"`
}
