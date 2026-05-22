package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	ServerPort      string
	DatabaseURL     string
	RedisURL        string
	JWTSecret       string
	ServerDomain    string
	FederationKey   string
	Environment     string
	AllowedOrigins  []string
}

func LoadConfig() *Config {
	allowedOrigins := []string{"http://localhost:5173", "http://localhost:8080"}
	if origins := os.Getenv("ALLOWED_ORIGINS"); origins != "" {
		allowedOrigins = parseOrigins(origins)
	}

	return &Config{
		ServerPort:     getEnv("SERVER_PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://user:password@localhost/gomo6?sslmode=disable"),
		RedisURL:       getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:      os.Getenv("JWT_SECRET"), // Not used directly; auth.GetJWTSecret() has its own logic
		ServerDomain:   getEnv("SERVER_DOMAIN", "localhost:8080"),
		FederationKey:  getEnv("FEDERATION_KEY", "your-federation-key"),
		Environment:    getEnv("ENVIRONMENT", "development"),
		AllowedOrigins: allowedOrigins,
	}
}

func parseOrigins(origins string) []string {
	var result []string
	for i := 0; i < len(origins); {
		start := i
		for i < len(origins) && origins[i] != ',' {
			i++
		}
		if origin := origins[start:i]; origin != "" {
			// Trim spaces
			j := 0
			for j < len(origin) && origin[j] == ' ' {
				j++
			}
			k := len(origin)
			for k > j && origin[k-1] == ' ' {
				k--
			}
			if j < k {
				result = append(result, origin[j:k])
			}
		}
		i++
	}
	return result
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}
