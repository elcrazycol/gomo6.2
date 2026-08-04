package storage

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
