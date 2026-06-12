package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// GetCaptchaConfig returns mCaptcha public configuration for the frontend.
// GET /api/v1/auth/captcha-config
func (h *AuthHandler) GetCaptchaConfig(c *gin.Context) {
	if h.captchaHandler == nil {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"enabled":  false,
			"site_key": "",
		}))
		return
	}
	h.captchaHandler.GetConfig(c)
}

// GetCaptchaChallenge generates a new PoW challenge for the frontend.
// GET /api/v1/auth/captcha-challenge
func (h *AuthHandler) GetCaptchaChallenge(c *gin.Context) {
	if h.captchaHandler == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("CAPTCHA service not available"))
		return
	}
	h.captchaHandler.GetChallenge(c)
}
