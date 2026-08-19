package models

// ErrorCode is a stable, language-neutral identifier for a user-facing API
// error. The frontend maps these codes to localized messages (i18next); the
// legacy `Error` field of the response keeps a short English fallback for logs
// and clients that do not understand codes yet.
type ErrorCode string

const (
	ErrUsernameLength     ErrorCode = "username_length"
	ErrUsernameChars      ErrorCode = "username_chars"
	ErrUsernameTaken      ErrorCode = "username_taken"
	ErrInvalidCredentials ErrorCode = "invalid_credentials"
	ErrWrongPassword      ErrorCode = "wrong_password"
	ErrInvalid2FACode     ErrorCode = "invalid_2fa_code"
	ErrPostEmpty          ErrorCode = "post_empty"
	ErrSlugFormat         ErrorCode = "slug_format"
	ErrSlugReserved       ErrorCode = "slug_reserved"
	ErrSlugTaken          ErrorCode = "slug_taken"
	ErrEmojiFormat        ErrorCode = "emoji_format"
	ErrEmojiUnavailable   ErrorCode = "emoji_unavailable"
	ErrVideoProcessing    ErrorCode = "video_processing"
)

// ErrorResponseWithCode builds a structured error response carrying a stable
// `code` plus optional interpolation `params` (rendered client-side). `fallback`
// is the short English message kept in the legacy `error` field.
func ErrorResponseWithCode(code ErrorCode, fallback string, params interface{}) APIResponse {
	c := string(code)
	return APIResponse{Success: false, Error: &fallback, Code: &c, Params: params}
}
