import { expect } from "chai";
import { ethers } from "hardhat";
import { NicknameRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("NicknameRegistry", function () {
  let registry: NicknameRegistry;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const NicknameRegistry = await ethers.getContractFactory("NicknameRegistry");
    registry = await NicknameRegistry.deploy();
    await registry.waitForDeployment();
  });

  describe("Minting", function () {
    it("should mint a nickname to a user", async function () {
      const name = "coolname";
      const tx = await registry.mint(name, user1.address);
      await expect(tx)
        .to.emit(registry, "NicknameMinted")
        .withArgs(user1.address, name, (v: any) => true);

      expect(await registry.balanceOf(user1.address)).to.equal(1);
      expect(await registry.isAvailable(name)).to.be.false;
    });

    it("should reject duplicate names", async function () {
      await registry.mint("taken", user1.address);
      await expect(registry.mint("taken", user2.address)).to.be.revertedWith("Name already taken");
    });

    it("should reject names shorter than 3 chars", async function () {
      await expect(registry.mint("ab", user1.address)).to.be.revertedWith("Invalid name length");
    });

    it("should reject names longer than 32 chars", async function () {
      const longName = "a".repeat(33);
      await expect(registry.mint(longName, user1.address)).to.be.revertedWith("Invalid name length");
    });

    it("should reject invalid characters", async function () {
      await expect(registry.mint("bad name!", user1.address)).to.be.revertedWith("Invalid characters");
      await expect(registry.mint("bad@name", user1.address)).to.be.revertedWith("Invalid characters");
    });

    it("should allow hyphens and underscores", async function () {
      await registry.mint("my-name", user1.address);
      await registry.mint("my_name", user2.address);
      expect(await registry.balanceOf(user1.address)).to.equal(1);
      expect(await registry.balanceOf(user2.address)).to.equal(1);
    });

    it("should allow multiple nicknames per user", async function () {
      await registry.mint("name1", user1.address);
      await registry.mint("name2", user1.address);
      await registry.mint("name3", user1.address);
      expect(await registry.balanceOf(user1.address)).to.equal(3);
    });
  });

  describe("Queries", function () {
    beforeEach(async function () {
      await registry.mint("alice", user1.address);
      await registry.mint("alice2", user1.address);
      await registry.mint("bob", user2.address);
    });

    it("should return nameOf for a token", async function () {
      const tokenId = await registry.tokenByName("alice");
      expect(await registry.nameOf(tokenId)).to.equal("alice");
    });

    it("should return tokenByName", async function () {
      const tokenId = await registry.tokenByName("alice");
      expect(tokenId).to.be.greaterThan(0);
    });

    it("should return getNicknames for a user", async function () {
      const names = await registry.getNicknames(user1.address);
      expect(names).to.have.lengthOf(2);
      expect(names).to.include("alice");
      expect(names).to.include("alice2");
    });

    it("should return isAvailable correctly", async function () {
      expect(await registry.isAvailable("alice")).to.be.false;
      expect(await registry.isAvailable("newname")).to.be.true;
      expect(await registry.isAvailable("ab")).to.be.false;
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await registry.mint("transferme", user1.address);
    });

    it("should transfer nickname", async function () {
      const tokenId = await registry.tokenByName("transferme");
      await registry.transferFrom(user1.address, user2.address, tokenId);

      expect(await registry.ownerOf(tokenId)).to.equal(user2.address);
      expect(await registry.balanceOf(user1.address)).to.equal(0);
      expect(await registry.balanceOf(user2.address)).to.equal(1);
    });

    it("should emit NicknameTransferred event", async function () {
      const tokenId = await registry.tokenByName("transferme");
      await expect(
        registry.transferFrom(user1.address, user2.address, tokenId)
      )
        .to.emit(registry, "NicknameTransferred")
        .withArgs(user1.address, user2.address, "transferme", tokenId);
    });
  });
});
