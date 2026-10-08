/**
 * Periodically sweeps egg-sale proceeds from SpeedNFT to the on-chain treasury.
 *
 *   npm run withdraw-bot
 *
 * Uses `withdrawToTreasury()`, which anyone may call and which always pays the treasury the
 * owner configured with `setTreasury`. The bot therefore needs a wallet with a little POL for
 * gas and nothing else — never the owner key.
 *
 * Environment variables:
 *   PRIVATE_KEY              gas wallet of the bot (any funded EOA)
 *   SPEED_NFT_ADDRESS        defaults to deployments/<network>.json
 *   WITHDRAW_INTERVAL_HOURS  default 2
 *   WITHDRAW_MIN_BALANCE     minimum POL in the contract before sweeping (default 1)
 */
const hre = require("hardhat");
const { loadDeployment } = require("./lib/deployment.cjs");

async function main() {
    const { ethers } = hre;
    const [wallet] = await ethers.getSigners();
    if (!wallet) throw new Error("PRIVATE_KEY not set in .env");

    const address = process.env.SPEED_NFT_ADDRESS || loadDeployment(hre.network.name).contracts.SpeedNFT;
    const nft = await ethers.getContractAt("SpeedNFT", address, wallet);
    const intervalMs = Number(process.env.WITHDRAW_INTERVAL_HOURS || 2) * 60 * 60 * 1000;
    const minBalance = ethers.parseEther(process.env.WITHDRAW_MIN_BALANCE || "1");

    const treasury = await nft.treasury();
    if (treasury === ethers.ZeroAddress) {
        throw new Error("SpeedNFT has no treasury yet: the owner must call setTreasury(<cold wallet or multisig>)");
    }

    console.log("🤖 Auto-withdraw bot started");
    console.log(`   Contract: ${address}`);
    console.log(`   Treasury: ${treasury} (fixed on-chain by the owner)`);
    console.log(`   Gas wallet: ${wallet.address}`);
    console.log(`   Every ${intervalMs / 3_600_000}h, when balance >= ${ethers.formatEther(minBalance)} POL\n`);

    let running = false;
    async function sweep() {
        if (running) return;
        running = true;
        try {
            const balance = await ethers.provider.getBalance(address);
            console.log(`[${new Date().toISOString()}] Contract balance: ${ethers.formatEther(balance)} POL`);
            if (balance >= minBalance) {
                const tx = await nft.withdrawToTreasury();
                console.log(`   📤 Sent ${tx.hash}`);
                const receipt = await tx.wait();
                console.log(`   ✅ Swept to treasury (gas used ${receipt.gasUsed})`);
            }
        } catch (error) {
            console.error("   ❌ Sweep failed:", error.shortMessage || error.message);
        } finally {
            running = false;
        }
    }

    await sweep();
    setInterval(sweep, intervalMs);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
