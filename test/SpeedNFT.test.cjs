const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./fixtures.cjs");

const PRICE = ethers.parseEther("1");

async function hatchedEvents(nft, receipt) {
    return receipt.logs
        .map((l) => {
            try {
                return nft.interface.parseLog(l);
            } catch {
                return null;
            }
        })
        .filter((e) => e && e.name === "EggHatched");
}

describe("SpeedNFT", function () {
    describe("buyEggs", function () {
        it("records pending eggs and emits EggsPurchased", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await expect(nft.connect(alice).buyEggs(3, { value: PRICE * 3n }))
                .to.emit(nft, "EggsPurchased")
                .withArgs(alice.address, 0, 3, PRICE * 3n);

            const [eggIds] = await nft.pendingEggsOf(alice.address);
            expect(eggIds.map(Number)).to.deep.equal([0, 1, 2]);
            expect(await nft.nextEggId()).to.equal(3);
            expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(PRICE * 3n);
        });

        it("refunds excess payment", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await expect(nft.connect(alice).buyEggs(1, { value: PRICE * 2n })).to.changeEtherBalances(
                [alice, nft],
                [-PRICE, PRICE]
            );
        });

        it("rejects insufficient payment and invalid quantities", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await expect(nft.connect(alice).buyEggs(2, { value: PRICE }))
                .to.be.revertedWithCustomError(nft, "InsufficientPayment")
                .withArgs(PRICE * 2n, PRICE);
            await expect(nft.connect(alice).buyEggs(0)).to.be.revertedWithCustomError(nft, "InvalidQuantity");
            await expect(nft.connect(alice).buyEggs(11, { value: PRICE * 11n })).to.be.revertedWithCustomError(
                nft,
                "InvalidQuantity"
            );
        });

        it("can be paused by the owner only", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await expect(nft.connect(alice).pause()).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
            await nft.pause();
            await expect(nft.connect(alice).buyEggs(1, { value: PRICE })).to.be.revertedWithCustomError(
                nft,
                "EnforcedPause"
            );
        });
    });

    describe("hatchEggs", function () {
        it("cannot hatch in the same block the egg was bought", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await network.provider.send("evm_setAutomine", [false]);
            try {
                const buy = await nft.connect(alice).buyEggs(1, { value: PRICE, gasLimit: 500_000 });
                const hatch = await nft.connect(alice).hatchEggs([0], { gasLimit: 500_000 });
                await mine();
                expect((await buy.wait()).status).to.equal(1);
                await expect(hatch.wait()).to.be.rejected;
            } finally {
                await network.provider.send("evm_setAutomine", [true]);
            }
            expect(await nft.balanceOf(alice.address)).to.equal(0);
        });

        it("mints an NFT with speed within bounds in a later block", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await nft.connect(alice).buyEggs(1, { value: PRICE });
            const receipt = await (await nft.connect(alice).hatchEggs([0])).wait();
            const [event] = await hatchedEvents(nft, receipt);

            expect(event.args.owner).to.equal(alice.address);
            expect(event.args.expired).to.equal(false);
            const speed = event.args.speed;
            expect(speed).to.be.gte(10n).and.lte(100n);
            expect(await nft.ownerOf(event.args.tokenId)).to.equal(alice.address);
            expect(await nft.getFarmingSpeed(event.args.tokenId)).to.equal(speed);

            const [pending] = await nft.pendingEggsOf(alice.address);
            expect(pending.length).to.equal(0);
        });

        it("lets anyone hatch, but the NFT always goes to the egg owner", async function () {
            const { nft, alice, keeper } = await loadFixture(deployFixture);
            await nft.connect(alice).buyEggs(2, { value: PRICE * 2n });
            await nft.connect(keeper).hatchEggs([0, 1]);
            expect(await nft.balanceOf(alice.address)).to.equal(2);
            expect(await nft.balanceOf(keeper.address)).to.equal(0);
        });

        it("skips eggs that were already hatched", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await nft.connect(alice).buyEggs(2, { value: PRICE * 2n });
            await nft.connect(alice).hatchEggs([0]);
            await nft.connect(alice).hatchEggs([0, 1]);
            expect(await nft.balanceOf(alice.address)).to.equal(2);
            expect(await nft.totalMinted()).to.equal(2);
        });

        it("reverts for unknown eggs", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await expect(nft.connect(alice).hatchEggs([42]))
                .to.be.revertedWithCustomError(nft, "UnknownEgg")
                .withArgs(42);
        });

        it("hatches expired eggs with the minimum speed", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await nft.connect(alice).buyEggs(1, { value: PRICE });
            await mine(300);
            const receipt = await (await nft.connect(alice).hatchEggs([0])).wait();
            const [event] = await hatchedEvents(nft, receipt);
            expect(event.args.expired).to.equal(true);
            expect(event.args.speed).to.equal(10n);
        });

        it("keeps working while egg sales are paused", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await nft.connect(alice).buyEggs(1, { value: PRICE });
            await nft.pause();
            await nft.connect(alice).hatchEggs([0]);
            expect(await nft.balanceOf(alice.address)).to.equal(1);
        });

        it("produces varied speeds across many eggs", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            for (let i = 0; i < 5; i++) {
                await nft.connect(alice).buyEggs(10, { value: PRICE * 10n });
            }
            const ids = Array.from({ length: 50 }, (_, i) => i);
            await nft.connect(alice).hatchEggs(ids);
            const [, speeds] = await nft.tokensOfOwner(alice.address);
            const unique = new Set(speeds.map(Number));
            expect(speeds.length).to.equal(50);
            expect(unique.size).to.be.greaterThan(10);
            for (const s of speeds) expect(s).to.be.gte(10n).and.lte(100n);
        });
    });

    describe("admin", function () {
        it("adminMint enforces speed bounds and ownership", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await expect(nft.connect(alice).adminMint(alice.address, 50)).to.be.revertedWithCustomError(
                nft,
                "OwnableUnauthorizedAccount"
            );
            await expect(nft.adminMint(alice.address, 101))
                .to.be.revertedWithCustomError(nft, "InvalidSpeed")
                .withArgs(101);
            await expect(nft.adminMint(alice.address, 9)).to.be.revertedWithCustomError(nft, "InvalidSpeed");
            await nft.adminMint(alice.address, 100);
            expect(await nft.getFarmingSpeed(0)).to.equal(100);
        });

        it("withdraws sales to the chosen address", async function () {
            const { nft, alice, bob, owner } = await loadFixture(deployFixture);
            await nft.connect(alice).buyEggs(2, { value: PRICE * 2n });
            await expect(nft.connect(alice).withdraw(alice.address)).to.be.revertedWithCustomError(
                nft,
                "OwnableUnauthorizedAccount"
            );
            await expect(nft.connect(owner).withdraw(bob.address)).to.changeEtherBalances(
                [nft, bob],
                [-PRICE * 2n, PRICE * 2n]
            );
            await expect(nft.withdraw(bob.address)).to.be.revertedWithCustomError(nft, "NothingToWithdraw");
        });

        it("updates the mint price", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            const newPrice = ethers.parseEther("2.5");
            await expect(nft.setMintPrice(newPrice)).to.emit(nft, "MintPriceUpdated").withArgs(PRICE, newPrice);
            await expect(nft.setMintPrice(0)).to.be.revertedWithCustomError(nft, "InvalidPrice");
            await expect(nft.connect(alice).buyEggs(1, { value: PRICE })).to.be.revertedWithCustomError(
                nft,
                "InsufficientPayment"
            );
        });

        it("uses two-step ownership transfers and cannot be renounced", async function () {
            const { nft, alice, owner } = await loadFixture(deployFixture);
            await expect(nft.renounceOwnership()).to.be.revertedWithCustomError(nft, "RenounceDisabled");
            await nft.transferOwnership(alice.address);
            expect(await nft.owner()).to.equal(owner.address);
            await nft.connect(alice).acceptOwnership();
            expect(await nft.owner()).to.equal(alice.address);
        });

        it("lets anyone sweep proceeds, but only to the owner-defined treasury", async function () {
            const { nft, alice, bob, keeper } = await loadFixture(deployFixture);
            await nft.connect(alice).buyEggs(2, { value: PRICE * 2n });
            await expect(nft.connect(keeper).withdrawToTreasury()).to.be.revertedWithCustomError(nft, "TreasuryNotSet");
            await expect(nft.connect(alice).setTreasury(bob.address)).to.be.revertedWithCustomError(
                nft,
                "OwnableUnauthorizedAccount"
            );
            await expect(nft.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(nft, "ZeroAddress");
            await expect(nft.setTreasury(bob.address)).to.emit(nft, "TreasuryUpdated").withArgs(ethers.ZeroAddress, bob.address);

            await expect(nft.connect(keeper).withdrawToTreasury()).to.changeEtherBalances(
                [nft, bob, keeper],
                [-PRICE * 2n, PRICE * 2n, 0n]
            );
            await expect(nft.connect(keeper).withdrawToTreasury()).to.be.revertedWithCustomError(nft, "NothingToWithdraw");
        });
    });

    describe("metadata", function () {
        it("returns on-chain JSON with image and rarity", async function () {
            const { nft, alice } = await loadFixture(deployFixture);
            await nft.adminMint(alice.address, 95);
            const uri = await nft.tokenURI(0);
            expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
            const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
            expect(json.name).to.equal("Speed NFT #0");
            expect(json.image.startsWith("data:image/svg+xml;base64,")).to.equal(true);
            expect(json.attributes).to.deep.include({ trait_type: "Rarity", value: "Legendary" });
            const svg = Buffer.from(json.image.split(",")[1], "base64").toString();
            expect(svg).to.contain("SPEED 95 | Legendary");
        });

        it("classifies rarity tiers", async function () {
            const { nft } = await loadFixture(deployFixture);
            expect(await nft.rarityOf(10)).to.equal("Common");
            expect(await nft.rarityOf(40)).to.equal("Rare");
            expect(await nft.rarityOf(70)).to.equal("Epic");
            expect(await nft.rarityOf(90)).to.equal("Legendary");
        });

        it("reverts tokenURI for nonexistent tokens", async function () {
            const { nft } = await loadFixture(deployFixture);
            await expect(nft.tokenURI(7)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
        });
    });
});
