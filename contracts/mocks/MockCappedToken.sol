// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only reward token with a tiny cap, used to exercise NFTFarm's MAX_SUPPLY handling.
contract MockCappedToken is ERC20 {
    uint256 public immutable MAX_SUPPLY;

    constructor(uint256 maxSupply) ERC20("Mock", "MOCK") {
        MAX_SUPPLY = maxSupply;
    }

    function mint(address to, uint256 amount) external {
        require(totalSupply() + amount <= MAX_SUPPLY, "cap");
        _mint(to, amount);
    }
}
