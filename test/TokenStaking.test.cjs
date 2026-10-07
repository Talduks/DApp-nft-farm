const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./fixtures.cjs");

const E = (n) => ethers.parseEther(String(n));
const MONTH = 30n * 24n * 60n * 60n;

async function fundedFixture() {
    const base = await deployFixture();
    const { token, staking, owner, alice, bob } = base;
    const stakingAddress = await staking.getAddress();
    await token.mint(owner.address, E(1000));
    await token.approve(stakingAddress, E(1000));
    await staking.fundRewards(E(1000));
    await token.mint(alice.address, E(10000));
    await token.mint(bob.address, E(10000));
    await token.connect(alice).approve(stakingAddress, ethers.MaxUint256);
    await token.connect(bob).approve(stakingAddress, ethers.MaxUint256);
    return base;
}

describe("TokenStaking", function () {
    it("quotes 22% APR prorated by lock length", async function () {
        const { staking } = await loadFixture(deployFixture);
        expect(await staking.quoteReward(E(100), 3)).to.equal(E(5.5));
        expect(await staking.quoteReward(E(100), 6)).to.equal(E(11));
        expect(await staking.quoteReward(E(100), 12)).to.equal(E(22));
        const [months, aprs] = await staking.getPlans();
        expect(months.map(Number)).to.deep.equal([3, 6, 12]);
        expect(aprs.map(Number)).to.deep.equal([2200, 2200, 2200]);
    });

    it("reserves the reward and pays principal + reward after the lock", async function () {
        const { staking, token, alice } = await loadFixture(fundedFixture);
        await expect(staking.connect(alice).stake(E(1000), 6))
            .to.emit(staking, "Staked")
            .withArgs(alice.address, 0, E(1000), 6, E(110), (v) => v > 0n);

        expect(await staking.totalStaked()).to.equal(E(1000));
        expect(await staking.totalRewardsReserved()).to.equal(E(110));
        expect(await staking.rewardPool()).to.equal(E(890));
        expect(await staking.stakedByPeriod(6)).to.equal(E(1000));

        await expect(staking.connect(alice).unstake(0)).to.be.revertedWithCustomError(staking, "StillLocked");
        await time.increase(6n * MONTH);
        await expect(staking.connect(alice).unstake(0)).to.changeTokenBalances(
            token,
            [alice, staking],
            [E(1110), -E(1110)]
        );
        expect(await staking.totalStaked()).to.equal(0);
        expect(await staking.totalRewardsReserved()).to.equal(0);
        expect(await staking.activeStakes()).to.equal(0);
        await expect(staking.connect(alice).unstake(0)).to.be.revertedWithCustomError(staking, "AlreadyWithdrawn");
    });

    it("rejects stakes the reward pool cannot cover", async function () {
        const { staking, alice } = await loadFixture(fundedFixture);
        // 12 months of 22% on 5000 = 1100 > 1000 in the pool
        await expect(staking.connect(alice).stake(E(5000), 12))
            .to.be.revertedWithCustomError(staking, "InsufficientRewardPool")
            .withArgs(E(1100), E(1000));
    });

    it("never lets the owner withdraw principal or reserved rewards", async function () {
        const { staking, owner, alice } = await loadFixture(fundedFixture);
        await staking.connect(alice).stake(E(1000), 12); // reserves 220
        await expect(staking.withdrawRewardPool(E(781), owner.address))
            .to.be.revertedWithCustomError(staking, "InsufficientRewardPool")
            .withArgs(E(781), E(780));
        await staking.withdrawRewardPool(E(780), owner.address);
        expect(await staking.rewardPool()).to.equal(0);

        await time.increase(12n * MONTH);
        await staking.connect(alice).unstake(0); // still fully paid
    });

    it("applies plan changes to new stakes only", async function () {
        const { staking, alice } = await loadFixture(fundedFixture);
        await staking.connect(alice).stake(E(100), 3);
        await staking.setPlan(3, 4400);
        await staking.connect(alice).stake(E(100), 3);
        const [, , , , , rewards] = await staking.getActiveStakes(alice.address);
        expect(rewards).to.deep.equal([E(5.5), E(11)]);

        await staking.setPlan(3, 0);
        await expect(staking.connect(alice).stake(E(100), 3))
            .to.be.revertedWithCustomError(staking, "InvalidPlan")
            .withArgs(3);
        await expect(staking.setPlan(0, 100)).to.be.revertedWithCustomError(staking, "InvalidLockPeriod");
        await expect(staking.setPlan(24, 10_001)).to.be.revertedWithCustomError(staking, "AprTooHigh");
        await expect(staking.connect(alice).setPlan(24, 100)).to.be.revertedWithCustomError(
            staking,
            "OwnableUnauthorizedAccount"
        );
    });

    it("unstakes several unlocked stakes at once", async function () {
        const { staking, token, alice } = await loadFixture(fundedFixture);
        await staking.connect(alice).stake(E(100), 3);
        await staking.connect(alice).stake(E(200), 3);
        await staking.connect(alice).stake(E(300), 12);
        await time.increase(3n * MONTH);
        await expect(staking.connect(alice).unstakeMany([0, 1])).to.changeTokenBalance(token, alice, E(316.5));
        await expect(staking.connect(alice).unstakeMany([2])).to.be.revertedWithCustomError(staking, "StillLocked");

        const [ids] = await staking.getActiveStakes(alice.address);
        expect(ids.map(Number)).to.deep.equal([2]);
    });

    it("stakes with an EIP-2612 permit in a single transaction", async function () {
        const { staking, token, owner } = await loadFixture(fundedFixture);
        const [, , , , carol] = await ethers.getSigners();
        await token.connect(owner).mint(carol.address, E(100));

        const amount = E(100);
        const deadline = BigInt(await time.latest()) + 3600n;
        const { chainId } = await ethers.provider.getNetwork();
        const signature = await carol.signTypedData(
            { name: "DApp.io", version: "1", chainId, verifyingContract: await token.getAddress() },
            {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            },
            {
                owner: carol.address,
                spender: await staking.getAddress(),
                value: amount,
                nonce: await token.nonces(carol.address),
                deadline,
            }
        );
        const { v, r, s } = ethers.Signature.from(signature);
        await staking.connect(carol).stakeWithPermit(amount, 3, deadline, v, r, s);
        expect(await staking.totalStaked()).to.equal(amount);
        expect(await token.balanceOf(carol.address)).to.equal(0);
    });

    it("pauses new stakes but never unstaking", async function () {
        const { staking, alice } = await loadFixture(fundedFixture);
        await staking.connect(alice).stake(E(100), 3);
        await staking.pause();
        await expect(staking.connect(alice).stake(E(100), 3)).to.be.revertedWithCustomError(
            staking,
            "EnforcedPause"
        );
        await time.increase(3n * MONTH);
        await staking.connect(alice).unstake(0);
    });

    it("cannot recover the staking token through recoverERC20", async function () {
        const { staking, token, owner } = await loadFixture(fundedFixture);
        await expect(
            staking.recoverERC20(await token.getAddress(), 1, owner.address)
        ).to.be.revertedWithCustomError(staking, "CannotRecoverStakingToken");
    });

    it("rejects zero amounts", async function () {
        const { staking, alice } = await loadFixture(fundedFixture);
        await expect(staking.connect(alice).stake(0, 3)).to.be.revertedWithCustomError(staking, "ZeroAmount");
        await expect(staking.connect(alice).fundRewards(0)).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });
});

describe("DAppToken", function () {
    it("only lets MINTER_ROLE mint, up to MAX_SUPPLY", async function () {
        const { token, alice, owner } = await loadFixture(deployFixture);
        await expect(token.connect(alice).mint(alice.address, 1)).to.be.revertedWithCustomError(
            token,
            "AccessControlUnauthorizedAccount"
        );
        const max = await token.MAX_SUPPLY();
        await token.mint(owner.address, max);
        expect(await token.remainingMintable()).to.equal(0);
        await expect(token.mint(owner.address, 1))
            .to.be.revertedWithCustomError(token, "MaxSupplyExceeded")
            .withArgs(1, 0);
    });
});
