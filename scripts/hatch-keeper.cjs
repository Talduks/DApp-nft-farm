/**
 * Hatches eggs their buyers didn't hatch themselves (closed the tab, lost connection...), so no
 * paid egg expires into the minimum speed. `hatchEggs` is permissionless and always mints to the
 * egg owner, so the keeper only pays gas.
 *
 *   npm run keeper
 *
 * Environment variables:
 *   PRIVATE_KEY              gas wallet of the keeper (any funded EOA)
 *   SPEED_NFT_ADDRESS        defaults to deployments/<network>.json
 *   KEEPER_INTERVAL_SECONDS  default 30
 *   KEEPER_MIN_AGE_BLOCKS    blocks to wait before hatching for someone (default 5, gives the
 *                            buyer's own hatch transaction time to land first)
 *   KEEPER_LOOKBACK_EGGS     how many past eggs to scan on startup (default 2000)
 */
const hre = require("hardhat");
const { loadDeployment, chunk } = require("./lib/deployment.cjs");

const MAX_BATCH = 50;

async function main() {
    const { ethers } = hre;
    const [wallet] = await ethers.getSigners();
    if (!wallet) throw new Error("PRIVATE_KEY not set in .env");

    const address = process.env.SPEED_NFT_ADDRESS || loadDeployment(hre.network.name).contracts.SpeedNFT;
    const nft = await ethers.getContractAt("SpeedNFT", address, wallet);
    const intervalMs = Number(process.env.KEEPER_INTERVAL_SECONDS || 30) * 1000;
    const minAge = Number(process.env.KEEPER_MIN_AGE_BLOCKS || 5);
    const lookback = Number(process.env.KEEPER_LOOKBACK_EGGS || 2000);
    const hatchWindow = Number(await nft.HATCH_WINDOW());

    let cursor = Math.max(0, Number(await nft.nextEggId()) - lookback);
    const pending = new Map(); // eggId -> commitBlock

    console.log("🐣 Hatch keeper started");
    console.log(`   Contract: ${address}`);
    console.log(`   Gas wallet: ${wallet.address}`);
    console.log(`   Scanning from egg #${cursor}, every ${intervalMs / 1000}s, hatching eggs older than ${minAge} blocks\n`);

    async function loadEggs(ids) {
        const eggs = await Promise.all(ids.map((id) => nft.eggs(id)));
        return ids.map((id, i) => ({ id, commitBlock: Number(eggs[i].commitBlock), hatched: eggs[i].hatched }));
    }

    let running = false;
    async function tick() {
        if (running) return;
        running = true;
        try {
            const [nextEggId, blockNumber] = await Promise.all([nft.nextEggId(), ethers.provider.getBlockNumber()]);

            // Discover eggs bought since the last tick.
            const newIds = [];
            for (let id = cursor; id < Number(nextEggId); id++) newIds.push(id);
            for (const ids of chunk(newIds, MAX_BATCH)) {
                for (const egg of await loadEggs(ids)) {
                    if (!egg.hatched) pending.set(egg.id, egg.commitBlock);
                }
            }
            cursor = Number(nextEggId);

            // Re-check the ones old enough: buyers may have hatched them meanwhile.
            const candidates = [...pending].filter(([, commitBlock]) => blockNumber - commitBlock >= minAge).map(([id]) => id);
            const ready = [];
            for (const ids of chunk(candidates, MAX_BATCH)) {
                for (const egg of await loadEggs(ids)) {
                    if (egg.hatched) pending.delete(egg.id);
                    else ready.push(egg.id);
                }
            }

            if (ready.length === 0) {
                console.log(`[${new Date().toISOString()}] block ${blockNumber}: nothing to hatch (${pending.size} incubating)`);
                return;
            }

            for (const ids of chunk(ready, MAX_BATCH)) {
                const expiring = ids.filter((id) => blockNumber - pending.get(id) >= hatchWindow - minAge).length;
                console.log(`[${new Date().toISOString()}] hatching ${ids.length} egg(s)${expiring ? ` (${expiring} about to expire)` : ""}…`);
                const tx = await nft.hatchEggs(ids);
                const receipt = await tx.wait();
                let expired = 0;
                for (const log of receipt.logs) {
                    try {
                        const parsed = nft.interface.parseLog(log);
                        if (parsed?.name === "EggHatched" && parsed.args.expired) expired++;
                    } catch {
                        // other contract's log
                    }
                }
                ids.forEach((id) => pending.delete(id));
                console.log(`   ✅ ${tx.hash} (gas ${receipt.gasUsed}${expired ? `, ${expired} hatched at minimum speed` : ""})`);
            }
        } catch (error) {
            console.error("   ❌ Keeper tick failed:", error.shortMessage || error.message);
        } finally {
            running = false;
        }
    }

    await tick();
    setInterval(tick, intervalMs);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
