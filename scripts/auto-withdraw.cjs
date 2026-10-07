/**
 * Periodically moves egg-sale proceeds from SpeedNFT to the treasury.
 *
 *   npm run withdraw-bot
 *
 * Runs with the owner key from .env (PRIVATE_KEY). Prefer a dedicated hot wallet with little
 * balance and a TREASURY_ADDRESS that is a cold wallet or multisig: the bot only needs to be the
 * contract owner, the funds go straight to the treasury.
 *
 * Environment variables:
 *   SPEED_NFT_ADDRESS        defaults to deployments/<network>.json
 *   TREASURY_ADDRESS         defaults to the bot wallet
 *   WITHDRAW_INTERVAL_HOURS  default 2
 *   WITHDRAW_MIN_BALANCE     minimum POL in the contract before withdrawing (default 1)
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function nftAddress() {
    if (process.env.SPEED_NFT_ADDRESS) return process.env.SPEED_NFT_ADDRESS;
    const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
    if (!fs.existsSync(file)) throw new Error(`Set SPEED_NFT_ADDRESS or deploy first (${file} not found)`);
    return JSON.parse(fs.readFileSync(file, "utf8")).contracts.SpeedNFT;
}

async function main() {
    const { ethers } = hre;
    const [wallet] = await ethers.getSigners();
    if (!wallet) throw new Error("PRIVATE_KEY not set in .env");

    const nft = await ethers.getContractAt("SpeedNFT", nftAddress(), wallet);
    const treasury = process.env.TREASURY_ADDRESS || wallet.address;
    const intervalMs = Number(process.env.WITHDRAW_INTERVAL_HOURS || 2) * 60 * 60 * 1000;
    const minBalance = ethers.parseEther(process.env.WITHDRAW_MIN_BALANCE || "1");

    const owner = await nft.owner();
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error(`Bot wallet ${wallet.address} is not the SpeedNFT owner (${owner})`);
    }

    console.log("🤖 Auto-withdraw bot started");
    console.log(`   Contract: ${await nft.getAddress()}`);
    console.log(`   Treasury: ${treasury}`);
    console.log(`   Every ${intervalMs / 3_600_000}h, when balance >= ${ethers.formatEther(minBalance)} POL\n`);

    let running = false;
    async function check() {
        if (running) return;
        running = true;
        try {
            const balance = await ethers.provider.getBalance(await nft.getAddress());
            console.log(`[${new Date().toISOString()}] Contract balance: ${ethers.formatEther(balance)} POL`);
            if (balance >= minBalance) {
                const tx = await nft.withdraw(treasury);
                console.log(`   📤 Sent ${tx.hash}`);
                const receipt = await tx.wait();
                console.log(`   ✅ Withdrawn (gas used ${receipt.gasUsed})`);
            }
        } catch (error) {
            console.error("   ❌ Withdraw failed:", error.shortMessage || error.message);
        } finally {
            running = false;
        }
    }

    await check();
    setInterval(check, intervalMs);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
