// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract GomoWallet {
    address public owner;
    bool private _initialized;

    error NotOwner();
    error NotEntryPoint();
    error ExecutionFailed();
    error AlreadyInitialized();

    event TransactionExecuted(address indexed to, uint256 value, bytes data, bool success);
    event WalletInitialized(address indexed owner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    receive() external payable {}

    function initialize(address _owner) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        owner = _owner;
        emit WalletInitialized(_owner);
    }

    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external onlyOwner returns (bool success) {
        (success, ) = dest.call{value: value}(func);
        if (!success) revert ExecutionFailed();
        emit TransactionExecuted(dest, value, func, success);
    }

    function executeBatch(
        address[] calldata dests,
        uint256[] calldata values,
        bytes[] calldata funcs
    ) external onlyOwner returns (bool[] memory successes) {
        require(dests.length == values.length && values.length == funcs.length, "Length mismatch");
        successes = new bool[](dests.length);
        for (uint256 i = 0; i < dests.length; i++) {
            (successes[i], ) = dests[i].call{value: values[i]}(funcs[i]);
            if (!successes[i]) revert ExecutionFailed();
            emit TransactionExecuted(dests[i], values[i], funcs[i], successes[i]);
        }
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}
