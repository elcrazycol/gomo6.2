package database

import (
	"os"
	"strconv"
	"strings"
)

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt reads a positive integer env var, falling back to defaultValue when
// unset, non-numeric or non-positive.
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if n, err := strconv.Atoi(value); err == nil && n > 0 {
			return n
		}
	}
	return defaultValue
}

// getEnvBool reads a boolean env var: "1", "true", "yes", "on" are true and
// "0", "false", "no", "off" are false; anything else (or unset) yields def.
func getEnvBool(key string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}
