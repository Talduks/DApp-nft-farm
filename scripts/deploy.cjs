/**
 * Deploys DAppToken, SpeedNFT, NFTFarm and TokenStaking and wires them together.
 *
 *   npm run deploy:amoy        (testnet)
 *   npm run deploy:polygon     (mainnet)
 *
 * Optional environment variables (see .env.example):
 *   FARM_REWARD_RATE      wei per speed unit per second (default 1e14 = 0.0001 DAPPF)
 *   STAKING_REWARD_POOL   DAPPF to mint into the staking reward pool (default 0)
 *   TREASURY_ADDRESS      where `withdrawToTreasury` sends egg sales. Defaults to the deployer — never
 *                         to OWNER_ADDRESS, which has not proven it can sign yet: the sweep is
 *                         permissionless, so a mistyped treasury would be an irreversible sink.
 *   OWNER_ADDRESS         final owner, ideally a Safe multisig. Every hand-over is two-step: the new
 *                         owner must call acceptOwnership() on SpeedNFT, NFTFarm and TokenStaking and
 *                         acceptDefaultAdminTransfer() on DAppToken.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function send(txPromise, label) {
    const tx = await txPromise;
    await tx.wait();
    console.log(`  ✔ ${label}`);
}

async function main() {
    const { ethers, network } = hre;
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("PRIVATE_KEY not set in .env (see .env.example)");
    const { chainId } = await ethers.provider.getNetwork();
    const isLocal = network.name === "hardhat" || network.name === "localhost";

    const rewardRate = BigInt(process.env.FARM_REWARD_RATE || "100000000000000");
    const stakingPool = ethers.parseEther(process.env.STAKING_REWARD_POOL || "0");
    const finalOwner = process.env.OWNER_ADDRESS || "";
    if (finalOwner && (!ethers.isAddress(finalOwner) || finalOwner === ethers.ZeroAddress)) {
        throw new Error("OWNER_ADDRESS is not a valid address");
    }
    if (finalOwner && finalOwner.toLowerCase() === deployer.address.toLowerCase()) {
        throw new Error("OWNER_ADDRESS is the deployer itself; leave it empty to keep the deployer as owner");
    }
    const treasury = process.env.TREASURY_ADDRESS || deployer.address;
    if (!ethers.isAddress(treasury) || treasury === ethers.ZeroAddress) throw new Error("TREASURY_ADDRESS is not a valid address");
    const treasuryIsDeployer = treasury.toLowerCase() === deployer.address.toLowerCase();

    console.log(`Network:  ${network.name} (chainId ${chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}\n`);

    console.log("Deploying contracts...");
    const token = await ethers.deployContract("DAppToken", [deployer.address]);
    await token.waitForDeployment();
    console.log(`  ✔ DAppToken     ${await token.getAddress()}`);

    const nft = await ethers.deployContract("SpeedNFT", [deployer.address]);
    await nft.waitForDeployment();
    console.log(`  ✔ SpeedNFT      ${await nft.getAddress()}`);

    const farm = await ethers.deployContract("NFTFarm", [
        await token.getAddress(),
        await nft.getAddress(),
        rewardRate,
        deployer.address,
    ]);
    await farm.waitForDeployment();
    console.log(`  ✔ NFTFarm       ${await farm.getAddress()}`);

    const staking = await ethers.deployContract("TokenStaking", [await token.getAddress(), deployer.address]);
    await staking.waitForDeployment();
    console.log(`  ✔ TokenStaking  ${await staking.getAddress()}`);

    console.log("\nConfiguring...");
    const MINTER_ROLE = await token.MINTER_ROLE();
    await send(token.grantRole(MINTER_ROLE, await farm.getAddress()), "MINTER_ROLE granted to NFTFarm");
    await send(nft.setTreasury(treasury), `SpeedNFT treasury set to ${treasury}${treasuryIsDeployer ? " (the deployer)" : ""}`);

    if (stakingPool > 0n) {
        await send(token.grantRole(MINTER_ROLE, deployer.address), "temporary MINTER_ROLE for deployer");
        await send(token.mint(deployer.address, stakingPool), `minted ${ethers.formatEther(stakingPool)} DAPPF`);
        await send(token.approve(await staking.getAddress(), stakingPool), "approved staking pool funding");
        await send(staking.fundRewards(stakingPool), "staking reward pool funded");
        await send(token.renounceRole(MINTER_ROLE, deployer.address), "deployer MINTER_ROLE removed");
    }

    if (isLocal) {
        for (const speed of [10, 45, 75, 95]) {
            await send(nft.adminMint(deployer.address, speed), `test NFT with speed ${speed} minted to deployer`);
        }
    }

    if (finalOwner) {
        console.log(`\nProposing hand-over to ${finalOwner}...`);
        await send(nft.transferOwnership(finalOwner), "SpeedNFT ownership proposed");
        await send(farm.transferOwnership(finalOwner), "NFTFarm ownership proposed");
        await send(staking.transferOwnership(finalOwner), "TokenStaking ownership proposed");
        await send(token.beginDefaultAdminTransfer(finalOwner), "DAppToken admin transfer proposed");
        console.log("  ⚠ Nothing changes until the new owner accepts. From that address, call:");
        console.log("      acceptOwnership()             on SpeedNFT, NFTFarm and TokenStaking");
        console.log("      acceptDefaultAdminTransfer()  on DAppToken");
        if (treasuryIsDeployer) {
            console.log("      setTreasury(<cold wallet>)    on SpeedNFT — egg sales currently sweep to the deployer");
        }
        console.log("    The deployer keeps control until then, so a wrong address can't lock you out.");
    } else if (treasuryIsDeployer && !isLocal) {
        console.log("\n  ⚠ Egg sales sweep to the deployer. Set a cold wallet with SpeedNFT.setTreasury() before launch.");
    }

    const deployment = {
        network: network.name,
        chainId: Number(chainId),
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        rewardRate: rewardRate.toString(),
        treasury,
        proposedOwner: finalOwner || null,
        contracts: {
            DAppToken: await token.getAddress(),
            SpeedNFT: await nft.getAddress(),
            NFTFarm: await farm.getAddress(),
            TokenStaking: await staking.getAddress(),
        },
    };
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${network.name}.json`);
    fs.writeFileSync(file, JSON.stringify(deployment, null, 2) + "\n");

    const c = deployment.contracts;
    console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
    console.log("\nAdd these lines to .env.local (frontend):");
    console.log("----------------------------------------------------");
    console.log(`VITE_CHAIN_ID=${chainId}`);
    console.log(`VITE_TOKEN_ADDRESS=${c.DAppToken}`);
    console.log(`VITE_NFT_ADDRESS=${c.SpeedNFT}`);
    console.log(`VITE_FARM_ADDRESS=${c.NFTFarm}`);
    console.log(`VITE_STAKING_ADDRESS=${c.TokenStaking}`);
    console.log("----------------------------------------------------");

    if (!isLocal) {
        console.log("\nVerify on Polygonscan:");
        console.log(`npx hardhat verify --network ${network.name} ${c.DAppToken} ${deployer.address}`);
        console.log(`npx hardhat verify --network ${network.name} ${c.SpeedNFT} ${deployer.address}`);
        console.log(
            `npx hardhat verify --network ${network.name} ${c.NFTFarm} ${c.DAppToken} ${c.SpeedNFT} ${rewardRate} ${deployer.address}`
        );
        console.log(`npx hardhat verify --network ${network.name} ${c.TokenStaking} ${c.DAppToken} ${deployer.address}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
