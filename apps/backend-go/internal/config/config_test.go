package config

import (
	"os"
	"testing"
)

// =============================================================================
// LoadConfig tests
// =============================================================================

func TestLoadConfig_Defaults(t *testing.T) {
	// Clear env vars to test defaults
	os.Unsetenv("SERVER_PORT")
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("REDIS_URL")
	os.Unsetenv("SERVER_DOMAIN")
	os.Unsetenv("FEDERATION_KEY")
	os.Unsetenv("ENVIRONMENT")
	os.Unsetenv("ALLOWED_ORIGINS")
	os.Unsetenv("TLS_CERT_FILE")
	os.Unsetenv("TLS_KEY_FILE")
	os.Unsetenv("TLS_REDIRECT_HTTP")

	cfg := LoadConfig()

	if cfg.ServerPort != "8080" {
		t.Errorf("Expected default ServerPort '8080', got '%s'", cfg.ServerPort)
	}
	if cfg.DatabaseURL != "postgres://user:password@localhost/gomo6?sslmode=disable" {
		t.Errorf("Unexpected default DatabaseURL: '%s'", cfg.DatabaseURL)
	}
	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("Unexpected default RedisURL: '%s'", cfg.RedisURL)
	}
	if cfg.ServerDomain != "localhost:8080" {
		t.Errorf("Expected default ServerDomain 'localhost:8080', got '%s'", cfg.ServerDomain)
	}
	if cfg.Environment != "development" {
		t.Errorf("Expected default Environment 'development', got '%s'", cfg.Environment)
	}
	if cfg.TLSRedirectHTTP {
		t.Error("Expected default TLSRedirectHTTP=false")
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Errorf("Expected 2 default allowed origins, got %d: %v", len(cfg.AllowedOrigins), cfg.AllowedOrigins)
	}
}

func TestLoadConfig_CustomValues(t *testing.T) {
	os.Setenv("SERVER_PORT", "9090")
	os.Setenv("DATABASE_URL", "postgres://custom:custom@db/gomo6")
	os.Setenv("REDIS_URL", "redis://custom-redis:6380")
	os.Setenv("SERVER_DOMAIN", "example.com")
	os.Setenv("FEDERATION_KEY", "my-custom-key")
	os.Setenv("ENVIRONMENT", "production")
	os.Setenv("ALLOWED_ORIGINS", "https://app.example.com, https://admin.example.com")
	os.Setenv("TLS_CERT_FILE", "/certs/cert.pem")
	os.Setenv("TLS_KEY_FILE", "/certs/key.pem")
	os.Setenv("TLS_REDIRECT_HTTP", "true")
	defer func() {
		os.Unsetenv("SERVER_PORT")
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("REDIS_URL")
		os.Unsetenv("SERVER_DOMAIN")
		os.Unsetenv("FEDERATION_KEY")
		os.Unsetenv("ENVIRONMENT")
		os.Unsetenv("ALLOWED_ORIGINS")
		os.Unsetenv("TLS_CERT_FILE")
		os.Unsetenv("TLS_KEY_FILE")
		os.Unsetenv("TLS_REDIRECT_HTTP")
	}()

	cfg := LoadConfig()

	if cfg.ServerPort != "9090" {
		t.Errorf("Expected ServerPort '9090', got '%s'", cfg.ServerPort)
	}
	if cfg.DatabaseURL != "postgres://custom:custom@db/gomo6" {
		t.Errorf("Unexpected DatabaseURL: '%s'", cfg.DatabaseURL)
	}
	if cfg.Environment != "production" {
		t.Errorf("Expected Environment 'production', got '%s'", cfg.Environment)
	}
	if cfg.TLSCertFile != "/certs/cert.pem" || cfg.TLSKeyFile != "/certs/key.pem" {
		t.Errorf("TLS files: cert=%s, key=%s", cfg.TLSCertFile, cfg.TLSKeyFile)
	}
	if !cfg.TLSRedirectHTTP {
		t.Error("Expected TLSRedirectHTTP=true")
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Errorf("Expected 2 allowed origins, got %d: %v", len(cfg.AllowedOrigins), cfg.AllowedOrigins)
	}
	if cfg.FederationKey != "my-custom-key" {
		t.Errorf("Expected FederationKey 'my-custom-key', got '%s'", cfg.FederationKey)
	}
}

func TestLoadConfig_JWTSecretNotSet(t *testing.T) {
	os.Unsetenv("JWT_SECRET")
	cfg := LoadConfig()
	if cfg.JWTSecret != "" {
		t.Errorf("Expected empty JWTSecret (uses GetJWTSecret() auth logic), got '%s'", cfg.JWTSecret)
	}
}

func TestLoadConfig_AllowedOriginsCustom(t *testing.T) {
	os.Setenv("ALLOWED_ORIGINS", "https://app.com, https://api.com")
	defer os.Unsetenv("ALLOWED_ORIGINS")

	cfg := LoadConfig()
	if len(cfg.AllowedOrigins) != 2 {
		t.Fatalf("Expected 2 origins, got %d: %v", len(cfg.AllowedOrigins), cfg.AllowedOrigins)
	}
	if cfg.AllowedOrigins[0] != "https://app.com" {
		t.Errorf("Expected origin 'https://app.com', got '%s'", cfg.AllowedOrigins[0])
	}
	if cfg.AllowedOrigins[1] != "https://api.com" {
		t.Errorf("Expected origin 'https://api.com', got '%s'", cfg.AllowedOrigins[1])
	}
}

// =============================================================================
// parseOrigins tests
// =============================================================================

func TestParseOrigins_Empty(t *testing.T) {
	result := parseOrigins("")
	if len(result) != 0 {
		t.Errorf("Expected 0 origins, got %d: %v", len(result), result)
	}
}

