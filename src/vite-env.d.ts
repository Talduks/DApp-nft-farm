/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_CURRENCY?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_NFT_ADDRESS?: string;
  readonly VITE_FARM_ADDRESS?: string;
  readonly VITE_STAKING_ADDRESS?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
  isMetaMask?: boolean;
}

interface Window {
  ethereum?: EthereumProvider;
}
