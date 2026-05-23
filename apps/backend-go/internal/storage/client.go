package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type FileInfo struct {
	Bucket       string    `json:"bucket"`
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	ContentType  string    `json:"contentType"`
	ETag         string    `json:"etag"`
	LastModified time.Time `json:"lastModified"`
}

// StorageClient talks to Garage over S3 API. Server-side ops use the internal endpoint;
// presigned URLs for browsers use GARAGE_S3_PUBLIC_ENDPOINT when set (required when
// the API runs in Docker and the browser cannot resolve docker hostnames).
type StorageClient struct {
	s3        *s3.Client
	presigner *s3.PresignClient
	ctx       context.Context
}

func buildS3Client(endpoint, region, accessKey, secretKey string) (*s3.Client, error) {
	cfg, err := config.LoadDefaultConfig(
		context.Background(),
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
		config.WithEndpointResolver(aws.EndpointResolverFunc(func(service, region string) (aws.Endpoint, error) { //nolint:staticcheck // SA1019: v1 deprecated but v2 not available in current SDK version
			return aws.Endpoint{
				URL:               endpoint,
				SigningRegion:     region,
				HostnameImmutable: true,
			}, nil
		})),
	)
	if err != nil {
		return nil, err
	}
	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
	}), nil
}

func normalizeEndpoint(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("endpoint must include http or https scheme")
	}
	// url.Parse is lenient: "localhost:3900" parses as scheme=localhost,opaque=3900.
	// Reject URLs that don't look like proper HTTP endpoints.
	if u.Host == "" {
		return "", fmt.Errorf("endpoint must have a host (e.g. http://host:port)")
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}

// browserReachableS3URL rewrites Docker-only hostnames in the S3 endpoint used for presigned URLs.
// Browsers on the host cannot resolve Docker service names (garage, garage-proxy, etc.).
func browserReachableS3URL(ep string) (string, error) {
	u, err := url.Parse(ep)
	if err != nil {
		return ep, err
	}
	h := strings.ToLower(u.Hostname())
	// Common Garage / compose hostnames that are not resolvable from the user's browser.
	if h != "garage-proxy" && h != "garage" {
		return ep, nil
	}
	port := u.Port()
	if port == "" {
		port = "3900"
	}
	return normalizeEndpoint(fmt.Sprintf("http://localhost:%s", port))
}

// loadEnvFile reads /garage-keys/s3.env and sets environment variables.
// This avoids shell-sourcing which can fail on special characters in secrets.
func loadEnvFile() {
	const path = "/garage-keys/s3.env"
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("storage: no env file at %s (%v), falling back to OS env vars", path, err)
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		val = strings.Trim(val, "'\"")
		if key != "" {
			os.Setenv(key, val)
		}
	}
	log.Printf("storage: loaded credentials from %s", path)
}

// NewStorageClient builds an S3 client for Garage. Fails soft on bucket bootstrap
// (logs only) so the process can still start if Garage is temporarily down.
func NewStorageClient() (*StorageClient, error) {
	// Try loading from /garage-keys/s3.env first (Docker shared volume), fallback to OS env
	loadEnvFile()
	endpoint := os.Getenv("GARAGE_S3_ENDPOINT")
	accessKey := os.Getenv("GARAGE_S3_ACCESS_KEY")
	secretKey := os.Getenv("GARAGE_S3_SECRET_KEY")
	region := os.Getenv("GARAGE_S3_REGION")
	if region == "" {
		region = "garage"
	}

	if endpoint == "" || accessKey == "" || secretKey == "" {
		return nil, fmt.Errorf("missing Garage S3 configuration (GARAGE_S3_ENDPOINT, access/secret key)")
	}

	internalEP, err := normalizeEndpoint(endpoint)
	if err != nil {
		return nil, fmt.Errorf("GARAGE_S3_ENDPOINT: %w", err)
	}

	publicRaw := strings.TrimSpace(os.Getenv("GARAGE_S3_PUBLIC_ENDPOINT"))
	if publicRaw == "" {
		publicRaw = endpoint
		if u, perr := url.Parse(endpoint); perr == nil && strings.EqualFold(u.Hostname(), "garage-proxy") {
			port := u.Port()
			if port == "" {
				port = "3900"
			}
			publicRaw = fmt.Sprintf("http://localhost:%s", port)
		}
	}
	publicEP, err := normalizeEndpoint(publicRaw)
	if err != nil {
		return nil, fmt.Errorf("GARAGE_S3_PUBLIC_ENDPOINT: %w", err)
	}
	publicEP, err = browserReachableS3URL(publicEP)
	if err != nil {
		return nil, fmt.Errorf("public S3 URL for browser: %w", err)
	}

	s3Internal, err := buildS3Client(internalEP, region, accessKey, secretKey)
	if err != nil {
		return nil, fmt.Errorf("s3 client: %w", err)
	}

	// Always use a presigner bound to the browser-facing URL. Never reuse the internal
	// client for presigning: string equality between public/internal can misbehave, and
	// an outdated binary would otherwise emit garage-proxy in signed URLs.
	s3Public, err := buildS3Client(publicEP, region, accessKey, secretKey)
	if err != nil {
		return nil, fmt.Errorf("s3 public presign client: %w", err)
	}
	presigner := s3.NewPresignClient(s3Public)
	log.Printf("storage: S3 internal endpoint %s, presigned URLs use %s", internalEP, publicEP)

	s := &StorageClient{
		s3:        s3Internal,
		presigner: presigner,
		ctx:       context.Background(),
	}

	s.bootstrapBucketsBestEffort()

	return s, nil
}

