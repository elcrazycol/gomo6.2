package crud

import (
	"fmt"
	"strconv"
	"strings"
)

// JoinStrings joins strs with sep, skipping the separator for an empty slice.
func JoinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}

// IsValidColumnName reports whether name is a safe SQL identifier: 1-63 chars,
// starting with a letter or underscore, then letters/digits/underscores only.
func IsValidColumnName(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}
	for i, c := range name {
		if i == 0 {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') {
				return false
			}
		} else {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
				return false
			}
		}
	}
	return true
}

// ValidateBodyColumnNames rejects any JSON body key that is not a safe SQL
// identifier (CWE-89, C1 regression guard). The generic write handlers
// interpolate body keys directly into INSERT column lists and UPDATE SET
// clauses, so an unvalidated key could smuggle arbitrary SQL into the
// statement (e.g. `accepted_at = (SELECT password_hash FROM users), updated_at`
// produced a working expression because the trailing ` = $N` absorbed the
// bind parameter). Values are parameterized, but the identifier itself must
// still be constrained: a valid column name can never contain SQL syntax, so
// enforcing the same shape as IsValidColumnName is sufficient.
func ValidateBodyColumnNames(data map[string]interface{}) error {
	for key := range data {
		if !IsValidColumnName(key) {
			return fmt.Errorf("invalid column name %q in request body", key)
		}
	}
	return nil
}

// BuildFilterClause turns a PostgREST-style filter value into a SQL fragment.
// A plain value yields equality; "op.value" dispatches to BuildFilterFromParts.
func BuildFilterClause(column, rawValue string, argIndex int) (string, []interface{}, int) {
	parts := strings.SplitN(rawValue, ".", 2)
	if len(parts) != 2 {
		// Backward compatibility: plain equality
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{rawValue}, argIndex + 1
	}
	return BuildFilterFromParts(column, parts[0], parts[1], argIndex)
}

// BuildFilterFromParts renders a single filter operator (eq/neq/gt/gte/lt/lte/
// ilike/is/in/not) with bind parameters starting at argIndex.
func BuildFilterFromParts(column, op, value string, argIndex int) (string, []interface{}, int) {
	switch op {
	case "eq":
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "neq":
		return column + " <> $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "gt":
		return column + " > $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "gte":
		return column + " >= $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "lt":
		return column + " < $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "lte":
		return column + " <= $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "ilike":
		return column + " ILIKE $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "is":
		if value == "null" {
			return column + " IS NULL", nil, argIndex
		}
		if value == "true" {
			return column + " IS TRUE", nil, argIndex
		}
		if value == "false" {
			return column + " IS FALSE", nil, argIndex
		}
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "in":
		trimmed := strings.TrimPrefix(value, "(")
		trimmed = strings.TrimSuffix(trimmed, ")")
		items := SplitCSV(trimmed)
		if len(items) == 0 {
			return "", nil, argIndex
		}
		placeholders := make([]string, 0, len(items))
		args := make([]interface{}, 0, len(items))
		for _, item := range items {
			placeholders = append(placeholders, "$"+strconv.Itoa(argIndex))
			args = append(args, item)
			argIndex++
		}
		return column + " IN (" + strings.Join(placeholders, ", ") + ")", args, argIndex
	case "not":
		sub := strings.SplitN(value, ".", 2)
		if len(sub) != 2 {
			return "", nil, argIndex
		}
		clause, args, next := BuildFilterFromParts(column, sub[0], sub[1], argIndex)
		if clause == "" {
			return "", nil, argIndex
		}
		return "NOT (" + clause + ")", args, next
	default:
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	}
}

// ParseOrCondition splits "column.op.value" into its three parts, validating
// the column name.
func ParseOrCondition(condition string) (column, op, value string, ok bool) {
	parts := strings.SplitN(condition, ".", 3)
	if len(parts) != 3 {
		return "", "", "", false
	}
	if !IsValidColumnName(parts[0]) {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

// SplitCSV splits a comma-separated string, trimming whitespace and dropping
// empty entries. Returns nil for an empty input.
func SplitCSV(input string) []string {
	if input == "" {
		return nil
	}
	parts := strings.Split(input, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}
