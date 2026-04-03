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
}

func LoadConfig() *Config {
	return &Config{
		ServerPort:     getEnv("SERVER_PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://user:password@localhost/gomo6?sslmode=disable"),
		RedisURL:       getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:      getEnv("JWT_SECRET", "your-secret-key"),
		ServerDomain:   getEnv("SERVER_DOMAIN", "localhost:8080"),
		FederationKey:  getEnv("FEDERATION_KEY", "your-federation-key"),
		Environment:    getEnv("ENVIRONMENT", "development"),
	}
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
