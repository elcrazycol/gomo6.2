// Package publicid parses the human-readable public numbers («цифорки») that
// appear in URLs next to UUIDs.
//
// A route parameter accepts BOTH forms so already-shared UUID links keep working
// forever: a digits-only value is a public_id, a UUID is a UUID. Handlers use
// ParseParam to pick the right column, and treat a non-zero OK=false as "no such
// thing" instead of letting PostgreSQL raise an invalid-uuid syntax error (which
// used to surface as a 500 on garbage input).
//
// The package is deliberately dependency-light: only the API handlers and the
// social-preview path resolver use it, and both may treat it as a leaf.
package publicid

import (
	"strconv"

	"github.com/google/uuid"
)

// Param is a resolved route parameter: which column to compare and with what.
type Param struct {
	// Column is the column to filter on — "public_id" for a numeric parameter,
	// "id" for a UUID.
	Column string
	// Value is an int64 for a numeric parameter, a string (UUID) otherwise.
	Value any
	// OK is false when the raw parameter is neither a public_id nor a UUID.
	OK bool
}

// ParseParam resolves a raw route parameter into the column/value pair a read
// query should use.
//
// A public_id is ASCII digits with no leading zero (public ids are allocated
// from a sequence starting at 1, so "0123" can only be a typo — it is rejected
// rather than silently treated as 123, which would make two different URLs
// resolve to the same row).
//
// Anything else is passed through as the legacy id lookup: /profiles/:id never
// validated its parameter, and rejecting a malformed value here would change
// that contract. Endpoints that do validate (see ParseParamStrict) use it
// explicitly.
func ParseParam(raw string) Param {
	if n, ok := Parse(raw); ok {
		return Param{Column: "public_id", Value: n, OK: true}
	}
	if raw == "" {
		return Param{}
	}
	return Param{Column: "id", Value: raw, OK: true}
}

// ParseParamStrict is ParseParam plus a UUID-shape check: a value that is
// neither a public_id nor a UUID is reported as not OK, so the caller can answer
// 400/404 instead of handing garbage to PostgreSQL — which raises an
// invalid-uuid cast error and surfaces as a 500. Used by /threads/:id, whose
// contract is a 400 for a malformed id.
func ParseParamStrict(raw string) Param {
	p := ParseParam(raw)
	if !p.OK || p.Column != "id" {
		return p
	}
	if _, err := uuid.Parse(p.Value.(string)); err != nil {
		return Param{}
	}
	return p
}

// Parse reports whether raw is a public_id and returns its value.
//
// Public ids are strictly positive decimals: the sequences allocate from 1 up, and
// negative values are reserved as sentinels for service rows (see
// SeedDevDashboardApp), so "-1" and "0" are not numbers a URL can address.
func Parse(raw string) (int64, bool) {
	if raw == "" || len(raw) > 18 {
		return 0, false
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] < '0' || raw[i] > '9' {
			return 0, false
		}
	}
	// No leading zeros: "0" and "0123" are not public ids.
	if raw[0] == '0' {
		return 0, false
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// IsServiceSentinel reports whether a stored public_id is NOT an addressable
// number: negatives mark service rows (SeedDevDashboardApp) and zero is never
// allocated. Callers that build links must fall back to the UUID for such a row.
func IsServiceSentinel(publicID int64) bool { return publicID <= 0 }

// IsNumber reports whether raw looks like a public_id. Convenience for callers
// that only need the shape (e.g. deciding on a URL form in tests).
func IsNumber(raw string) bool {
	_, ok := Parse(raw)
	return ok
}

// Normalize returns the canonical URL parameter for a row: its public_id when
// present, otherwise the UUID. Used by server-side link building so a missing
// public_id degrades to the legacy UUID link instead of an empty one.
func Normalize(publicID *int64, uuid string) string {
	if publicID != nil && !IsServiceSentinel(*publicID) {
		return strconv.FormatInt(*publicID, 10)
	}
	return uuid
}
