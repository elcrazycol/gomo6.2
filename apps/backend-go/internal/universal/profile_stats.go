package universal

import "fmt"

// rowUserID coerces a result-map cell to the user id string it represents.
func rowUserID(v interface{}) string {
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
