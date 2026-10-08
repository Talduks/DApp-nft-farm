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
const preset: ChainPreset | undefined = CHAIN_PRESETS[chainId];

export const CHAIN = {
  id: chainId,
  hexId: `0x${chainId.toString(16)}`,
  name: env.VITE_CHAIN_NAME || preset?.name || `Chain ${chainId}`,
  rpcUrl: env.VITE_RPC_URL || preset?.rpcUrl || '',
  explorer: env.VITE_EXPLORER_URL ?? preset?.explorer ?? '',
  currency: env.VITE_CURRENCY || preset?.currency || 'ETH',
};

/** Configuration problems that make the app unusable; shown as a banner instead of failing silently. */
export const CONFIG_ERRORS: string[] = [];
if (!Number.isInteger(chainId) || chainId <= 0) CONFIG_ERRORS.push(`VITE_CHAIN_ID inválido: "${env.VITE_CHAIN_ID}".`);
if (!preset && !env.VITE_RPC_URL) {
  CONFIG_ERRORS.push(`A rede ${chainId} não tem preset: defina VITE_RPC_URL (e VITE_CHAIN_NAME, VITE_EXPLORER_URL, VITE_CURRENCY).`);
}

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
