// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract NicknameRegistry is ERC721Enumerable, Ownable {
    mapping(uint256 => string) private _tokenNames;
    mapping(string => uint256) private _nameToTokenId;
    mapping(address => uint256) private _nameNonce;

    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 32;

    event NicknameMinted(address indexed owner, string name, uint256 indexed tokenId);
    event NicknameTransferred(address indexed from, address indexed to, string name, uint256 indexed tokenId);

    constructor() ERC721("Gomo6 Nicknames", "G6NICK") Ownable(msg.sender) {}

    function mint(string calldata name, address to) external onlyOwner {
        // Force lowercase — @Scythe and @scythe are the same nickname
        string memory normalizedName = _toLower(name);

        uint256 nameLen = bytes(normalizedName).length;
        require(nameLen >= MIN_LENGTH && nameLen <= MAX_LENGTH, "Invalid name length");
        require(_nameToTokenId[normalizedName] == 0, "Name already taken");
        require(_isAlphanumeric(normalizedName), "Invalid characters");
        require(to != address(0), "Invalid recipient");

        _nameNonce[to]++;
        uint256 tokenId = uint256(
            keccak256(abi.encodePacked(block.chainid, to, _nameNonce[to], normalizedName))
        );

        _safeMint(to, tokenId);
        _tokenNames[tokenId] = normalizedName;
        _nameToTokenId[normalizedName] = tokenId;

        emit NicknameMinted(to, normalizedName, tokenId);
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _tokenNames[tokenId];
    }

    function tokenByName(string calldata name) external view returns (uint256) {
        string memory normalized = _toLower(name);
        uint256 tokenId = _nameToTokenId[normalized];
        require(tokenId != 0, "Name not registered");
        return tokenId;
    }

    function isAvailable(string calldata name) external view returns (bool) {
        string memory normalized = _toLower(name);
        uint256 nameLen = bytes(normalized).length;
        if (nameLen < MIN_LENGTH || nameLen > MAX_LENGTH) return false;
        if (_nameToTokenId[normalized] != 0) return false;
        return _isAlphanumeric(normalized);
    }

    function getNicknames(address owner) external view returns (string[] memory) {
        uint256 count = balanceOf(owner);
        string[] memory names = new string[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(owner, i);
            names[i] = _tokenNames[tokenId];
        }
        return names;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);

        if (from != address(0) && to != address(0)) {
            emit NicknameTransferred(from, to, _tokenNames[tokenId], tokenId);
        }
    }

    function _toLower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory result = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            // Uppercase A-Z (0x41-0x5A) -> lowercase a-z (0x61-0x7A)
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                result[i] = bytes1(uint8(b[i]) + 32);
            } else {
                result[i] = b[i];
            }
        }
        return string(result);
    }

    function _isAlphanumeric(string calldata s) internal pure returns (bool) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (
                (b[i] < 0x30 || b[i] > 0x39) &&
                (b[i] < 0x61 || b[i] > 0x7A) &&
                b[i] != 0x2D &&
                b[i] != 0x5F
            ) {
                return false;
            }
        }
        return true;
    }
}
