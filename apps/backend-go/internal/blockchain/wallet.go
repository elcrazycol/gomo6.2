package blockchain

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"

	"golang.org/x/crypto/sha3"
)

const (
	BaseMainnetChainID = 8453
	BaseSepoliaChainID = 84532
)

type Config struct {
	RPCURL            string
	ChainID           int64
	RegistryAddress   string
	WalletFactoryAddr string
	RelayerKey        *ecdsa.PrivateKey
}

func LoadConfig() *Config {
	rpcURL := os.Getenv("BASE_RPC_URL")
	if rpcURL == "" {
		rpcURL = "https://sepolia.base.org"
	}

	chainID := int64(BaseSepoliaChainID)
	if os.Getenv("BASE_CHAIN_ID") != "" {
		chainID = int64(0)
		fmt.Sscanf(os.Getenv("BASE_CHAIN_ID"), "%d", &chainID)
	} else if os.Getenv("BASE_RPC_URL") != "" {
		if contains(os.Getenv("BASE_RPC_URL"), "mainnet") {
			chainID = BaseMainnetChainID
		}
	}

	return &Config{
		RPCURL:            rpcURL,
		ChainID:           chainID,
		RegistryAddress:   os.Getenv("NICKNAME_REGISTRY_ADDRESS"),
		WalletFactoryAddr: os.Getenv("WALLET_FACTORY_ADDRESS"),
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func GenerateWalletFromUserID(userID string, salt []byte) (*ecdsa.PrivateKey, string, error) {
	seed := sha256.Sum256(append([]byte(userID), salt...))
	curve := elliptic.P256()
	privateKey, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		return nil, "", fmt.Errorf("generate key: %w", err)
	}

	d := new(big.Int).SetBytes(seed[:])
	d = d.Mod(d, curve.Params().N)
	privateKey.D = d
	privateKey.PublicKey.X, privateKey.PublicKey.Y = curve.ScalarBaseMult(d.Bytes())

	pubBytes := elliptic.Marshal(curve, privateKey.PublicKey.X, privateKey.PublicKey.Y)
	hash := sha3.NewLegacyKeccak256()
	hash.Write(pubBytes[1:])
	address := "0x" + hex.EncodeToString(hash.Sum(nil)[12:])

	return privateKey, address, nil
}
