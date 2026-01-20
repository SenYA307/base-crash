const hre = require("hardhat");

async function main() {
  // Configuration
  const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || "0x87AA66FB877c508420D77A3f7D1D5020b4d1A8f9";
  const HINTS_PRICE_WEI = process.env.HINTS_PRICE_WEI || "333333333333333"; // ~$1 at $3000 ETH

  console.log("Deploying BaseCrashHints contract...");
  console.log("Treasury:", TREASURY_ADDRESS);
  console.log("Price (wei):", HINTS_PRICE_WEI);

  const BaseCrashHints = await hre.ethers.getContractFactory("BaseCrashHints");
  const hints = await BaseCrashHints.deploy(TREASURY_ADDRESS, HINTS_PRICE_WEI);

  await hints.waitForDeployment();

  const address = await hints.getAddress();
  console.log("\n✅ BaseCrashHints deployed to:", address);
  console.log("\nAdd to your .env.local or Vercel:");
  console.log(`HINTS_CONTRACT_ADDRESS=${address}`);

  // Wait for a few block confirmations before verification
  console.log("\nWaiting for block confirmations...");
  await hints.deploymentTransaction().wait(5);

  // Verify on BaseScan (optional)
  if (process.env.BASESCAN_API_KEY) {
    console.log("\nVerifying on BaseScan...");
    try {
      await hre.run("verify:verify", {
        address: address,
        constructorArguments: [TREASURY_ADDRESS, HINTS_PRICE_WEI],
      });
      console.log("✅ Contract verified on BaseScan");
    } catch (error) {
      console.log("Verification failed:", error.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
