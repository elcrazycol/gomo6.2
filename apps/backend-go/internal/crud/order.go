package crud

import (
	"strings"
	"unicode"
)

// ParseOrderClause turns PostgREST-style "col.asc,col2.desc" into safe SQL ORDER BY fragments.
// Raw "unlocked_at.desc" is invalid in PostgreSQL (parsed as schema.table).
func ParseOrderClause(orderExpr string, tableAlias string) (string, bool) {
	orderExpr = strings.TrimSpace(orderExpr)
	if orderExpr == "" {
		return "", false
	}
	var b strings.Builder
	first := true
	for _, segment := range strings.Split(orderExpr, ",") {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}
		col, dir, ok := ParseSingleOrderSegment(segment)
		if !ok || !IsSafeSQLIdentifier(col) {
			continue
		}
		if !first {
			b.WriteString(", ")
		}
		first = false
		if tableAlias != "" {
			b.WriteString(QuoteSQLIdent(tableAlias))
			b.WriteString(".")
		}
		b.WriteString(QuoteSQLIdent(col))
		b.WriteString(" ")
		b.WriteString(dir)
	}
	if b.Len() == 0 {
		return "", false
	}
	return b.String(), true
}

func ParseSingleOrderSegment(segment string) (col string, dir string, ok bool) {
	lastDot := strings.LastIndex(segment, ".")
	if lastDot <= 0 || lastDot >= len(segment)-1 {
		return "", "", false
	}
	col = strings.TrimSpace(segment[:lastDot])
	d := strings.ToLower(strings.TrimSpace(segment[lastDot+1:]))
	switch d {
	case "asc":
		return col, "ASC", true
	case "desc":
		return col, "DESC", true
	default:
		return "", "", false
	}
}

func IsSafeSQLIdentifier(s string) bool {
	if len(s) == 0 || len(s) > 63 {
		return false
	}
	for i, r := range s {
		if i == 0 {
			if !unicode.IsLetter(r) && r != '_' {
				return false
			}
		} else {
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
				return false
			}
		}
	}
	return true
}

func QuoteSQLIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}
