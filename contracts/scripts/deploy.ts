import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Deploy NicknameRegistry
  console.log("\n1. Deploying NicknameRegistry...");
  const NicknameRegistry = await ethers.getContractFactory("NicknameRegistry");
  const registry = await NicknameRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("NicknameRegistry deployed to:", registryAddress);

  // Deploy GomoWalletFactory
  console.log("\n2. Deploying GomoWalletFactory...");
  const GomoWalletFactory = await ethers.getContractFactory("GomoWalletFactory");
  const factory = await GomoWalletFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("GomoWalletFactory deployed to:", factoryAddress);

  // Transfer NicknameRegistry ownership to factory
  console.log("\n3. Transferring NicknameRegistry ownership to factory...");
  const transferTx = await registry.transferOwnership(factoryAddress);
  await transferTx.wait();
  console.log("Ownership transferred. Registry owner is now:", await registry.owner());

  console.log("\n=== Deployment Complete ===");
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("NicknameRegistry:", registryAddress);
  console.log("GomoWalletFactory:", factoryAddress);

  console.log("\n=== Add to .env ===");
  console.log(`NICKNAME_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`WALLET_FACTORY_ADDRESS=${factoryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
