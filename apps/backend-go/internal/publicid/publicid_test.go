package publicid

import "testing"

func TestParse(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want int64
		ok   bool
	}{
		{"base of the user line", "10", 10, true},
		{"base of the thread line", "100", 100, true},
		{"single digit", "7", 7, true},
		{"large id", "9007199254740993", 9007199254740993, true},
		{"empty", "", 0, false},
		{"zero is not a public id", "0", 0, false},
		{"leading zero is rejected, not normalized", "0123", 0, false},
		{"uuid is not a number", "20d1f4de-8094-44af-ac52-56247311b7d8", 0, false},
		{"signed", "-5", 0, false},
		{"decimal", "1.5", 0, false},
		{"whitespace", " 10", 0, false},
		{"too long for bigint", "99999999999999999999", 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := Parse(tc.raw)
			if ok != tc.ok || (ok && got != tc.want) {
				t.Errorf("Parse(%q) = (%d, %v), want (%d, %v)", tc.raw, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestParseParam(t *testing.T) {
	t.Run("numeric resolves to public_id", func(t *testing.T) {
		p := ParseParam("1337")
		if !p.OK || p.Column != "public_id" {
			t.Fatalf("ParseParam(1337) = %+v, want public_id column", p)
		}
		if n, isInt := p.Value.(int64); !isInt || n != 1337 {
			t.Errorf("value = %#v, want int64(1337)", p.Value)
		}
	})

	t.Run("uuid resolves to id", func(t *testing.T) {
		const u = "20d1f4de-8094-44af-ac52-56247311b7d8"
		p := ParseParam(u)
		if !p.OK || p.Column != "id" {
			t.Fatalf("ParseParam(uuid) = %+v, want id column", p)
		}
		if s, isStr := p.Value.(string); !isStr || s != u {
			t.Errorf("value = %#v, want the uuid string", p.Value)
		}
	})

	t.Run("garbage falls through to the legacy id lookup", func(t *testing.T) {
		// /profiles/:id never validated its parameter; ParseParam must keep
		// passing it through so the existing contract is unchanged.
		for _, raw := range []string{"u1", "unknown", "20d1f4de-8094-44af-ac52"} {
			p := ParseParam(raw)
			if !p.OK || p.Column != "id" || p.Value != raw {
				t.Errorf("ParseParam(%q) = %+v, want the legacy id passthrough", raw, p)
			}
		}
	})

	t.Run("empty is not ok", func(t *testing.T) {
		if p := ParseParam(""); p.OK {
			t.Errorf("ParseParam(\"\") = %+v, want not OK", p)
		}
	})
}

func TestParseParamStrict(t *testing.T) {
	t.Run("numeric resolves to public_id", func(t *testing.T) {
		p := ParseParamStrict("315")
		if !p.OK || p.Column != "public_id" {
			t.Fatalf("ParseParamStrict(315) = %+v, want public_id column", p)
		}
	})

	t.Run("uuid resolves to id", func(t *testing.T) {
		const u = "20d1f4de-8094-44af-ac52-56247311b7d8"
		p := ParseParamStrict(u)
		if !p.OK || p.Column != "id" || p.Value != u {
			t.Fatalf("ParseParamStrict(uuid) = %+v, want id column", p)
		}
	})

	t.Run("garbage is not ok", func(t *testing.T) {
		// /threads/:id answers 400 for a malformed id, so a value that is
		// neither a number nor a UUID must be reported instead of being handed
		// to PostgreSQL (which would 500 on the uuid cast).
		for _, raw := range []string{"", "not-a-uuid", "u1", "0123", "12x", "20d1f4de-8094-44af-ac52"} {
			if p := ParseParamStrict(raw); p.OK {
				t.Errorf("ParseParamStrict(%q) = %+v, want not OK", raw, p)
			}
		}
	})
}

func TestNormalize(t *testing.T) {
	n := int64(42)
	if got := Normalize(&n, "uuid-here"); got != "42" {
		t.Errorf("Normalize with public_id = %q, want 42", got)
	}
	if got := Normalize(nil, "uuid-here"); got != "uuid-here" {
		t.Errorf("Normalize without public_id = %q, want the UUID fallback", got)
	}
}

// Service rows carry a negative sentinel instead of a human number: it must never
// be rendered as a link parameter.
func TestNormalize_ServiceSentinel(t *testing.T) {
	for _, sentinel := range []int64{-1, 0, -100} {
		if !IsServiceSentinel(sentinel) {
			t.Errorf("IsServiceSentinel(%d) = false, want true", sentinel)
		}
		v := sentinel
		if got := Normalize(&v, "uuid-here"); got != "uuid-here" {
			t.Errorf("Normalize(%d) = %q, want the UUID fallback", sentinel, got)
		}
	}
	if IsServiceSentinel(42) {
		t.Error("a positive number is not a service sentinel")
	}
}
