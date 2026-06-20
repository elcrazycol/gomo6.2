package database

import (
	"os"
	"testing"
)

func TestGetEnv_Exists(t *testing.T) {
	os.Setenv("TEST_GETENV_EXISTS", "hello")
	defer os.Unsetenv("TEST_GETENV_EXISTS")

	got := getEnv("TEST_GETENV_EXISTS", "default")
	if got != "hello" {
		t.Errorf("getEnv() = %q, want %q", got, "hello")
	}
}

func TestGetEnv_Missing(t *testing.T) {
	os.Unsetenv("TEST_GETENV_MISSING_KEY_999")

	got := getEnv("TEST_GETENV_MISSING_KEY_999", "default")
	if got != "default" {
		t.Errorf("getEnv() = %q, want %q", got, "default")
	}
}

func TestGetEnv_Empty(t *testing.T) {
	os.Setenv("TEST_GETENV_EMPTY", "")
	defer os.Unsetenv("TEST_GETENV_EMPTY")

	got := getEnv("TEST_GETENV_EMPTY", "default")
	if got != "default" {
		t.Errorf("getEnv() = %q, want %q", got, "default")
	}
}
