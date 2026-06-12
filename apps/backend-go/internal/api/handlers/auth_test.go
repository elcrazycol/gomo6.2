package handlers

// Auth handler tests are split into:
//   auth_register_login_test.go — Register, Login
//   auth_2fa_test.go           — SetupTOTP, DisableTOTP, Get2FAStatus, Verify2FA, VerifyAndEnableTOTP
//   auth_password_test.go      — UpdatePassword, validatePassword
//   auth_session_test.go       — GetMe, Refresh, Logout
//
// Test helpers are in handler_test_helpers.go (setupAuthHandler, newPOSTContext, newGETContextWithClaims).
