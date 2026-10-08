// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

/**
 * @title DApp.io Token (DAPPF)
 * @notice Reward token of the farm. Supply is hard-capped and only MINTER_ROLE (the NFTFarm)
 *         can mint. ERC20Permit lets users approve + stake in a single transaction.
 *
 * The admin role follows AccessControlDefaultAdminRules: there is exactly one admin, and it
 * changes only through `beginDefaultAdminTransfer` + `acceptDefaultAdminTransfer`, so a typo in
 * the new admin's address can't lose control of the token (the same two-step guarantee that
 * Ownable2Step gives the other contracts).
 */
contract DAppToken is ERC20, ERC20Permit, AccessControlDefaultAdminRules {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_SUPPLY = 400_000_000_000 * 10 ** 18;

    error MaxSupplyExceeded(uint256 requested, uint256 available);

    constructor(address admin)
        ERC20("DApp.io", "DAPPF")
        ERC20Permit("DApp.io")
        AccessControlDefaultAdminRules(0, admin)
    {}

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) revert MaxSupplyExceeded(amount, available);
        _mint(to, amount);
    }

    /// @notice How many tokens can still be minted before hitting MAX_SUPPLY.
    function remainingMintable() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}
