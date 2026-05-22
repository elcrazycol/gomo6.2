package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Domain   string `json:"domain"`
	jwt.RegisteredClaims
}

type AuthService struct {
	jwtSecret []byte
}

func NewAuthService() *AuthService {
	return &AuthService{
		jwtSecret: []byte(GetJWTSecret()),
	}
}

// GetJWTSecret returns the JWT secret from env or generates a secure random one.
// In production, always set JWT_SECRET explicitly to keep tokens valid across restarts.
func GetJWTSecret() string {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		if len(secret) < 32 {
			log.Printf("WARNING: JWT_SECRET is too short (%d bytes). Use at least 32 bytes (64 hex chars) for production.", len(secret))
		}
		return secret
	}

	// Auto-generate a secure random key
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("FATAL: Failed to generate random JWT secret: %v", err)
	}
	secret := hex.EncodeToString(b)
	log.Printf("WARNING: JWT_SECRET not set. Generated random key. All tokens will be invalidated on next restart.")
	log.Printf("WARNING: Set JWT_SECRET environment variable to a fixed value for production (e.g.: %s)", secret)
	return secret
}

func (a *AuthService) GenerateToken(userID, username, domain string) (string, error) {
	claims := Claims{
		UserID:   userID,
		Username: username,
		Domain:   domain,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

func (a *AuthService) GeneratePartialToken(userID, username, domain string) (string, error) {
	claims := Claims{
		UserID:   userID,
		Username: username,
		Domain:   domain,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

func (a *AuthService) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return a.jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}
