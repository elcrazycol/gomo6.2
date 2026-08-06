package geo

import "testing"

func TestLookup_KnownPublicIPs(t *testing.T) {
	tests := []struct {
		ip   string
		code string
	}{
		{"8.8.8.8", "US"},        // Google DNS
		{"77.88.8.8", "RU"},      // Yandex DNS
		{"208.67.222.222", "US"}, // OpenDNS
		{"1.1.1.1", "AU"},        // Cloudflare (anycast prefix registered in AU in this dataset)
	}
	for _, tt := range tests {
		code, name := Lookup(tt.ip)
		if code != tt.code {
			t.Errorf("Lookup(%s): expected code %q, got %q", tt.ip, tt.code, code)
		}
		if code != "" && name == "" {
			t.Errorf("Lookup(%s): country code %q must have a Russian name", tt.ip, code)
		}
	}
}

func TestLookup_RussianName(t *testing.T) {
	_, name := Lookup("77.88.8.8")
	if name != "Россия" {
		t.Errorf("expected 'Россия', got %q", name)
	}
}

func TestLookup_PrivateAndLocalIPs(t *testing.T) {
	for _, ip := range []string{
		"127.0.0.1",
		"::1",
		"10.0.0.5",
		"192.168.1.1",
		"172.16.0.1",
		"169.254.1.1",
		"0.0.0.0",
		"",
		"not-an-ip",
	} {
		code, name := Lookup(ip)
		if code != "" || name != "" {
			t.Errorf("Lookup(%q): expected empty result for local/private IP, got %q / %q", ip, code, name)
		}
	}
}

func TestCountryNameRU_Known(t *testing.T) {
	if got := CountryNameRU("ru"); got != "Россия" {
		t.Errorf("expected 'Россия' for lowercase ru, got %q", got)
	}
	if got := CountryNameRU("DE"); got != "Германия" {
		t.Errorf("expected 'Германия' for DE, got %q", got)
	}
}

func TestCountryNameRU_Unknown(t *testing.T) {
	if got := CountryNameRU("ZZ"); got != "" {
		t.Errorf("expected empty name for unknown code, got %q", got)
	}
	if got := CountryNameRU(""); got != "" {
		t.Errorf("expected empty name for empty code, got %q", got)
	}
}