func TestParseOrigins_Single(t *testing.T) {
	result := parseOrigins("http://localhost:5173")
	if len(result) != 1 || result[0] != "http://localhost:5173" {
		t.Errorf("Expected [http://localhost:5173], got %v", result)
	}
}

func TestParseOrigins_Multiple(t *testing.T) {
	result := parseOrigins("http://a.com, http://b.com, http://c.com")
	if len(result) != 3 {
		t.Fatalf("Expected 3 origins, got %d: %v", len(result), result)
	}
	if result[0] != "http://a.com" || result[1] != "http://b.com" || result[2] != "http://c.com" {
		t.Errorf("Unexpected origins: %v", result)
	}
}

func TestParseOrigins_TrimSpaces(t *testing.T) {
	result := parseOrigins("   http://a.com   ,   http://b.com   ")
	if len(result) != 2 {
		t.Fatalf("Expected 2 origins, got %d: %v", len(result), result)
	}
	if result[0] != "http://a.com" || result[1] != "http://b.com" {
		t.Errorf("Unexpected origins after trim: %v", result)
	}
}

func TestParseOrigins_TrailingComma(t *testing.T) {
	result := parseOrigins("http://a.com,")
	if len(result) != 1 || result[0] != "http://a.com" {
		t.Errorf("Expected [http://a.com], got %v", result)
	}
}

func TestParseOrigins_LeadingComma(t *testing.T) {
	result := parseOrigins(",http://a.com")
	if len(result) != 1 || result[0] != "http://a.com" {
		t.Errorf("Expected [http://a.com], got %v", result)
	}
}

func TestParseOrigins_EmptyEntries(t *testing.T) {
	result := parseOrigins("http://a.com,,http://b.com")
	if len(result) != 2 {
		t.Errorf("Expected 2 origins (empty entries filtered), got %d: %v", len(result), result)
	}
}

func TestParseOrigins_NoSpaces(t *testing.T) {
	result := parseOrigins("http://a.com,http://b.com,http://c.com")
	if len(result) != 3 {
		t.Fatalf("Expected 3 origins, got %d: %v", len(result), result)
	}
}

// =============================================================================
// getEnv tests
// =============================================================================

func TestGetEnv_DefaultUsed(t *testing.T) {
	os.Unsetenv("TEST_ENV_VAR")
	result := getEnv("TEST_ENV_VAR", "default-value")
	if result != "default-value" {
		t.Errorf("Expected 'default-value', got '%s'", result)
	}
}

func TestGetEnv_EnvVarUsed(t *testing.T) {
	os.Setenv("TEST_ENV_VAR", "actual-value")
	defer os.Unsetenv("TEST_ENV_VAR")

	result := getEnv("TEST_ENV_VAR", "default-value")
	if result != "actual-value" {
		t.Errorf("Expected 'actual-value', got '%s'", result)
	}
}

func TestGetEnv_EmptyEnvVar(t *testing.T) {
	os.Setenv("TEST_ENV_VAR", "")
	defer os.Unsetenv("TEST_ENV_VAR")

	result := getEnv("TEST_ENV_VAR", "fallback")
	if result != "fallback" {
		t.Errorf("Expected 'fallback' for empty env var, got '%s'", result)
	}
}

// =============================================================================
// getEnvBool tests
// =============================================================================

func TestGetEnvBool_Default(t *testing.T) {
	os.Unsetenv("TEST_BOOL")
	if getEnvBool("TEST_BOOL", true) != true {
		t.Error("Expected default true")
	}
	if getEnvBool("TEST_BOOL", false) != false {
		t.Error("Expected default false")
	}
}

func TestGetEnvBool_TrueValues(t *testing.T) {
	tests := []string{"true", "1", "TRUE", "True"}
	for _, v := range tests {
		os.Setenv("TEST_BOOL", v)
		if !getEnvBool("TEST_BOOL", false) {
			t.Errorf("Expected true for '%s'", v)
		}
		os.Unsetenv("TEST_BOOL")
	}
}

func TestGetEnvBool_FalseValues(t *testing.T) {
	tests := []string{"false", "0", "FALSE", "False"}
	for _, v := range tests {
		os.Setenv("TEST_BOOL", v)
		if getEnvBool("TEST_BOOL", true) {
			t.Errorf("Expected false for '%s'", v)
		}
		os.Unsetenv("TEST_BOOL")
	}
}

func TestGetEnvBool_InvalidValue(t *testing.T) {
	os.Setenv("TEST_BOOL", "not-a-bool")
	defer os.Unsetenv("TEST_BOOL")

	if getEnvBool("TEST_BOOL", true) != true {
		t.Error("Expected default true for invalid value")
	}
}

// =============================================================================
// Config struct tests
// =============================================================================

func TestConfig_Fields(t *testing.T) {
	cfg := &Config{
		ServerPort:       "8443",
		DatabaseURL:      "postgres://localhost/test",
		RedisURL:         "redis://localhost:6380",
		JWTSecret:        "my-secret",
		ServerDomain:     "example.com",
		FederationKey:    "fed-key",
		Environment:      "staging",
		AllowedOrigins:   []string{"https://app.example.com"},
		TLSCertFile:      "/ssl/cert.pem",
		TLSKeyFile:       "/ssl/key.pem",
		TLSRedirectHTTP:  true,
	}

	if cfg.ServerPort != "8443" {
		t.Errorf("ServerPort field mismatch")
	}
	if cfg.TLSRedirectHTTP != true {
		t.Error("TLSRedirectHTTP field mismatch")
	}
	if len(cfg.AllowedOrigins) != 1 {
		t.Error("AllowedOrigins field mismatch")
	}
}
