// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMintableToken {
    function mint(address to, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function MAX_SUPPLY() external view returns (uint256);
}

interface ISpeedNFT is IERC721 {
    function getFarmingSpeed(uint256 tokenId) external view returns (uint256);
}

/**
 * @title NFTFarm
 * @notice Stake SpeedNFTs to farm DAPPF. Each speed unit earns `rewardRate` wei per second.
 *
 * Rewards are tracked with a cumulative accumulator (`accRewardPerSpeed`), so:
 *  - changing `rewardRate` only affects time after the change (no retroactive edits),
 *  - stake / withdraw / claim are O(1) per user regardless of how many NFTs they hold,
 *  - stake, withdraw and claim work in batches (one signature instead of one per NFT).
 *
 * Users can always get their NFTs back: `withdraw` keeps working while paused (rewards stay
 * owed), and `emergencyWithdraw` never touches the reward token, so a revoked minter role or a
 * reached MAX_SUPPLY can't lock NFTs in the farm.
 */
contract NFTFarm is Ownable2Step, Pausable, ReentrancyGuard {
    struct UserInfo {
        uint256 speed; // sum of the speeds of the user's staked NFTs
        uint256 rewardDebt; // speed * accRewardPerSpeed at the user's last update
        uint256 owed; // harvested rewards not paid yet
    }

    /// @notice Upper bound for `rewardRate` to prevent fat-finger configuration.
    uint256 public constant MAX_REWARD_RATE = 1e16;
    uint256 public constant MAX_BATCH = 50;

    IMintableToken public immutable rewardToken;
    ISpeedNFT public immutable nftCollection;

    /// @notice Reward in wei per speed unit per second.
    uint256 public rewardRate;
    uint256 public accRewardPerSpeed;
    uint256 public lastUpdate;
    uint256 public totalSpeedStaked;
    uint256 public totalStaked;

    mapping(address account => UserInfo) public users;
    mapping(uint256 tokenId => address) public stakedBy;
    mapping(uint256 tokenId => uint256) public stakedSpeed;
    mapping(address account => uint256[]) private _userTokens;
    mapping(uint256 tokenId => uint256) private _tokenIndex;

    event Staked(address indexed user, uint256 indexed tokenId, uint256 speed);
    event Withdrawn(address indexed user, uint256 indexed tokenId);
    event RewardClaimed(address indexed user, uint256 reward);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event NFTRecovered(address indexed collection, uint256 indexed tokenId, address indexed to);

    error ZeroAddress();
    error EmptyBatch();
    error BatchTooLarge(uint256 size, uint256 max);
    error NotStaker(uint256 tokenId);
    error ZeroSpeed(uint256 tokenId);
    error RateTooHigh(uint256 rate, uint256 max);
    error NothingToClaim();
    error CannotRecoverStaked(uint256 tokenId);

    constructor(address rewardToken_, address nftCollection_, uint256 rewardRate_, address initialOwner)
        Ownable(initialOwner)
    {
        if (rewardToken_ == address(0) || nftCollection_ == address(0)) revert ZeroAddress();
        if (rewardRate_ > MAX_REWARD_RATE) revert RateTooHigh(rewardRate_, MAX_REWARD_RATE);
        rewardToken = IMintableToken(rewardToken_);
        nftCollection = ISpeedNFT(nftCollection_);
        rewardRate = rewardRate_;
        lastUpdate = block.timestamp;
    }

    // ------------------------------------------------------------------
    // User actions
    // ------------------------------------------------------------------

    /// @notice Stake NFTs. The farm must be approved (`setApprovalForAll` or `approve`).
    function stake(uint256[] calldata tokenIds) external whenNotPaused nonReentrant {
        _checkBatch(tokenIds.length);
        UserInfo storage user = _harvest(msg.sender);
        uint256[] storage owned = _userTokens[msg.sender];

        uint256 addedSpeed;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            // Reverts unless msg.sender owns the token and approved the farm.
            nftCollection.transferFrom(msg.sender, address(this), tokenId);
            uint256 speed = nftCollection.getFarmingSpeed(tokenId);
            if (speed == 0) revert ZeroSpeed(tokenId);

            stakedBy[tokenId] = msg.sender;
            stakedSpeed[tokenId] = speed;
            _tokenIndex[tokenId] = owned.length;
            owned.push(tokenId);
            addedSpeed += speed;
            emit Staked(msg.sender, tokenId, speed);
        }

        user.speed += addedSpeed;
        user.rewardDebt = user.speed * accRewardPerSpeed;
        totalSpeedStaked += addedSpeed;
        totalStaked += tokenIds.length;
    }

    /// @notice Unstake NFTs and claim rewards. While paused, NFTs are returned and rewards stay owed.
    function withdraw(uint256[] calldata tokenIds) external nonReentrant {
        _unstake(msg.sender, tokenIds);
        if (!paused()) _payOwed(msg.sender);
    }

    /// @notice Unstake NFTs without calling the reward token. Rewards stay owed and can be
    ///         claimed later with `claimAll`.
    function emergencyWithdraw(uint256[] calldata tokenIds) external nonReentrant {
        _unstake(msg.sender, tokenIds);
    }

    function claimAll() external whenNotPaused nonReentrant {
        _harvest(msg.sender);
        if (_payOwed(msg.sender) == 0) revert NothingToClaim();
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @notice Changes the rate for the future only; rewards accrued so far are kept.
    function setRewardRate(uint256 newRate) external onlyOwner {
        if (newRate > MAX_REWARD_RATE) revert RateTooHigh(newRate, MAX_REWARD_RATE);
        _updatePool();
        emit RewardRateUpdated(rewardRate, newRate);
        rewardRate = newRate;
    }

    /// @notice Pauses new stakes and claims. Rewards keep accruing (use `setRewardRate(0)` to stop
    ///         emissions) and withdrawals always work.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Returns an NFT sent to the farm by mistake with `transferFrom`. Staked NFTs can't
    ///         be touched.
    function recoverERC721(address collection, uint256 tokenId, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (collection == address(nftCollection) && stakedBy[tokenId] != address(0)) {
            revert CannotRecoverStaked(tokenId);
        }
        IERC721(collection).transferFrom(address(this), to, tokenId);
        emit NFTRecovered(collection, tokenId, to);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function pendingRewards(address account) public view returns (uint256) {
        UserInfo storage user = users[account];
        return user.owed + user.speed * _currentAcc() - user.rewardDebt;
    }

    function getStakedTokens(address account) external view returns (uint256[] memory) {
        return _userTokens[account];
    }

    /// @notice Everything the dashboard needs about a user, in one call.
    function getUserInfo(address account)
        external
        view
        returns (
            uint256[] memory tokenIds,
            uint256[] memory speeds,
            uint256 totalSpeed,
            uint256 pending,
            uint256 rewardPerSecond
        )
    {
        tokenIds = _userTokens[account];
        speeds = new uint256[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            speeds[i] = stakedSpeed[tokenIds[i]];
        }
        totalSpeed = users[account].speed;
        pending = pendingRewards(account);
        rewardPerSecond = totalSpeed * rewardRate;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _unstake(address account, uint256[] calldata tokenIds) private {
        _checkBatch(tokenIds.length);
        UserInfo storage user = _harvest(account);

        uint256 removedSpeed;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (stakedBy[tokenId] != account) revert NotStaker(tokenId);
            removedSpeed += stakedSpeed[tokenId];
            delete stakedBy[tokenId];
            delete stakedSpeed[tokenId];
            _removeUserToken(account, tokenId);
            emit Withdrawn(account, tokenId);
        }

        user.speed -= removedSpeed;
        user.rewardDebt = user.speed * accRewardPerSpeed;
        totalSpeedStaked -= removedSpeed;
        totalStaked -= tokenIds.length;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            nftCollection.transferFrom(address(this), account, tokenIds[i]);
        }
    }

    function _harvest(address account) private returns (UserInfo storage user) {
        _updatePool();
        user = users[account];
        if (user.speed > 0) {
            user.owed += user.speed * accRewardPerSpeed - user.rewardDebt;
            user.rewardDebt = user.speed * accRewardPerSpeed;
        }
    }

    /// @dev Pays what is owed, capped by the token's remaining mintable supply so claims and
    ///      withdrawals never revert because MAX_SUPPLY was reached.
    function _payOwed(address account) private returns (uint256 paid) {
        UserInfo storage user = users[account];
        uint256 owed = user.owed;
        if (owed == 0) return 0;

        uint256 mintable = rewardToken.MAX_SUPPLY() - rewardToken.totalSupply();
        paid = owed < mintable ? owed : mintable;
        if (paid == 0) return 0;

        user.owed = owed - paid;
        rewardToken.mint(account, paid);
        emit RewardClaimed(account, paid);
    }

    function _updatePool() private {
        if (block.timestamp > lastUpdate) {
            accRewardPerSpeed = _currentAcc();
            lastUpdate = block.timestamp;
        }
    }

    function _currentAcc() private view returns (uint256) {
        if (block.timestamp <= lastUpdate) return accRewardPerSpeed;
        return accRewardPerSpeed + rewardRate * (block.timestamp - lastUpdate);
    }

    function _removeUserToken(address account, uint256 tokenId) private {
        uint256[] storage owned = _userTokens[account];
        uint256 index = _tokenIndex[tokenId];
        uint256 lastTokenId = owned[owned.length - 1];
        owned[index] = lastTokenId;
        _tokenIndex[lastTokenId] = index;
        owned.pop();
        delete _tokenIndex[tokenId];
    }

    function _checkBatch(uint256 size) private pure {
        if (size == 0) revert EmptyBatch();
        if (size > MAX_BATCH) revert BatchTooLarge(size, MAX_BATCH);
    }
}
