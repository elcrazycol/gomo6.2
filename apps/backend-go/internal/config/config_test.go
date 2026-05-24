package config

import (
	"os"
	"testing"
)

// =============================================================================
// LoadConfig — defaults
// =============================================================================

func TestLoadConfig_Defaults(t *testing.T) {
	// Clear all env vars that LoadConfig reads
	for _, key := range []string{
		"SERVER_PORT", "DATABASE_URL", "REDIS_URL", "JWT_SECRET",
		"SERVER_DOMAIN", "FEDERATION_KEY", "ENVIRONMENT", "ALLOWED_ORIGINS",
		"TLS_CERT_FILE", "TLS_KEY_FILE", "TLS_REDIRECT_HTTP",
	} {
		os.Unsetenv(key)
	}

	cfg := LoadConfig()

	if cfg.ServerPort != "8080" {
		t.Errorf("expected ServerPort 8080, got %q", cfg.ServerPort)
	}
	if cfg.DatabaseURL != "postgres://user:password@localhost/gomo6?sslmode=disable" {
		t.Errorf("unexpected DatabaseURL: %q", cfg.DatabaseURL)
	}
	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("unexpected RedisURL: %q", cfg.RedisURL)
	}
	if cfg.ServerDomain != "localhost:8080" {
		t.Errorf("unexpected ServerDomain: %q", cfg.ServerDomain)
	}
	if cfg.FederationKey != "your-federation-key" {
		t.Errorf("unexpected FederationKey: %q", cfg.FederationKey)
	}
	if cfg.Environment != "development" {
		t.Errorf("unexpected Environment: %q", cfg.Environment)
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Errorf("expected 2 default origins, got %d: %v", len(cfg.AllowedOrigins), cfg.AllowedOrigins)
	}
	if cfg.TLSCertFile != "" {
		t.Errorf("expected empty TLSCertFile, got %q", cfg.TLSCertFile)
	}
	if cfg.TLSKeyFile != "" {
		t.Errorf("expected empty TLSKeyFile, got %q", cfg.TLSKeyFile)
	}
	if cfg.TLSRedirectHTTP != false {
		t.Errorf("expected TLSRedirectHTTP to default to false")
	}
}

func TestLoadConfig_FromEnv(t *testing.T) {
	os.Setenv("SERVER_PORT", "9090")
	os.Setenv("DATABASE_URL", "postgres://prod:secret@pg.example.com/gomo6")
	os.Setenv("REDIS_URL", "redis://redis.example.com:6380")
	os.Setenv("SERVER_DOMAIN", "gomo6.wtf")
	os.Setenv("FEDERATION_KEY", "fed-key-123")
	os.Setenv("ENVIRONMENT", "production")
	defer func() {
		for _, key := range []string{
			"SERVER_PORT", "DATABASE_URL", "REDIS_URL",
			"SERVER_DOMAIN", "FEDERATION_KEY", "ENVIRONMENT",
		} {
			os.Unsetenv(key)
		}
	}()

	cfg := LoadConfig()

	if cfg.ServerPort != "9090" {
		t.Errorf("expected ServerPort 9090, got %q", cfg.ServerPort)
	}
	if cfg.DatabaseURL != "postgres://prod:secret@pg.example.com/gomo6" {
		t.Errorf("expected DatabaseURL from env, got %q", cfg.DatabaseURL)
	}
	if cfg.RedisURL != "redis://redis.example.com:6380" {
		t.Errorf("expected RedisURL from env, got %q", cfg.RedisURL)
	}
	if cfg.ServerDomain != "gomo6.wtf" {
		t.Errorf("expected ServerDomain from env, got %q", cfg.ServerDomain)
	}
	if cfg.FederationKey != "fed-key-123" {
		t.Errorf("expected FederationKey from env, got %q", cfg.FederationKey)
	}
	if cfg.Environment != "production" {
		t.Errorf("expected Environment 'production', got %q", cfg.Environment)
	}
}

// =============================================================================
// TLS config
// =============================================================================

