require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Use a dedicated deployer wallet. Never commit .env — see .env.example.
const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: { enabled: true, runs: 200 },
            evmVersion: "cancun",
        },
    },
    networks: {
        localhost: {
            url: "http://127.0.0.1:8545",
        },
        // Polygon Amoy testnet (Mumbai was shut down in April 2024)
        amoy: {
            url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
            chainId: 80002,
            accounts,
        },
        polygon: {
            url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
            chainId: 137,
            accounts,
        },
    },
    etherscan: {
        // Etherscan API v2: one key works for Polygon and Amoy
        apiKey: process.env.POLYGONSCAN_API_KEY || "",
    },
    gasReporter: {
        enabled: Boolean(process.env.REPORT_GAS),
        currency: "USD",
    },
};
