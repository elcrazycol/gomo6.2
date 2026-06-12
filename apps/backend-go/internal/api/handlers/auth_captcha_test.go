package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestGetCaptchaConfig_NoCaptchaHandler(t *testing.T) {
	h, _ := setupAuthHandler(t)

	c, w := newGETContext("/api/v1/auth/captcha-config", nil)
	h.GetCaptchaConfig(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Enabled bool   `json:"enabled"`
			SiteKey string `json:"site_key"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp.Success {
		t.Fatal("expected success response")
	}
	if resp.Data.Enabled {
		t.Fatal("expected captcha disabled when handler is not configured")
	}
	if resp.Data.SiteKey != "" {
		t.Fatalf("expected empty site_key, got %q", resp.Data.SiteKey)
	}
}

func TestGetCaptchaConfig_ExternalMCaptchaConfigured(t *testing.T) {
	h, _ := setupAuthHandler(t)
	h.captchaHandler = &CaptchaHandler{
		siteKey:   "site-key",
		secret:    "secret",
		verifyURL: "https://captcha.example/verify",
	}

	c, w := newGETContext("/api/v1/auth/captcha-config", nil)
	h.GetCaptchaConfig(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Type    string `json:"type"`
			Enabled bool   `json:"enabled"`
			SiteKey string `json:"site_key"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp.Success {
		t.Fatal("expected success response")
	}
	if resp.Data.Type != "mcaptcha" {
		t.Fatalf("expected mcaptcha type, got %q", resp.Data.Type)
	}
	if !resp.Data.Enabled {
		t.Fatal("expected captcha enabled when external mCaptcha is configured")
	}
	if resp.Data.SiteKey != "site-key" {
		t.Fatalf("expected site-key, got %q", resp.Data.SiteKey)
	}
}

func TestGetCaptchaChallenge_NoCaptchaHandler(t *testing.T) {
	h, _ := setupAuthHandler(t)

	c, w := newGETContext("/api/v1/auth/captcha-challenge", nil)
	h.GetCaptchaChallenge(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Success {
		t.Fatal("expected error response")
	}
	if resp.Error != "CAPTCHA service not available" {
		t.Fatalf("unexpected error message: %q", resp.Error)
	}
}

func TestGetCaptchaChallenge_ExternalMCaptchaConfigured(t *testing.T) {
	h, _ := setupAuthHandler(t)
	h.captchaHandler = &CaptchaHandler{
		siteKey:   "site-key",
		secret:    "secret",
		verifyURL: "https://captcha.example/verify",
	}

	c, w := newGETContext("/api/v1/auth/captcha-challenge", nil)
	h.GetCaptchaChallenge(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp.Success {
		t.Fatal("expected success response")
	}
	if resp.Data.Type != "mcaptcha" {
		t.Fatalf("expected mcaptcha type, got %q", resp.Data.Type)
	}
	if resp.Data.Message != "Use mCaptcha widget for challenge" {
		t.Fatalf("unexpected challenge message: %q", resp.Data.Message)
	}
}
