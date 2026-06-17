package blockchain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
)

type RPCClient struct {
	url    string
	client *http.Client
}

type jsonRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
	ID      int         `json:"id"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *jsonRPCError   `json:"error"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func NewRPCClient(url string) *RPCClient {
	return &RPCClient{
		url:    url,
		client: &http.Client{},
	}
}

func (c *RPCClient) call(method string, params interface{}) (json.RawMessage, error) {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      1,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := c.client.Post(c.url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("rpc call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var rpcResp jsonRPCResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if rpcResp.Error != nil {
		return nil, fmt.Errorf("rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	return rpcResp.Result, nil
}

func (c *RPCClient) GetBalance(address string) (*big.Int, error) {
	result, err := c.call("eth_getBalance", []interface{}{address, "latest"})
	if err != nil {
		return nil, err
	}

	var hexBalance string
	if err := json.Unmarshal(result, &hexBalance); err != nil {
		return nil, fmt.Errorf("unmarshal balance: %w", err)
	}

	balance := new(big.Int)
	balance.SetString(hexBalance[2:], 16)
	return balance, nil
}

func (c *RPCClient) GetBlockNumber() (uint64, error) {
	result, err := c.call("eth_blockNumber", []interface{}{})
	if err != nil {
		return 0, err
	}

	var hexNumber string
	if err := json.Unmarshal(result, &hexNumber); err != nil {
		return 0, fmt.Errorf("unmarshal block number: %w", err)
	}

	num, err := strconv.ParseUint(hexNumber[2:], 16, 64)
	if err != nil {
		return 0, fmt.Errorf("parse block number: %w", err)
	}

	return num, nil
}

func (c *RPCClient) GetTransactionReceipt(txHash string) (map[string]interface{}, error) {
	result, err := c.call("eth_getTransactionReceipt", []interface{}{txHash})
	if err != nil {
		return nil, err
	}

	var receipt map[string]interface{}
	if err := json.Unmarshal(result, &receipt); err != nil {
		return nil, fmt.Errorf("unmarshal receipt: %w", err)
	}

	return receipt, nil
}

func (c *RPCClient) SendRawTransaction(signedData string) (string, error) {
	result, err := c.call("eth_sendRawTransaction", []interface{}{signedData})
	if err != nil {
		return "", err
	}

	var txHash string
	if err := json.Unmarshal(result, &txHash); err != nil {
		return "", fmt.Errorf("unmarshal tx hash: %w", err)
	}

	return txHash, nil
}

func (c *RPCClient) CallContract(to, data string) (string, error) {
	msg := map[string]string{
		"to":   to,
		"data": data,
	}
	result, err := c.call("eth_call", []interface{}{msg, "latest"})
	if err != nil {
		return "", err
	}

	var hexResult string
	if err := json.Unmarshal(result, &hexResult); err != nil {
		return "", fmt.Errorf("unmarshal call result: %w", err)
	}

	return hexResult, nil
}
