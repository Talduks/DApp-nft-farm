/**
 * Deploys DAppToken, SpeedNFT, NFTFarm and TokenStaking and wires them together.
 *
 *   npm run deploy:amoy        (testnet)
 *   npm run deploy:polygon     (mainnet)
 *
 * Optional environment variables (see .env.example):
 *   FARM_REWARD_RATE      wei per speed unit per second (default 1e14 = 0.0001 DAPPF)
 *   STAKING_REWARD_POOL   DAPPF to mint into the staking reward pool (default 0)
 *   OWNER_ADDRESS         final owner, ideally a Safe multisig. Ownership is proposed and must be
 *                         accepted by that address with acceptOwnership().
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
    const { chainId } = await ethers.provider.getNetwork();
    const isLocal = network.name === "hardhat" || network.name === "localhost";

    const rewardRate = BigInt(process.env.FARM_REWARD_RATE || "100000000000000");
    const stakingPool = ethers.parseEther(process.env.STAKING_REWARD_POOL || "0");
    const finalOwner = process.env.OWNER_ADDRESS || "";
    if (finalOwner && !ethers.isAddress(finalOwner)) throw new Error("OWNER_ADDRESS is not a valid address");

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

    console.log("\nConfiguring permissions...");
    const MINTER_ROLE = await token.MINTER_ROLE();
    await send(token.grantRole(MINTER_ROLE, await farm.getAddress()), "MINTER_ROLE granted to NFTFarm");

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
        console.log(`\nHanding over to ${finalOwner}...`);
        await send(nft.transferOwnership(finalOwner), "SpeedNFT ownership proposed");
        await send(farm.transferOwnership(finalOwner), "NFTFarm ownership proposed");
        await send(staking.transferOwnership(finalOwner), "TokenStaking ownership proposed");
        const ADMIN = await token.DEFAULT_ADMIN_ROLE();
        await send(token.grantRole(ADMIN, finalOwner), "DAppToken admin granted");
        await send(token.renounceRole(ADMIN, deployer.address), "deployer DAppToken admin removed");
        console.log("  ⚠ The new owner must call acceptOwnership() on SpeedNFT, NFTFarm and TokenStaking.");
    }

    const deployment = {
        network: network.name,
        chainId: Number(chainId),
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        rewardRate: rewardRate.toString(),
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
