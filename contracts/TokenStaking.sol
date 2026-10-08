// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenStaking
 * @notice Fixed-term DAPPF staking. Reward = principal * APR * months / 12, fixed when the stake
 *         is opened and paid together with the principal when the lock ends.
 *
 * Solvency: every stake reserves its reward from the reward pool when it is opened, and a stake
 * whose reward the pool can't cover is rejected. The owner can only withdraw the unreserved
 * part of the pool, never user principal or promised rewards — the previous
 * `emergencyWithdraw` could drain both.
 */
contract TokenStaking is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    struct StakeInfo {
        uint128 amount;
        uint128 reward;
        uint64 startTime;
        uint64 endTime;
        uint8 lockMonths;
        bool withdrawn;
    }

    uint256 public constant MONTH = 30 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_APR_BPS = 10_000;
    uint8 public constant MAX_LOCK_MONTHS = 36;

    IERC20 public immutable stakingToken;

    mapping(address user => mapping(uint256 stakeId => StakeInfo)) public stakes;
    mapping(address user => uint256) public stakeCount;

    /// @notice APR in basis points for each lock period in months. 0 means the plan is disabled.
    mapping(uint8 lockMonths => uint256) public aprBps;
    uint8[] private _planMonths;

    uint256 public totalStaked;
    uint256 public totalRewardsReserved;
    uint256 public activeStakes;
    mapping(uint8 lockMonths => uint256) public stakedByPeriod;

    event Staked(address indexed user, uint256 indexed stakeId, uint256 amount, uint256 lockMonths, uint256 reward, uint256 endTime);
    event Unstaked(address indexed user, uint256 indexed stakeId, uint256 principal, uint256 reward);
    event RewardsFunded(address indexed from, uint256 amount);
    event RewardsWithdrawn(address indexed to, uint256 amount);
    event PlanUpdated(uint8 lockMonths, uint256 aprBps);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidPlan(uint8 lockMonths);
    error InvalidLockPeriod(uint8 lockMonths);
    error AprTooHigh(uint256 aprBps, uint256 max);
    error StakeNotFound(uint256 stakeId);
    error AlreadyWithdrawn(uint256 stakeId);
    error StillLocked(uint256 stakeId, uint256 endTime);
    error InsufficientRewardPool(uint256 required, uint256 available);
    error CannotRecoverStakingToken();
    error RenounceDisabled();

    constructor(address stakingToken_, address initialOwner) Ownable(initialOwner) {
        if (stakingToken_ == address(0)) revert ZeroAddress();
        stakingToken = IERC20(stakingToken_);
        // 22% APR prorated by lock length: 5.5% for 3 months, 11% for 6, 22% for 12.
        _setPlan(3, 2200);
        _setPlan(6, 2200);
        _setPlan(12, 2200);
    }

    // ------------------------------------------------------------------
    // User actions
    // ------------------------------------------------------------------

    function stake(uint256 amount, uint8 lockMonths) external whenNotPaused nonReentrant returns (uint256) {
        return _stake(msg.sender, amount, lockMonths);
    }

    /// @notice Approve (EIP-2612 signature) and stake in a single transaction.
    function stakeWithPermit(uint256 amount, uint8 lockMonths, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        // If someone front-runs the permit the allowance is already set, so a failure here is
        // ignored and the transfer below decides.
        try IERC20Permit(address(stakingToken)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        return _stake(msg.sender, amount, lockMonths);
    }

    /// @notice Withdraw principal + reward of a stake whose lock has ended. Never paused.
    function unstake(uint256 stakeId) external nonReentrant {
        stakingToken.safeTransfer(msg.sender, _close(msg.sender, stakeId));
    }

    /// @notice Withdraw several unlocked stakes in one transaction.
    function unstakeMany(uint256[] calldata stakeIds) external nonReentrant {
        if (stakeIds.length == 0) revert ZeroAmount();
        uint256 payout;
        for (uint256 i = 0; i < stakeIds.length; i++) {
            payout += _close(msg.sender, stakeIds[i]);
        }
        stakingToken.safeTransfer(msg.sender, payout);
    }

    /// @notice Add tokens to the reward pool. Anyone can fund it.
    function fundRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardsFunded(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @notice Withdraw unreserved reward-pool tokens. Principal and promised rewards are untouchable.
    function withdrawRewardPool(uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 pool = rewardPool();
        if (amount > pool) revert InsufficientRewardPool(amount, pool);
        stakingToken.safeTransfer(to, amount);
        emit RewardsWithdrawn(to, amount);
    }

    /// @notice Create or update a plan. Applies to new stakes only. `newAprBps = 0` disables it.
    function setPlan(uint8 lockMonths, uint256 newAprBps) external onlyOwner {
        _setPlan(lockMonths, newAprBps);
    }

    /// @notice Pauses new stakes only. Unstaking always works.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Recover other ERC20 tokens sent here by mistake.
    function recoverERC20(address token, uint256 amount, address to) external onlyOwner {
        if (token == address(stakingToken)) revert CannotRecoverStakingToken();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @dev An ownerless contract could never be unpaused or funded by plan changes; transfer instead.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Tokens available to back new stakes (balance minus principal and reserved rewards).
    function rewardPool() public view returns (uint256) {
        uint256 balance = stakingToken.balanceOf(address(this));
        uint256 committed = totalStaked + totalRewardsReserved;
        return balance > committed ? balance - committed : 0;
    }

    function quoteReward(uint256 amount, uint8 lockMonths) public view returns (uint256) {
        return (amount * aprBps[lockMonths] * lockMonths) / (12 * BPS);
    }

    function getPlans() external view returns (uint8[] memory months, uint256[] memory aprs) {
        months = _planMonths;
        aprs = new uint256[](months.length);
        for (uint256 i = 0; i < months.length; i++) {
            aprs[i] = aprBps[months[i]];
        }
    }

    function getActiveStakes(address user)
        external
        view
        returns (
            uint256[] memory stakeIds,
            uint256[] memory amounts,
            uint256[] memory startTimes,
            uint256[] memory endTimes,
            uint256[] memory lockMonths,
            uint256[] memory rewards
        )
    {
        uint256 count = stakeCount[user];
        uint256 activeCount;
        for (uint256 i = 0; i < count; i++) {
            if (!stakes[user][i].withdrawn) activeCount++;
        }

        stakeIds = new uint256[](activeCount);
        amounts = new uint256[](activeCount);
        startTimes = new uint256[](activeCount);
        endTimes = new uint256[](activeCount);
        lockMonths = new uint256[](activeCount);
        rewards = new uint256[](activeCount);

        uint256 index;
        for (uint256 i = 0; i < count; i++) {
            StakeInfo storage info = stakes[user][i];
            if (info.withdrawn) continue;
            stakeIds[index] = i;
            amounts[index] = info.amount;
            startTimes[index] = info.startTime;
            endTimes[index] = info.endTime;
            lockMonths[index] = info.lockMonths;
            rewards[index] = info.reward;
            index++;
        }
    }

    function canUnstake(address user, uint256 stakeId) external view returns (bool) {
        StakeInfo storage info = stakes[user][stakeId];
        return info.amount > 0 && !info.withdrawn && block.timestamp >= info.endTime;
    }

    function getTimeRemaining(address user, uint256 stakeId) external view returns (uint256) {
        uint256 endTime = stakes[user][stakeId].endTime;
        return block.timestamp >= endTime ? 0 : endTime - block.timestamp;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _stake(address account, uint256 amount, uint8 lockMonths) private returns (uint256 stakeId) {
        if (amount == 0) revert ZeroAmount();
        if (aprBps[lockMonths] == 0) revert InvalidPlan(lockMonths);

        uint256 reward = quoteReward(amount, lockMonths);
        uint256 pool = rewardPool();
        if (reward > pool) revert InsufficientRewardPool(reward, pool);

        stakeId = stakeCount[account]++;
        uint256 endTime = block.timestamp + uint256(lockMonths) * MONTH;
        stakes[account][stakeId] = StakeInfo({
            amount: amount.toUint128(),
            reward: reward.toUint128(),
            startTime: block.timestamp.toUint64(),
            endTime: endTime.toUint64(),
            lockMonths: lockMonths,
            withdrawn: false
        });
        totalStaked += amount;
        totalRewardsReserved += reward;
        activeStakes++;
        stakedByPeriod[lockMonths] += amount;
        emit Staked(account, stakeId, amount, lockMonths, reward, endTime);

        stakingToken.safeTransferFrom(account, address(this), amount);
    }

    function _close(address account, uint256 stakeId) private returns (uint256 payout) {
        StakeInfo storage info = stakes[account][stakeId];
        if (info.amount == 0) revert StakeNotFound(stakeId);
        if (info.withdrawn) revert AlreadyWithdrawn(stakeId);
        if (block.timestamp < info.endTime) revert StillLocked(stakeId, info.endTime);

        info.withdrawn = true;
        totalStaked -= info.amount;
        totalRewardsReserved -= info.reward;
        activeStakes--;
        stakedByPeriod[info.lockMonths] -= info.amount;
        emit Unstaked(account, stakeId, info.amount, info.reward);
        return uint256(info.amount) + info.reward;
    }

    function _setPlan(uint8 lockMonths, uint256 newAprBps) private {
        if (lockMonths == 0 || lockMonths > MAX_LOCK_MONTHS) revert InvalidLockPeriod(lockMonths);
        if (newAprBps > MAX_APR_BPS) revert AprTooHigh(newAprBps, MAX_APR_BPS);

        bool known;
        for (uint256 i = 0; i < _planMonths.length; i++) {
            if (_planMonths[i] == lockMonths) {
                known = true;
                break;
            }
        }
        if (!known) _planMonths.push(lockMonths);

        aprBps[lockMonths] = newAprBps;
        emit PlanUpdated(lockMonths, newAprBps);
    }
}
