package blockchain

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var validNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type Nickname struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	Nickname        string    `json:"nickname"`
	TokenID         string    `json:"token_id"`
	ContractAddress string    `json:"contract_address"`
	IsPrimary       bool      `json:"is_primary"`
	CreatedAt       time.Time `json:"created_at"`
}

type NicknameManager struct {
	db     *sql.DB
	config *Config
	caller *ContractCaller
}

func NewNicknameManager(db *sql.DB, config *Config) *NicknameManager {
	return &NicknameManager{
		db:     db,
		config: config,
		caller: NewContractCaller(config.RPCURL),
	}
}

// NormalizeNickname forces lowercase and trims whitespace
func NormalizeNickname(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// ValidateNickname checks if a nickname is valid format
func (m *NicknameManager) ValidateNickname(name string) error {
	normalized := NormalizeNickname(name)
	if len(normalized) < 3 {
		return fmt.Errorf("nicknames must be at least 3 characters")
	}
	if len(normalized) > 32 {
		return fmt.Errorf("nicknames must be at most 32 characters")
	}
	if !validNameRegex.MatchString(normalized) {
		return fmt.Errorf("nicknames can only contain letters, numbers, hyphens, and underscores")
	}
	return nil
}

// CheckAvailability checks if a nickname is available (DB + on-chain)
func (m *NicknameManager) CheckAvailability(name string) (bool, []string, error) {
	normalized := NormalizeNickname(name)
	if err := m.ValidateNickname(normalized); err != nil {
		return false, nil, err
	}

	// Check DB
	var exists bool
	err := m.db.QueryRow("SELECT EXISTS(SELECT 1 FROM user_nicknames WHERE nickname = $1)", normalized).Scan(&exists)
	if err != nil {
		return false, nil, fmt.Errorf("check db: %w", err)
	}
	if exists {
		suggestions := m.generateSuggestions(normalized)
		return false, suggestions, nil
	}

	// Check on-chain if registry is configured
	if m.config.RegistryAddress != "" {
		available, err := m.caller.IsAvailable(m.config.RegistryAddress, normalized)
		if err != nil {
			// On-chain check failed, rely on DB only
			return true, nil, nil
		}
		if !available {
			suggestions := m.generateSuggestions(normalized)
			return false, suggestions, nil
		}
	}

	return true, nil, nil
}

// RegisterNickname registers a new nickname for a user
func (m *NicknameManager) RegisterNickname(userID, name string, walletAddress string) (*Nickname, error) {
	normalized := NormalizeNickname(name)
	if err := m.ValidateNickname(normalized); err != nil {
		return nil, err
	}

	// Check availability
	available, _, err := m.CheckAvailability(normalized)
	if err != nil {
		return nil, err
	}
	if !available {
		return nil, fmt.Errorf("nickname '%s' is already taken", normalized)
	}

	// Check if user already has a wallet
	var existingWallet string
	err = m.db.QueryRow("SELECT wallet_address FROM user_wallets WHERE user_id = $1", userID).Scan(&existingWallet)
	if err == sql.ErrNoRows {
		// Create wallet record
		_, err = m.db.Exec(
			`INSERT INTO user_wallets (user_id, wallet_address, chain_id) VALUES ($1, $2, $3)`,
			userID, walletAddress, m.config.ChainID,
		)
		if err != nil {
			return nil, fmt.Errorf("create wallet: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("check wallet: %w", err)
	} else {
		walletAddress = existingWallet
	}

	// Generate token ID (deterministic from name + chain)
	tokenID := m.generateTokenID(normalized)

	// Insert nickname
	contractAddr := m.config.RegistryAddress
	_, err = m.db.Exec(
		`INSERT INTO user_nicknames (user_id, nickname, token_id, contract_address, is_primary)
		 VALUES ($1, $2, $3, $4, (SELECT COUNT(*) FROM user_nicknames WHERE user_id = $1) = 0)`,
		userID, normalized, tokenID, contractAddr,
	)
	if err != nil {
		return nil, fmt.Errorf("insert nickname: %w", err)
	}

	// Set as primary if first nickname
	var count int
	m.db.QueryRow("SELECT COUNT(*) FROM user_nicknames WHERE user_id = $1", userID).Scan(&count)
	if count == 1 {
		m.db.Exec("UPDATE user_nicknames SET is_primary = TRUE WHERE user_id = $1 AND nickname = $2", userID, normalized)
	}

	return &Nickname{
		UserID:          userID,
		Nickname:        normalized,
		TokenID:         tokenID,
		ContractAddress: contractAddr,
		IsPrimary:       count == 1,
		CreatedAt:       time.Now(),
	}, nil
}

// GetUserNicknames returns all nicknames for a user
func (m *NicknameManager) GetUserNicknames(userID string) ([]Nickname, error) {
	rows, err := m.db.Query(
		`SELECT id, user_id, nickname, token_id, contract_address, is_primary, created_at
		 FROM user_nicknames WHERE user_id = $1 ORDER BY is_primary DESC, created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query nicknames: %w", err)
	}
	defer rows.Close()

	var nicknames []Nickname
	for rows.Next() {
		var n Nickname
		err := rows.Scan(&n.ID, &n.UserID, &n.Nickname, &n.TokenID, &n.ContractAddress, &n.IsPrimary, &n.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan nickname: %w", err)
		}
		nicknames = append(nicknames, n)
	}

	return nicknames, nil
}

// SetPrimaryNickname sets a nickname as primary
func (m *NicknameManager) SetPrimaryNickname(userID, name string) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec("UPDATE user_nicknames SET is_primary = FALSE WHERE user_id = $1", userID)
	if err != nil {
		return err
	}

	result, err := tx.Exec(
		"UPDATE user_nicknames SET is_primary = TRUE WHERE user_id = $1 AND nickname = $2",
		userID, name,
	)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("nickname not found")
	}

	return tx.Commit()
}

// GetPrimaryNickname returns the primary nickname for a user
func (m *NicknameManager) GetPrimaryNickname(userID string) (string, error) {
	var name string
	err := m.db.QueryRow(
		"SELECT nickname FROM user_nicknames WHERE user_id = $1 AND is_primary = TRUE",
		userID,
	).Scan(&name)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return name, nil
}

// GetWalletAddress returns the wallet address for a user
func (m *NicknameManager) GetWalletAddress(userID string) (string, error) {
	var addr string
	err := m.db.QueryRow("SELECT wallet_address FROM user_wallets WHERE user_id = $1", userID).Scan(&addr)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return addr, nil
}

// GenerateWalletAddress creates a deterministic wallet address for a user
func (m *NicknameManager) GenerateWalletAddress(userID string) string {
	salt := []byte("gomo6-nickname-registry")
	h := sha256.New()
	h.Write([]byte(userID))
	h.Write(salt)
	hash := h.Sum(nil)
	return "0x" + hex.EncodeToString(hash[12:32])
}

func (m *NicknameManager) generateTokenID(name string) string {
	h := sha256.New()
	h.Write([]byte(name))
	h.Write([]byte(fmt.Sprintf("%d", m.config.ChainID)))
	return "0x" + hex.EncodeToString(h.Sum(nil))
}

func (m *NicknameManager) generateSuggestions(name string) []string {
	suggestions := make([]string, 0)
	suffixes := []string{"_", "x", "0", "1", "2"}
	for _, suffix := range suffixes {
		candidate := name + suffix
		if len(candidate) <= 32 {
			suggestions = append(suggestions, candidate)
		}
	}
	numSuffixes := []string{"420", "69", "007", "1337"}
	for _, suffix := range numSuffixes {
		candidate := name + suffix
		if len(candidate) <= 32 {
			suggestions = append(suggestions, candidate)
		}
	}
	return suggestions
}

// RecordTransfer records a nickname transfer in the database
func (m *NicknameManager) RecordTransfer(nickname, fromUserID, toUserID, fromAddr, toAddr, txHash string) error {
	_, err := m.db.Exec(
		`INSERT INTO nickname_transfers (nickname, from_user_id, to_user_id, from_address, to_address, tx_hash)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		nickname, fromUserID, toUserID, fromAddr, toAddr, txHash,
	)
	return err
}

// TransferNickname handles transferring a nickname to another user
func (m *NicknameManager) TransferNickname(fromUserID, toUserID, name string) error {
	// Verify ownership
	err := m.db.QueryRow(
		`SELECT n.nickname FROM user_nicknames n
		 JOIN user_wallets w ON w.user_id = n.user_id
		 WHERE n.user_id = $1 AND n.nickname = $2`,
		fromUserID, name,
	).Scan(&name)
	if err != nil {
		return fmt.Errorf("not the owner of this nickname")
	}

	// Get recipient's wallet address
	_, err = m.GetWalletAddress(toUserID)
	if err != nil {
		return fmt.Errorf("recipient has no wallet")
	}

	// In production, this would submit an on-chain transaction
	// For now, update the database
	_, err = m.db.Exec(
		`UPDATE user_nicknames SET user_id = $1 WHERE user_id = $2 AND nickname = $3`,
		toUserID, fromUserID, name,
	)
	if err != nil {
		return fmt.Errorf("transfer nickname: %w", err)
	}

	return nil
}

// GetNicknameInfo returns full info about a nickname
func (m *NicknameManager) GetNicknameInfo(name string) (map[string]interface{}, error) {
	var nickname, tokenID, contractAddr, walletAddr string
	var isPrimary bool
	var createdAt time.Time

	err := m.db.QueryRow(
		`SELECT n.nickname, n.token_id, n.contract_address, n.is_primary, n.created_at, w.wallet_address
		 FROM user_nicknames n
		 JOIN user_wallets w ON w.user_id = n.user_id
		 WHERE n.nickname = $1`,
		name,
	).Scan(&nickname, &tokenID, &contractAddr, &isPrimary, &createdAt, &walletAddr)
	if err != nil {
		return nil, fmt.Errorf("nickname not found: %w", err)
	}

	return map[string]interface{}{
		"nickname":         nickname,
		"token_id":         tokenID,
		"contract_address": contractAddr,
		"is_primary":       isPrimary,
		"created_at":       createdAt,
		"wallet_address":   walletAddr,
		"basescan_url":     fmt.Sprintf("https://basescan.org/token/%s?a=%s", contractAddr, walletAddr),
	}, nil
}
