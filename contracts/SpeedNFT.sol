// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title SpeedNFT
 * @notice Mystery-egg NFTs with a farming speed between MIN_SPEED and MAX_SPEED.
 *
 * Eggs use commit-reveal: `buyEggs` pays and records the block number (commit), `hatchEggs`
 * runs in a later block and derives the speed from the hash of the commit block (reveal).
 * That hash did not exist when the egg was paid for, so the buyer can no longer simulate the
 * mint and revert until a legendary speed comes out — which the old single-transaction
 * `publicMint` allowed.
 *
 * `blockhash` only reaches back HATCH_WINDOW (256) blocks (~8.5 minutes on Polygon). An egg
 * hatched after that hatches with MIN_SPEED, so letting an egg expire is never better than
 * hatching it. Anyone can hatch any egg (the NFT always goes to the egg owner), which lets the
 * frontend or a keeper bot hatch eggs promptly.
 *
 * For stronger guarantees against block-producer manipulation, swap `_rollSpeed` for
 * Chainlink VRF.
 */
contract SpeedNFT is ERC721, ERC721Enumerable, Ownable2Step, Pausable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant MIN_SPEED = 10;
    uint256 public constant MAX_SPEED = 100;
    uint256 public constant MAX_EGGS_PER_TX = 10;
    uint256 public constant HATCH_WINDOW = 256;

    struct Egg {
        address owner;
        uint64 commitBlock;
        bool hatched;
    }

    uint256 public mintPrice = 1 ether;
    uint256 public nextEggId;
    uint256 private _nextTokenId;

    /// @notice Fixed destination of `withdrawToTreasury`, so a keeper bot can sweep sales without
    ///         holding the owner key.
    address public treasury;

    mapping(uint256 tokenId => uint256) public farmingSpeeds;
    mapping(uint256 eggId => Egg) public eggs;
    mapping(address owner => uint256[]) private _pendingEggs;
    mapping(uint256 eggId => uint256) private _pendingIndex;

    event EggsPurchased(address indexed buyer, uint256 firstEggId, uint256 quantity, uint256 paid);
    event EggHatched(uint256 indexed eggId, address indexed owner, uint256 indexed tokenId, uint256 speed, bool expired);
    event NftMinted(address indexed user, uint256 tokenId, uint256 speed);
    event MintPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event Withdrawn(address indexed to, uint256 amount);

    error InvalidQuantity();
    error InsufficientPayment(uint256 required, uint256 sent);
    error UnknownEgg(uint256 eggId);
    error EggNotReady(uint256 eggId);
    error InvalidSpeed(uint256 speed);
    error InvalidPrice();
    error NothingToWithdraw();
    error TreasuryNotSet();
    error RenounceDisabled();
    error ZeroAddress();

    constructor(address initialOwner) ERC721("Speed NFT", "SPDNFT") Ownable(initialOwner) {}

    // ------------------------------------------------------------------
    // Eggs (commit-reveal mint)
    // ------------------------------------------------------------------

    /// @notice Buy `quantity` eggs at `mintPrice` each. Excess payment is refunded.
    function buyEggs(uint256 quantity) external payable whenNotPaused nonReentrant returns (uint256 firstEggId) {
        if (quantity == 0 || quantity > MAX_EGGS_PER_TX) revert InvalidQuantity();
        uint256 cost = mintPrice * quantity;
        if (msg.value < cost) revert InsufficientPayment(cost, msg.value);

        firstEggId = nextEggId;
        uint256[] storage pending = _pendingEggs[msg.sender];
        for (uint256 i = 0; i < quantity; i++) {
            uint256 eggId = firstEggId + i;
            eggs[eggId] = Egg({owner: msg.sender, commitBlock: uint64(block.number), hatched: false});
            _pendingIndex[eggId] = pending.length;
            pending.push(eggId);
        }
        nextEggId = firstEggId + quantity;
        emit EggsPurchased(msg.sender, firstEggId, quantity, cost);

        if (msg.value > cost) Address.sendValue(payable(msg.sender), msg.value - cost);
    }

    /**
     * @notice Hatch eggs bought in an earlier block. Callable by anyone; each NFT is minted to
     *         its egg owner. Already-hatched eggs are skipped so concurrent hatchers don't fail.
     *         Hatching is never paused: the eggs were already paid for.
     */
    function hatchEggs(uint256[] calldata eggIds) external nonReentrant {
        for (uint256 i = 0; i < eggIds.length; i++) {
            _hatch(eggIds[i]);
        }
    }

    function _hatch(uint256 eggId) private {
        Egg storage egg = eggs[eggId];
        address eggOwner = egg.owner;
        if (eggOwner == address(0)) revert UnknownEgg(eggId);
        if (egg.hatched) return;
        if (block.number <= egg.commitBlock) revert EggNotReady(eggId);

        egg.hatched = true;
        _removePending(eggOwner, eggId);

        bytes32 seedHash = blockhash(egg.commitBlock);
        bool expired = seedHash == bytes32(0);
        uint256 speed = expired ? MIN_SPEED : _rollSpeed(seedHash, eggId, eggOwner);
        uint256 tokenId = _mintWithSpeed(eggOwner, speed);
        emit EggHatched(eggId, eggOwner, tokenId, speed, expired);
    }

    function _rollSpeed(bytes32 seedHash, uint256 eggId, address eggOwner) private pure returns (uint256) {
        uint256 rand = uint256(keccak256(abi.encode(seedHash, eggId, eggOwner)));
        return MIN_SPEED + (rand % (MAX_SPEED - MIN_SPEED + 1));
    }

    function _removePending(address eggOwner, uint256 eggId) private {
        uint256[] storage pending = _pendingEggs[eggOwner];
        uint256 index = _pendingIndex[eggId];
        uint256 lastEggId = pending[pending.length - 1];
        pending[index] = lastEggId;
        _pendingIndex[lastEggId] = index;
        pending.pop();
        delete _pendingIndex[eggId];
    }

    // ------------------------------------------------------------------
    // Minting
    // ------------------------------------------------------------------

    /// @notice Owner mint with a chosen speed (giveaways, partnerships). Speed stays within bounds
    ///         so the owner cannot create NFTs that farm without limit.
    function adminMint(address to, uint256 speed) external onlyOwner returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        if (speed < MIN_SPEED || speed > MAX_SPEED) revert InvalidSpeed(speed);
        return _mintWithSpeed(to, speed);
    }

    /// @dev Uses `_mint` (not `_safeMint`) so a third-party hatcher can't be blocked by a
    ///      receiver hook and no external call happens mid-hatch.
    function _mintWithSpeed(address to, uint256 speed) private returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        farmingSpeeds[tokenId] = speed;
        _mint(to, tokenId);
        emit NftMinted(to, tokenId, speed);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setMintPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert InvalidPrice();
        emit MintPriceUpdated(mintPrice, newPrice);
        mintPrice = newPrice;
    }

    function withdraw(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _withdraw(to);
    }

    /// @notice Sets where `withdrawToTreasury` sends the proceeds (ideally a multisig / cold wallet).
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /**
     * @notice Sends all proceeds to the owner-defined treasury. Callable by anyone: the caller
     *         chooses only the timing, never the destination, so a sweeper bot needs gas but no
     *         privileged key.
     */
    function withdrawToTreasury() external nonReentrant {
        address to = treasury;
        if (to == address(0)) revert TreasuryNotSet();
        _withdraw(payable(to));
    }

    function _withdraw(address payable to) private {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        Address.sendValue(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @dev An ownerless collection could never be unpaused or withdrawn; transfer ownership instead.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @notice Pauses egg sales only. Hatching, transfers and staking keep working.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getFarmingSpeed(uint256 tokenId) external view returns (uint256) {
        return farmingSpeeds[tokenId];
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice All NFTs of `owner` with their speeds, in one call.
    function tokensOfOwner(address owner) external view returns (uint256[] memory ids, uint256[] memory speeds) {
        uint256 count = balanceOf(owner);
        ids = new uint256[](count);
        speeds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(owner, i);
            ids[i] = tokenId;
            speeds[i] = farmingSpeeds[tokenId];
        }
    }

    /// @notice Eggs of `owner` that were bought but not hatched yet.
    function pendingEggsOf(address owner) external view returns (uint256[] memory eggIds, uint256[] memory commitBlocks) {
        uint256[] storage pending = _pendingEggs[owner];
        eggIds = new uint256[](pending.length);
        commitBlocks = new uint256[](pending.length);
        for (uint256 i = 0; i < pending.length; i++) {
            eggIds[i] = pending[i];
            commitBlocks[i] = eggs[pending[i]].commitBlock;
        }
    }

    function rarityOf(uint256 speed) public pure returns (string memory) {
        if (speed >= 90) return "Legendary";
        if (speed >= 70) return "Epic";
        if (speed >= 40) return "Rare";
        return "Common";
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 speed = farmingSpeeds[tokenId];
        string memory rarity = rarityOf(speed);
        string memory json = string.concat(
            '{"name":"Speed NFT #',
            tokenId.toString(),
            '","description":"Farming NFT with speed ',
            speed.toString(),
            '. Stake it in the DApp NFT Farm to earn DAPPF.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(tokenId, speed, rarity))),
            '","attributes":[{"display_type":"number","trait_type":"Speed","value":',
            speed.toString(),
            ',"max_value":100},{"trait_type":"Rarity","value":"',
            rarity,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev Mirrored in src/lib/nft.ts so the frontend renders the same art without RPC calls.
    function _svg(uint256 tokenId, uint256 speed, string memory rarity) private pure returns (string memory) {
        string memory color = _rarityColor(speed);
        string memory art = string.concat(
            '<svg width="350" height="350" viewBox="0 0 350 350" xmlns="http://www.w3.org/2000/svg">',
            '<defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
            '<stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>',
            '<filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/>',
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
            '<rect width="350" height="350" fill="url(#bg)"/>',
            '<g transform="translate(175,155)" filter="url(#glow)">',
            '<circle r="80" fill="none" stroke="',
            color,
            '" stroke-width="3" opacity="0.3"/>'
        );
        art = string.concat(
            art,
            '<path d="M-40,-40 L-30,-50 L-50,-30 Z M40,-40 L50,-30 L30,-50 Z M40,40 L30,50 L50,30 Z M-40,40 L-50,30 L-30,50 Z" fill="',
            color,
            '"/><circle r="60" fill="none" stroke="',
            color,
            '" stroke-width="8"/><circle r="20" fill="',
            color,
            '"/></g>'
        );
        return string.concat(
            art,
            '<text x="175" y="280" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="#ffffff">#',
            tokenId.toString(),
            '</text><text x="175" y="308" text-anchor="middle" font-family="sans-serif" font-size="16" fill="',
            color,
            '">SPEED ',
            speed.toString(),
            " | ",
            rarity,
            "</text></svg>"
        );
    }

    function _rarityColor(uint256 speed) private pure returns (string memory) {
        if (speed >= 90) return "#f59e0b";
        if (speed >= 70) return "#a855f7";
        if (speed >= 40) return "#3b82f6";
        return "#94a3b8";
    }

    // ------------------------------------------------------------------
    // Required overrides
    // ------------------------------------------------------------------

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
