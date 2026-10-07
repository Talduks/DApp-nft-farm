const { ethers } = require("hardhat");

const REWARD_RATE = 10n ** 14n; // 0.0001 DAPPF per speed unit per second

async function deployFixture() {
    const [owner, alice, bob, keeper] = await ethers.getSigners();

    const token = await ethers.deployContract("DAppToken", [owner.address]);
    const nft = await ethers.deployContract("SpeedNFT", [owner.address]);
    const farm = await ethers.deployContract("NFTFarm", [
        await token.getAddress(),
        await nft.getAddress(),
        REWARD_RATE,
        owner.address,
    ]);
    const staking = await ethers.deployContract("TokenStaking", [await token.getAddress(), owner.address]);

    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, await farm.getAddress());
    // The owner also gets MINTER_ROLE in tests to fund balances directly.
    await token.grantRole(MINTER_ROLE, owner.address);

    return { owner, alice, bob, keeper, token, nft, farm, staking, MINTER_ROLE };
}

/// Mints NFTs with the given speeds to `to` through adminMint and returns their ids.
async function mintSpeeds(nft, owner, to, speeds) {
    const ids = [];
    for (const speed of speeds) {
        const tx = await nft.connect(owner).adminMint(to.address, speed);
        const receipt = await tx.wait();
        const event = receipt.logs.map((l) => nft.interface.parseLog(l)).find((e) => e && e.name === "NftMinted");
        ids.push(event.args.tokenId);
    }
    return ids;
}

module.exports = { deployFixture, mintSpeeds, REWARD_RATE };
