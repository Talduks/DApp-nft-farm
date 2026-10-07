import { isAddress } from 'ethers';

const env = import.meta.env;

interface ChainPreset {
  name: string;
  rpcUrl: string;
  explorer: string;
  currency: string;
}

const CHAIN_PRESETS: Record<number, ChainPreset> = {
  137: { name: 'Polygon', rpcUrl: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com', currency: 'POL' },
  80002: {
    name: 'Polygon Amoy',
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    explorer: 'https://amoy.polygonscan.com',
    currency: 'POL',
  },
  31337: { name: 'Hardhat Local', rpcUrl: 'http://127.0.0.1:8545', explorer: '', currency: 'ETH' },
};

const chainId = Number(env.VITE_CHAIN_ID || 137);
const preset = CHAIN_PRESETS[chainId] ?? CHAIN_PRESETS[137];

export const CHAIN = {
  id: chainId,
  hexId: `0x${chainId.toString(16)}`,
  name: env.VITE_CHAIN_NAME || preset.name,
  rpcUrl: env.VITE_RPC_URL || preset.rpcUrl,
  explorer: env.VITE_EXPLORER_URL ?? preset.explorer,
  currency: preset.currency,
};

export const CONTRACTS = {
  token: env.VITE_TOKEN_ADDRESS ?? '',
  nft: env.VITE_NFT_ADDRESS ?? '',
  farm: env.VITE_FARM_ADDRESS ?? '',
  staking: env.VITE_STAKING_ADDRESS ?? '',
};

export type ContractName = keyof typeof CONTRACTS;

export const MISSING_CONTRACTS = (Object.keys(CONTRACTS) as ContractName[]).filter(
  (name) => !isAddress(CONTRACTS[name]),
);

export const TOKEN_SYMBOL = 'DAPPF';

/** Average block time, used for countdowns (Polygon PoS ≈ 2s). */
export const BLOCK_TIME_SECONDS = 2;

export const txUrl = (hash: string) => (CHAIN.explorer ? `${CHAIN.explorer}/tx/${hash}` : '');
export const addressUrl = (address: string) => (CHAIN.explorer ? `${CHAIN.explorer}/address/${address}` : '');