func TestLoadConfig_TLS(t *testing.T) {
	os.Setenv("TLS_CERT_FILE", "/etc/ssl/cert.pem")
	os.Setenv("TLS_KEY_FILE", "/etc/ssl/key.pem")
	os.Setenv("TLS_REDIRECT_HTTP", "true")
	defer func() {
		os.Unsetenv("TLS_CERT_FILE")
		os.Unsetenv("TLS_KEY_FILE")
		os.Unsetenv("TLS_REDIRECT_HTTP")
	}()

	cfg := LoadConfig()

	if cfg.TLSCertFile != "/etc/ssl/cert.pem" {
		t.Errorf("expected TLSCertFile from env, got %q", cfg.TLSCertFile)
	}
	if cfg.TLSKeyFile != "/etc/ssl/key.pem" {
		t.Errorf("expected TLSKeyFile from env, got %q", cfg.TLSKeyFile)
	}
	if !cfg.TLSRedirectHTTP {
		t.Errorf("expected TLSRedirectHTTP to be true")
	}
}

// =============================================================================
// parseOrigins
// =============================================================================

func TestParseOrigins_Single(t *testing.T) {
	result := parseOrigins("http://localhost:5173")
	if len(result) != 1 || result[0] != "http://localhost:5173" {
		t.Errorf("expected [http://localhost:5173], got %v", result)
	}
}

func TestParseOrigins_Multiple(t *testing.T) {
	result := parseOrigins("http://a.com,https://b.com,http://c.com")
	if len(result) != 3 {
		t.Fatalf("expected 3 origins, got %d: %v", len(result), result)
	}
	if result[0] != "http://a.com" {
		t.Errorf("unexpected result[0]: %q", result[0])
	}
	if result[1] != "https://b.com" {
		t.Errorf("unexpected result[1]: %q", result[1])
	}
	if result[2] != "http://c.com" {
		t.Errorf("unexpected result[2]: %q", result[2])
	}
}

func TestParseOrigins_WhitespaceAround(t *testing.T) {
	result := parseOrigins(" http://a.com , https://b.com , http://c.com ")
	if len(result) != 3 {
		t.Fatalf("expected 3 origins after trim, got %d: %v", len(result), result)
	}
	if result[0] != "http://a.com" {
		t.Errorf("expected trimmed [0], got %q", result[0])
	}
	if result[1] != "https://b.com" {
		t.Errorf("expected trimmed [1], got %q", result[1])
	}
	if result[2] != "http://c.com" {
		t.Errorf("expected trimmed [2], got %q", result[2])
	}
}

func TestParseOrigins_Empty(t *testing.T) {
	result := parseOrigins("")
	if len(result) != 0 {
		t.Errorf("expected empty result for empty input, got %v", result)
	}
}

func TestParseOrigins_OnlyWhitespace(t *testing.T) {
	result := parseOrigins("  ,  ,  ")
	if len(result) != 0 {
		t.Errorf("expected empty result for whitespace-only input, got %v", result)
	}
}

func TestParseOrigins_TrailingComma(t *testing.T) {
	result := parseOrigins("http://a.com,")
	if len(result) != 1 || result[0] != "http://a.com" {
		t.Errorf("expected [http://a.com] for trailing comma, got %v", result)
	}
}

func TestParseOrigins_LeadingComma(t *testing.T) {
	result := parseOrigins(",http://a.com")
	if len(result) != 1 || result[0] != "http://a.com" {
		t.Errorf("expected [http://a.com] for leading comma, got %v", result)
	}
}

// =============================================================================
// getEnv
// =============================================================================

func TestGetEnv_VariableSet(t *testing.T) {
	os.Setenv("TEST_GETENV_FOO", "bar")
	defer os.Unsetenv("TEST_GETENV_FOO")

	if got := getEnv("TEST_GETENV_FOO", "default"); got != "bar" {
		t.Errorf("expected 'bar', got %q", got)
	}
}

func TestGetEnv_VariableNotSet(t *testing.T) {
	os.Unsetenv("TEST_GETENV_MISSING")

	if got := getEnv("TEST_GETENV_MISSING", "fallback"); got != "fallback" {
		t.Errorf("expected 'fallback', got %q", got)
	}
}

