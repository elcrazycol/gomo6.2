// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./GomoWallet.sol";

contract GomoWallet is GomoWallet {}

contract GomoWalletFactory {
    mapping(address => address) public wallets;

    event WalletCreated(address indexed owner, address wallet);

    function getWallet(address owner) external view returns (address) {
        return wallets[owner];
    }

    function createWallet(address owner) external returns (address) {
        require(wallets[owner] == address(0), "Wallet already exists");

        GomoWallet wallet = new GomoWallet();
        wallet.initialize(owner);

        wallets[owner] = address(wallet);

        emit WalletCreated(owner, address(wallet));
        return address(wallet);
    }
}
