package blockchain

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/sha3"
)

var (
	// Function selectors (first 4 bytes of keccak256 of function signature)
	selectorIsAvailable  = "0x" + fnSelector("isAvailable(string)")
	selectorMint         = "0x" + fnSelector("mint(string,address)")
	selectorNameOf       = "0x" + fnSelector("nameOf(uint256)")
	selectorTokenByName  = "0x" + fnSelector("tokenByName(string)")
	selectorGetNicknames = "0x" + fnSelector("getNicknames(address)")
	selectorBalanceOf    = "0x" + fnSelector("balanceOf(address)")
	selectorTokenOfOwner = "0x" + fnSelector("tokenOfOwnerByIndex(address,uint256)")

	selectorCreateWallet = "0x" + fnSelector("createWallet(address)")
	selectorGetWallet    = "0x" + fnSelector("getWallet(address)")

	selectorOwner = "0x" + fnSelector("owner()")
)

func fnSelector(sig string) string {
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte(sig))
	hash := h.Sum(nil)
	return hex.EncodeToString(hash[:4])
}

type ContractCaller struct {
	rpc *RPCClient
}

func NewContractCaller(rpcURL string) *ContractCaller {
	return &ContractCaller{rpc: NewRPCClient(rpcURL)}
}

func (c *ContractCaller) IsAvailable(registryAddr, name string) (bool, error) {
	data := encodeIsAvailable(name)
	result, err := c.rpc.CallContract(registryAddr, data)
	if err != nil {
		return false, fmt.Errorf("call isAvailable: %w", err)
	}
	return decodeBool(result), nil
}

func (c *ContractCaller) GetNameByToken(registryAddr string, tokenID *big.Int) (string, error) {
	data := encodeNameOf(tokenID)
	result, err := c.rpc.CallContract(registryAddr, data)
	if err != nil {
		return "", fmt.Errorf("call nameOf: %w", err)
	}
	return decodeString(result), nil
}

func (c *ContractCaller) GetTokenByName(registryAddr, name string) (*big.Int, error) {
	data := encodeTokenByName(name)
	result, err := c.rpc.CallContract(registryAddr, data)
	if err != nil {
		return nil, fmt.Errorf("call tokenByName: %w", err)
	}
	return decodeUint256(result), nil
}

func (c *ContractCaller) GetNicknames(registryAddr, owner string) ([]string, error) {
	data := encodeGetNicknames(owner)
	result, err := c.rpc.CallContract(registryAddr, data)
	if err != nil {
		return nil, fmt.Errorf("call getNicknames: %w", err)
	}
	return decodeStringArray(result), nil
}

func (c *ContractCaller) GetWalletAddress(factoryAddr, owner string) (string, error) {
	data := encodeGetWallet(owner)
	result, err := c.rpc.CallContract(factoryAddr, data)
	if err != nil {
		return "", fmt.Errorf("call getWallet: %w", err)
	}
	return decodeAddress(result), nil
}

func (c *ContractCaller) GetOwner(registryAddr string) (string, error) {
	result, err := c.rpc.CallContract(registryAddr, selectorOwner)
	if err != nil {
		return "", fmt.Errorf("call owner: %w", err)
	}
	return decodeAddress(result), nil
}

func encodeIsAvailable(name string) string {
	return selectorIsAvailable + encodeString(name)
}

func encodeNameOf(tokenID *big.Int) string {
	return selectorNameOf + encodeUint256(tokenID)
}

func encodeTokenByName(name string) string {
	return selectorTokenByName + encodeString(name)
}

func encodeGetNicknames(owner string) string {
	return selectorGetNicknames + encodeAddress(owner)
}

func encodeGetWallet(owner string) string {
	return selectorGetWallet + encodeAddress(owner)
}

func encodeMint(name, to string) string {
	return selectorMint + encodeString(name) + encodeAddress(to)
}

func encodeCreateWallet(owner string) string {
	return selectorCreateWallet + encodeAddress(owner)
}

func decodeBool(hex string) bool {
	return hex != "0x"+"0000000000000000000000000000000000000000000000000000000000000000"
}

func decodeString(hexStr string) string {
	if len(hexStr) < 130 {
		return ""
	}
	lengthHex := hexStr[66:130]
	length := new(big.Int)
	length.SetString(lengthHex, 16)
	intLen := int(length.Int64())

	if len(hexStr) < 130+intLen*2 {
		return ""
	}
	data := hexStr[130 : 130+intLen*2]

	result := make([]byte, intLen)
	for i := 0; i < intLen; i++ {
		fmt.Sscanf(data[i*2:i*2+2], "%x", &result[i])
	}
	return string(result)
}

func decodeUint256(hexStr string) *big.Int {
	if len(hexStr) < 66 {
		return big.NewInt(0)
	}
	val := new(big.Int)
	val.SetString(hexStr[2:], 16)
	return val
}

func decodeAddress(hexStr string) string {
	if len(hexStr) < 66 {
		return ""
	}
	return "0x" + hexStr[26:66]
}

func decodeStringArray(hexStr string) []string {
	if len(hexStr) < 130 {
		return nil
	}
	lengthHex := hexStr[66:130]
	length := new(big.Int)
	length.SetString(lengthHex, 16)
	intLen := int(length.Int64())

	result := make([]string, 0, intLen)
	pos := 130
	for i := 0; i < intLen; i++ {
		if pos+64 > len(hexStr) {
			break
		}
		itemOffset := new(big.Int)
		itemOffset.SetString(hexStr[pos:pos+64], 16)
		pos += 64

		itemLenPos := 130 + int(itemOffset.Int64())*2
		if itemLenPos+64 > len(hexStr) {
			break
		}
		itemLen := new(big.Int)
		itemLen.SetString(hexStr[itemLenPos:itemLenPos+64], 16)
		intItemLen := int(itemLen.Int64())

		itemDataPos := itemLenPos + 64
		if itemDataPos+intItemLen*2 > len(hexStr) {
			break
		}
		itemData := hexStr[itemDataPos : itemDataPos+intItemLen*2]

		itemBytes := make([]byte, intItemLen)
		for j := 0; j < intItemLen; j++ {
			fmt.Sscanf(itemData[j*2:j*2+2], "%x", &itemBytes[j])
		}
		result = append(result, string(itemBytes))
	}

	return result
}

func encodeString(s string) string {
	data := []byte(s)
	paddedData := padRight(data, ((len(data)+31)/32)*32)

	offset := big.NewInt(32)
	length := big.NewInt(int64(len(data)))

	return encodeUint256(offset) + encodeUint256(length) + hex.EncodeToString(paddedData)
}

func encodeAddress(addr string) string {
	addrBytes := commonHexToBytes(addr)
	padded := make([]byte, 32)
	copy(padded[12:], addrBytes)
	return hex.EncodeToString(padded)
}

func encodeUint256(v *big.Int) string {
	b := v.Bytes()
	padded := make([]byte, 32)
	copy(padded[32-len(b):], b)
	return hex.EncodeToString(padded)
}

func padRight(data []byte, length int) []byte {
	if len(data) >= length {
		return data[:length]
	}
	padded := make([]byte, length)
	copy(padded, data)
	return padded
}

func commonHexToBytes(hexStr string) []byte {
	hexStr = strings.TrimPrefix(hexStr, "0x")
	if len(hexStr)%2 != 0 {
		hexStr = "0" + hexStr
	}
	result := make([]byte, len(hexStr)/2)
	for i := 0; i < len(result); i++ {
		fmt.Sscanf(hexStr[i*2:i*2+2], "%x", &result[i])
	}
	return result
}