func TestGetEnv_EmptyValue(t *testing.T) {
	os.Setenv("TEST_GETENV_EMPTY", "")
	defer os.Unsetenv("TEST_GETENV_EMPTY")

	// Empty string treated as not set -> returns default
	if got := getEnv("TEST_GETENV_EMPTY", "default"); got != "default" {
		t.Errorf("expected 'default' for empty env var, got %q", got)
	}
}

// =============================================================================
// getEnvBool
// =============================================================================

func TestGetEnvBool_True(t *testing.T) {
	os.Setenv("TEST_BOOL_TRUE", "true")
	defer os.Unsetenv("TEST_BOOL_TRUE")

	if !getEnvBool("TEST_BOOL_TRUE", false) {
		t.Error("expected true")
	}
}

func TestGetEnvBool_False(t *testing.T) {
	os.Setenv("TEST_BOOL_FALSE", "false")
	defer os.Unsetenv("TEST_BOOL_FALSE")

	if getEnvBool("TEST_BOOL_FALSE", true) {
		t.Error("expected false")
	}
}

func TestGetEnvBool_OneAndZero(t *testing.T) {
	os.Setenv("TEST_BOOL_1", "1")
	defer os.Unsetenv("TEST_BOOL_1")

	if !getEnvBool("TEST_BOOL_1", false) {
		t.Error("expected true for '1'")
	}

	os.Setenv("TEST_BOOL_0", "0")
	defer os.Unsetenv("TEST_BOOL_0")

	if getEnvBool("TEST_BOOL_0", true) {
		t.Error("expected false for '0'")
	}
}

func TestGetEnvBool_InvalidValue(t *testing.T) {
	os.Setenv("TEST_BOOL_GARBAGE", "not-a-bool")
	defer os.Unsetenv("TEST_BOOL_GARBAGE")

	// Invalid value → falls back to default
	if !getEnvBool("TEST_BOOL_GARBAGE", true) {
		t.Error("expected default=true for invalid bool value")
	}
	if getEnvBool("TEST_BOOL_GARBAGE", false) {
		t.Error("expected default=false for invalid bool value")
	}
}

func TestGetEnvBool_NotSet(t *testing.T) {
	os.Unsetenv("TEST_BOOL_MISSING")

	if !getEnvBool("TEST_BOOL_MISSING", true) {
		t.Error("expected default=true when not set")
	}
	if getEnvBool("TEST_BOOL_MISSING", false) {
		t.Error("expected default=false when not set")
	}
}

func TestGetEnvBool_EmptyValue(t *testing.T) {
	os.Setenv("TEST_BOOL_EMPTY", "")
	defer os.Unsetenv("TEST_BOOL_EMPTY")

	if !getEnvBool("TEST_BOOL_EMPTY", true) {
		t.Error("expected default=true for empty string")
	}
}

// =============================================================================
// Config — AllowedOrigins from env
// =============================================================================

func TestLoadConfig_AllowedOriginsFromEnv(t *testing.T) {
	os.Setenv("ALLOWED_ORIGINS", "https://gomo6.wtf,https://dev.gomo6.wtf,https://docs.gomo6.wtf")
	defer os.Unsetenv("ALLOWED_ORIGINS")

	cfg := LoadConfig()
	if len(cfg.AllowedOrigins) != 3 {
		t.Fatalf("expected 3 origins, got %d: %v", len(cfg.AllowedOrigins), cfg.AllowedOrigins)
	}
	if cfg.AllowedOrigins[0] != "https://gomo6.wtf" {
		t.Errorf("unexpected origin[0]: %q", cfg.AllowedOrigins[0])
	}
	if cfg.AllowedOrigins[1] != "https://dev.gomo6.wtf" {
		t.Errorf("unexpected origin[1]: %q", cfg.AllowedOrigins[1])
	}
	if cfg.AllowedOrigins[2] != "https://docs.gomo6.wtf" {
		t.Errorf("unexpected origin[2]: %q", cfg.AllowedOrigins[2])
	}
}
