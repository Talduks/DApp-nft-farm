const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, mintSpeeds, REWARD_RATE } = require("./fixtures.cjs");

async function blockTime(tx) {
    const receipt = await tx.wait();
    return BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
}

async function stakedFixture() {
    const base = await deployFixture();
    const { nft, farm, owner, alice } = base;
    const ids = await mintSpeeds(nft, owner, alice, [10, 50]);
    await nft.connect(alice).setApprovalForAll(await farm.getAddress(), true);
    const stakedAt = await blockTime(await farm.connect(alice).stake(ids));
    return { ...base, ids, stakedAt };
}

describe("NFTFarm", function () {
    describe("stake", function () {
        it("stakes a batch of NFTs in one transaction", async function () {
            const { farm, nft, alice, ids } = await loadFixture(stakedFixture);
            for (const id of ids) {
                expect(await nft.ownerOf(id)).to.equal(await farm.getAddress());
                expect(await farm.stakedBy(id)).to.equal(alice.address);
            }
            const info = await farm.getUserInfo(alice.address);
            expect(info.tokenIds.map(Number).sort()).to.deep.equal(ids.map(Number).sort());
            expect(info.totalSpeed).to.equal(60);
            expect(info.rewardPerSecond).to.equal(60n * REWARD_RATE);
            expect(await farm.totalSpeedStaked()).to.equal(60);
            expect(await farm.totalStaked()).to.equal(2);
        });

        it("rejects NFTs the caller does not own", async function () {
            const { farm, nft, owner, alice, bob } = await loadFixture(deployFixture);
            const [id] = await mintSpeeds(nft, owner, alice, [20]);
            await nft.connect(alice).setApprovalForAll(await farm.getAddress(), true);
            await expect(farm.connect(bob).stake([id])).to.be.revertedWithCustomError(nft, "ERC721IncorrectOwner");
        });

        it("rejects empty and oversized batches", async function () {
            const { farm, alice } = await loadFixture(deployFixture);
            await expect(farm.connect(alice).stake([])).to.be.revertedWithCustomError(farm, "EmptyBatch");
            const big = Array.from({ length: 51 }, (_, i) => i);
            await expect(farm.connect(alice).stake(big)).to.be.revertedWithCustomError(farm, "BatchTooLarge");
        });

        it("refuses NFTs sent with safeTransferFrom instead of stake", async function () {
            const { farm, nft, owner, alice } = await loadFixture(deployFixture);
            const [id] = await mintSpeeds(nft, owner, alice, [20]);
            await expect(
                nft.connect(alice)["safeTransferFrom(address,address,uint256)"](alice.address, await farm.getAddress(), id)
            ).to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver");
        });
    });

    describe("rewards", function () {
        it("accrues speed * rate per second and pays exactly on claim", async function () {
            const { farm, token, alice, stakedAt } = await loadFixture(stakedFixture);
            await time.increase(1000);
            const claimedAt = await blockTime(await farm.connect(alice).claimAll());
            const expected = 60n * REWARD_RATE * (claimedAt - stakedAt);
            expect(await token.balanceOf(alice.address)).to.equal(expected);
            expect(await farm.pendingRewards(alice.address)).to.be.lte(60n * REWARD_RATE);
        });

        it("does not apply rate changes retroactively", async function () {
            const { farm, token, owner, alice, stakedAt } = await loadFixture(stakedFixture);
            await time.increase(500);
            const changedAt = await blockTime(await farm.connect(owner).setRewardRate(REWARD_RATE * 2n));
            await time.increase(500);
            const claimedAt = await blockTime(await farm.connect(alice).claimAll());
            const expected =
                60n * REWARD_RATE * (changedAt - stakedAt) + 60n * REWARD_RATE * 2n * (claimedAt - changedAt);
            expect(await token.balanceOf(alice.address)).to.equal(expected);
        });

        it("caps the reward rate", async function () {
            const { farm } = await loadFixture(deployFixture);
            const max = await farm.MAX_REWARD_RATE();
            await expect(farm.setRewardRate(max + 1n)).to.be.revertedWithCustomError(farm, "RateTooHigh");
        });

        it("reverts claimAll when there is nothing to claim", async function () {
            const { farm, bob } = await loadFixture(deployFixture);
            await expect(farm.connect(bob).claimAll()).to.be.revertedWithCustomError(farm, "NothingToClaim");
        });

        it("keeps per-user accounting independent", async function () {
            const { farm, nft, token, owner, alice, bob, stakedAt } = await loadFixture(stakedFixture);
            const [bobId] = await mintSpeeds(nft, owner, bob, [100]);
            await nft.connect(bob).approve(await farm.getAddress(), bobId);
            const bobStakedAt = await blockTime(await farm.connect(bob).stake([bobId]));
            await time.increase(100);

            const aliceAt = await blockTime(await farm.connect(alice).claimAll());
            const bobAt = await blockTime(await farm.connect(bob).claimAll());
            expect(await token.balanceOf(alice.address)).to.equal(60n * REWARD_RATE * (aliceAt - stakedAt));
            expect(await token.balanceOf(bob.address)).to.equal(100n * REWARD_RATE * (bobAt - bobStakedAt));
        });
    });

    describe("withdraw", function () {
        it("returns NFTs and pays pending rewards", async function () {
            const { farm, nft, token, alice, ids, stakedAt } = await loadFixture(stakedFixture);
            await time.increase(100);
            const withdrawnAt = await blockTime(await farm.connect(alice).withdraw([ids[0]]));
            expect(await nft.ownerOf(ids[0])).to.equal(alice.address);
            expect(await token.balanceOf(alice.address)).to.equal(60n * REWARD_RATE * (withdrawnAt - stakedAt));

            const info = await farm.getUserInfo(alice.address);
            expect(info.tokenIds.map(Number)).to.deep.equal([Number(ids[1])]);
            expect(info.totalSpeed).to.equal(50);
        });

        it("only lets the staker withdraw", async function () {
            const { farm, bob, ids } = await loadFixture(stakedFixture);
            await expect(farm.connect(bob).withdraw([ids[0]]))
                .to.be.revertedWithCustomError(farm, "NotStaker")
                .withArgs(ids[0]);
        });

        it("rejects duplicated ids in a batch", async function () {
            const { farm, alice, ids } = await loadFixture(stakedFixture);
            await expect(farm.connect(alice).withdraw([ids[0], ids[0]])).to.be.revertedWithCustomError(
                farm,
                "NotStaker"
            );
        });

        it("still returns NFTs while paused, keeps rewards owed and signals RewardDeferred", async function () {
            const { farm, nft, token, owner, alice, ids } = await loadFixture(stakedFixture);
            await time.increase(100);
            await farm.connect(owner).pause();
            await expect(farm.connect(alice).stake([ids[0]])).to.be.revertedWithCustomError(farm, "EnforcedPause");
            await expect(farm.connect(alice).claimAll()).to.be.revertedWithCustomError(farm, "EnforcedPause");

            await expect(farm.connect(alice).withdraw(ids))
                .to.emit(farm, "RewardDeferred")
                .withArgs(alice.address, (v) => v > 0n, await farm.DEFER_PAUSED());
            expect(await nft.balanceOf(alice.address)).to.equal(2);
            expect(await token.balanceOf(alice.address)).to.equal(0);
            const owed = await farm.pendingRewards(alice.address);
            expect(owed).to.be.gt(0);

            await farm.connect(owner).unpause();
            await farm.connect(alice).claimAll();
            expect(await token.balanceOf(alice.address)).to.equal(owed);
        });

        it("never reverts because of the token: a revoked minter role defers the reward", async function () {
            const { farm, nft, token, owner, alice, ids, MINTER_ROLE } = await loadFixture(stakedFixture);
            await time.increase(100);
            await token.connect(owner).revokeRole(MINTER_ROLE, await farm.getAddress());

            await expect(farm.connect(alice).withdraw([ids[0]]))
                .to.emit(farm, "RewardDeferred")
                .withArgs(alice.address, (v) => v > 0n, await farm.DEFER_MINT_FAILED());
            expect(await nft.ownerOf(ids[0])).to.equal(alice.address);
            const owed = await farm.pendingRewards(alice.address);
            expect(owed).to.be.gt(0);
            await expect(farm.connect(alice).claimAll()).to.be.revertedWithCustomError(farm, "RewardMintFailed");

            await token.connect(owner).grantRole(MINTER_ROLE, await farm.getAddress());
            await farm.connect(alice).claimAll();
            expect(await token.balanceOf(alice.address)).to.be.gte(owed);
            expect(await farm.pendingRewards(alice.address)).to.be.lte(50n * REWARD_RATE);
        });

        it("emergencyWithdraw skips the token entirely", async function () {
            const { farm, nft, alice, ids } = await loadFixture(stakedFixture);
            await time.increase(100);
            await expect(farm.connect(alice).emergencyWithdraw(ids)).to.not.emit(farm, "RewardClaimed");
            expect(await nft.balanceOf(alice.address)).to.equal(2);
            expect(await farm.pendingRewards(alice.address)).to.be.gt(0);
        });

        it("keeps the token list consistent when withdrawing from the middle of a batch", async function () {
            const { farm, nft, owner, alice } = await loadFixture(deployFixture);
            const ids = await mintSpeeds(nft, owner, alice, [10, 20, 30]);
            await nft.connect(alice).setApprovalForAll(await farm.getAddress(), true);
            await farm.connect(alice).stake(ids);
            await farm.connect(alice).withdraw([ids[1]]);
            const remaining = (await farm.getStakedTokens(alice.address)).map(Number).sort();
            expect(remaining).to.deep.equal([Number(ids[0]), Number(ids[2])]);
            expect((await farm.users(alice.address)).speed).to.equal(40);
            await farm.connect(alice).withdraw([ids[0], ids[2]]);
            expect(await farm.getStakedTokens(alice.address)).to.deep.equal([]);
            expect(await farm.totalSpeedStaked()).to.equal(0);
        });
    });

    describe("admin", function () {
        it("rejects duplicated ids in a stake batch", async function () {
            const { farm, nft, owner, alice } = await loadFixture(deployFixture);
            const [id] = await mintSpeeds(nft, owner, alice, [20]);
            await nft.connect(alice).setApprovalForAll(await farm.getAddress(), true);
            await expect(farm.connect(alice).stake([id, id])).to.be.revertedWithCustomError(nft, "ERC721IncorrectOwner");
        });

        it("stops accruing when the rate is set to zero", async function () {
            const { farm, owner, alice } = await loadFixture(stakedFixture);
            await farm.connect(owner).setRewardRate(0);
            const frozen = await farm.pendingRewards(alice.address);
            await time.increase(1000);
            expect(await farm.pendingRewards(alice.address)).to.equal(frozen);
        });

        it("cannot be renounced", async function () {
            const { farm } = await loadFixture(deployFixture);
            await expect(farm.renounceOwnership()).to.be.revertedWithCustomError(farm, "RenounceDisabled");
        });
    });

    describe("supply cap", function () {
        it("pays up to the remaining supply and keeps the rest owed", async function () {
            const { nft, owner, alice } = await loadFixture(deployFixture);
            const cap = ethers.parseEther("1");
            const mock = await ethers.deployContract("MockCappedToken", [cap]);
            const farm = await ethers.deployContract("NFTFarm", [
                await mock.getAddress(),
                await nft.getAddress(),
                REWARD_RATE,
                owner.address,
            ]);
            const [id] = await mintSpeeds(nft, owner, alice, [100]);
            await nft.connect(alice).approve(await farm.getAddress(), id);
            await farm.connect(alice).stake([id]);
            // 100 speed * 1e14 = 0.01 token/s -> 1 token after 100s; wait long enough to exceed the cap
            await time.increase(1000);

            await expect(farm.connect(alice).withdraw([id]))
                .to.emit(farm, "RewardClaimed")
                .withArgs(alice.address, cap)
                .and.to.emit(farm, "RewardDeferred")
                .withArgs(alice.address, (v) => v > 0n, await farm.DEFER_SUPPLY_EXHAUSTED());
            expect(await nft.ownerOf(id)).to.equal(alice.address);
            expect(await mock.balanceOf(alice.address)).to.equal(cap);
            const [, , , pending, rewardPerSecond] = await farm.getUserInfo(alice.address);
            expect(pending).to.be.gt(0);
            expect(rewardPerSecond).to.equal(0);
            expect(await farm.remainingMintable()).to.equal(0);
            await expect(farm.connect(alice).claimAll())
                .to.be.revertedWithCustomError(farm, "SupplyExhausted")
                .withArgs(pending);
        });
    });

    describe("recoverERC721", function () {
        it("returns NFTs sent by mistake but never staked ones", async function () {
            const { farm, nft, owner, alice, bob, ids } = await loadFixture(stakedFixture);
            await expect(farm.recoverERC721(await nft.getAddress(), ids[0], owner.address))
                .to.be.revertedWithCustomError(farm, "CannotRecoverStaked")
                .withArgs(ids[0]);

            const [lost] = await mintSpeeds(nft, owner, bob, [30]);
            await nft.connect(bob).transferFrom(bob.address, await farm.getAddress(), lost);
            await expect(farm.connect(alice).recoverERC721(await nft.getAddress(), lost, bob.address)).to.be.reverted;
            await farm.recoverERC721(await nft.getAddress(), lost, bob.address);
            expect(await nft.ownerOf(lost)).to.equal(bob.address);
        });
    });
});