// bootstrapBucketsBestEffort verifies that all allowed buckets exist.
// Buckets are created by garage-init at container startup — the backend only checks.
func (s *StorageClient) bootstrapBucketsBestEffort() {
	for bucket := range loadAllowedBuckets() {
		_, err := s.s3.HeadBucket(s.ctx, &s3.HeadBucketInput{Bucket: aws.String(bucket)})
		if err != nil {
			log.Printf("storage: bucket %q not found (did garage-init create it?): %v", bucket, err)
		} else {
			log.Printf("storage: bucket %q OK", bucket)
		}
	}
}



// UploadFile stores an object. Bucket must be allowlisted.
func (s *StorageClient) UploadFile(bucket, key string, data []byte, contentType string) (*FileInfo, error) {
	if !IsAllowedBucket(bucket) {
		return nil, fmt.Errorf("bucket not allowed: %s", bucket)
	}
	if err := ValidateObjectKey(key); err != nil {
		return nil, err
	}
	out, err := s.s3.PutObject(s.ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return nil, fmt.Errorf("upload %s/%s (%d bytes): %w", bucket, key, len(data), err)
	}

	return &FileInfo{
		Bucket:       bucket,
		Key:          key,
		Size:         int64(len(data)),
		ETag:         aws.ToString(out.ETag),
		LastModified: time.Now().UTC(),
		ContentType:  contentType,
	}, nil
}

// GetObject streams an object from Garage (no presign, no extra HTTP hop).
func (s *StorageClient) GetObject(ctx context.Context, bucket, key string) (*s3.GetObjectOutput, error) {
	if !IsAllowedBucket(bucket) {
		return nil, fmt.Errorf("bucket not allowed: %s", bucket)
	}
	if err := ValidateObjectKey(key); err != nil {
		return nil, err
	}
	out, err := s.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetObjectRange streams an object with optional byte range support for partial content.
func (s *StorageClient) GetObjectRange(ctx context.Context, bucket, key string, rangeStart, rangeEnd *int64) (*s3.GetObjectOutput, error) {
	if !IsAllowedBucket(bucket) {
		return nil, fmt.Errorf("bucket not allowed: %s", bucket)
	}
	if err := ValidateObjectKey(key); err != nil {
		return nil, err
	}

	input := &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}

	// Build Range header if specified
	if rangeStart != nil || rangeEnd != nil {
		var rangeStr string
		if rangeStart != nil && rangeEnd != nil {
			rangeStr = fmt.Sprintf("bytes=%d-%d", *rangeStart, *rangeEnd)
		} else if rangeStart != nil {
			rangeStr = fmt.Sprintf("bytes=%d-", *rangeStart)
		} else if rangeEnd != nil {
			rangeStr = fmt.Sprintf("bytes=0-%d", *rangeEnd)
		}
		if rangeStr != "" {
			input.Range = aws.String(rangeStr)
		}
	}

	out, err := s.s3.GetObject(ctx, input)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// IsNotFound reports whether err is an S3 missing-object error.
func IsNotFound(err error) bool {
	if err == nil {
		return false
	}
	var ae smithy.APIError
	if errors.As(err, &ae) {
		switch ae.ErrorCode() {
		case "NoSuchKey", "NotFound":
			return true
		}
	}
	// Some S3-compatible backends wrap errors without typed codes.
	return strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "Not Found")
}

func (s *StorageClient) GetFile(bucket, key string) ([]byte, string, error) {
	out, err := s.GetObject(s.ctx, bucket, key)
	if err != nil {
		return nil, "", err
	}
	defer out.Body.Close()

	b, err := io.ReadAll(out.Body)
	if err != nil {
		return nil, "", fmt.Errorf("read body: %w", err)
	}

	ct := ""
	if out.ContentType != nil {
		ct = aws.ToString(out.ContentType)
	}
	return b, ct, nil
}

func (s *StorageClient) DeleteFile(bucket, key string) error {
	if !IsAllowedBucket(bucket) {
		return fmt.Errorf("bucket not allowed: %s", bucket)
	}
	if err := ValidateObjectKey(key); err != nil {
		return err
	}
	_, err := s.s3.DeleteObject(s.ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	return nil
}

// GetPresignedURL returns a GET URL for clients that must talk to Garage directly (rare here).
func (s *StorageClient) GetPresignedURL(bucket, key string, expiry time.Duration) (string, error) {
	if !IsAllowedBucket(bucket) {
		return "", fmt.Errorf("bucket not allowed: %s", bucket)
	}
	if err := ValidateObjectKey(key); err != nil {
		return "", err
	}

	out, err := s.presigner.PresignGetObject(s.ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}
	return out.URL, nil
}

// GetPresignedPutURL returns a PUT URL for direct browser uploads to Garage.
func (s *StorageClient) GetPresignedPutURL(bucket, key string, contentType string, expiry time.Duration) (string, error) {
	if !IsAllowedBucket(bucket) {
		return "", fmt.Errorf("bucket not allowed: %s", bucket)
	}
	if err := ValidateObjectKey(key); err != nil {
		return "", err
	}
	out, err := s.presigner.PresignPutObject(s.ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign put: %w", err)
	}
	return out.URL, nil
}
