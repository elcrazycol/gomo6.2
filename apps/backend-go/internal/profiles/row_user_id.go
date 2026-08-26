package profiles

import "fmt"

// RowUserID coerces a generic CRUD result-map cell to the user id string it
// represents. Result maps are built from database scans, so the same column
// can arrive as a string, a []byte (text columns via the pq driver) or a
// driver-native type — this makes the promoted type explicit at use sites.
func RowUserID(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return fmt.Sprint(t)
	}
}
