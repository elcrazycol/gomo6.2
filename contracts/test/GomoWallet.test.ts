import { expect } from "chai";
import { ethers } from "hardhat";
import { GomoWallet, GomoWalletFactory } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("GomoWallet", function () {
  let wallet: GomoWallet;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    const GomoWallet = await ethers.getContractFactory("GomoWallet");
    wallet = await GomoWallet.deploy();
    await wallet.waitForDeployment();
    await wallet.initialize(owner.address);
  });

  it("should initialize with correct owner", async function () {
    expect(await wallet.owner()).to.equal(owner.address);
  });

  it("should reject double initialization", async function () {
    await expect(wallet.initialize(user1.address)).to.be.revertedWith("Already initialized");
  });

  it("should receive ETH", async function () {
    await owner.sendTransaction({ to: wallet.address, value: ethers.parseEther("1.0") });
    expect(await wallet.balance()).to.equal(ethers.parseEther("1.0"));
  });

  it("should execute transactions", async function () {
    await owner.sendTransaction({ to: wallet.address, value: ethers.parseEther("1.0") });

    const balanceBefore = await ethers.provider.getBalance(user1.address);
    await wallet.execute(user1.address, ethers.parseEther("0.5"), "0x");
    const balanceAfter = await ethers.provider.getBalance(user1.address);

    expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.5"));
  });

  it("should reject non-owner transactions", async function () {
    await expect(
      wallet.connect(user1).execute(user1.address, 0, "0x")
    ).to.be.revertedWith("NotOwner");
  });
});

describe("GomoWalletFactory", function () {
  let factory: GomoWalletFactory;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const GomoWalletFactory = await ethers.getContractFactory("GomoWalletFactory");
    factory = await GomoWalletFactory.deploy();
    await factory.waitForDeployment();
  });

  it("should create a wallet for a user", async function () {
    const tx = await factory.createWallet(user1.address);
    await expect(tx).to.emit(factory, "WalletCreated");

    const walletAddress = await factory.getWallet(user1.address);
    expect(walletAddress).to.not.equal(ethers.ZeroAddress);
  });

  it("should reject duplicate wallet creation", async function () {
    await factory.createWallet(user1.address);
    await expect(factory.createWallet(user1.address)).to.be.revertedWith("Wallet already exists");
  });

  it("should return zero address for non-existent wallet", async function () {
    expect(await factory.getWallet(user1.address)).to.equal(ethers.ZeroAddress);
  });

  it("should create unique wallets for different users", async function () {
    await factory.createWallet(user1.address);
    await factory.createWallet(user2.address);

    const wallet1 = await factory.getWallet(user1.address);
    const wallet2 = await factory.getWallet(user2.address);

    expect(wallet1).to.not.equal(wallet2);
  });
});
