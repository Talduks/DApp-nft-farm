import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { BrowserProvider, JsonRpcProvider, getAddress, type JsonRpcSigner, type Provider } from 'ethers';
import type { MetamaskConnectEVM } from '@metamask/connect-evm';
import { APP_URL, CHAIN } from '../config';

/**
 * Wallet access has two sources:
 *  - an injected provider (`window.ethereum`): browser extension or a wallet's in-app browser;
 *  - MetaMask Connect, when nothing is injected (Android app, mobile browsers, desktop without the
 *    extension). It opens the MetaMask app by deep link, or shows a QR code on desktop, and relays
 *    requests to it. It needs no API key.
 * Both are EIP-1193 providers, so everything above this module is the same for either.
 */
export type WalletSource = 'injected' | 'metamask-connect';

let rpcProvider: JsonRpcProvider | null = null;
let browserProvider: BrowserProvider | null = null;
let browserProviderFor: EthereumProvider | null = null;
let walletChainId: number | null = null;

let connectClient: MetamaskConnectEVM | null = null;
let connectProvider: EthereumProvider | null = null;
let connectLoading: Promise<EthereumProvider> | null = null;

const METAMASK_PLAY_STORE = 'https://play.google.com/store/apps/details?id=io.metamask';
/**
 * How long to wait for the user to approve the connection in the MetaMask app. Kept below the
 * library's own 120 s transport timeout so the user gets our message instead of its English one.
 */
const CONNECT_TIMEOUT_MS = 110 * 1000;

/**
 * Node methods. MetaMask Connect answers these from a read-only RPC but drops JSON-RPC errors
 * (a reverted gas estimate resolves `undefined`), so they go to the app's own RPC instead and
 * fail with the real revert reason. Accounts, chain and signing stay with the wallet.
 */
const NODE_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
  'net_version',
]);

let rpcRequestId = 1;

function routeNodeMethodsToRpc(wallet: EthereumProvider): EthereumProvider {
  return {
    async request({ method, params }) {
      if (!NODE_METHODS.has(method)) return wallet.request({ method, params });
      const rpc = getRpcProvider();
      const [response] = await rpc._send({ id: rpcRequestId++, jsonrpc: '2.0', method, params: (params ?? []) as unknown[] });
      if ('error' in response) {
        // Same shape an injected wallet would reject with, so ethers maps it the same way.
        const { code, message, data } = response.error as { code: number; message: string; data?: unknown };
        throw Object.assign(new Error(message), { code, data });
      }
      return response.result;
    },
    on: (event, listener) => wallet.on?.(event, listener),
    removeListener: (event, listener) => wallet.removeListener?.(event, listener),
  };
}

export const isNativeApp = () => Capacitor.isNativePlatform();

const injected = (): EthereumProvider | undefined => (typeof window === 'undefined' ? undefined : window.ethereum);

export const walletSource = (): WalletSource => (injected() ? 'injected' : 'metamask-connect');

/** The provider wallet calls go to, or null while MetaMask Connect hasn't been loaded yet. */
function currentProvider(): EthereumProvider | null {
  return injected() ?? connectProvider;
}

function provider(): EthereumProvider {
  const p = currentProvider();
  if (!p) throw new Error('Conecte sua carteira para continuar.');
  return p;
}

async function createConnectProvider(): Promise<EthereumProvider> {
  const { createEVMClient } = await import('@metamask/connect-evm');
  const native = isNativeApp();
  connectClient = await createEVMClient({
    dapp: { name: 'DApp NFT Farm', url: APP_URL },
    api: { supportedNetworks: { [CHAIN.hexId as `0x${string}`]: CHAIN.rpcUrl } },
    analytics: { enabled: false },
    skipAutoAnnounce: true,
    // Inside the Android app the WebView can't follow wallet links itself: hand them to the OS,
    // which opens the MetaMask app (or the Play Store when it isn't installed).
    mobile: native
      ? {
          preferredOpenLink: (link: string) => {
            AppLauncher.openUrl({ url: link })
              // `metamask://` links fail when the app isn't installed: send the user to the store.
              .then(({ completed }) => (completed ? undefined : AppLauncher.openUrl({ url: METAMASK_PLAY_STORE })))
              .catch((error) => console.error('Could not open MetaMask', error));
          },
        }
      : undefined,
  });
  connectProvider = routeNodeMethodsToRpc(connectClient.getProvider() as unknown as EthereumProvider);
  return connectProvider;
}

/**
 * Resolves the wallet provider, loading MetaMask Connect on demand (it also restores a previous
 * session, so a returning user is connected without a new approval).
 */
export function loadProvider(): Promise<EthereumProvider> {
  const p = injected();
  if (p) return Promise.resolve(p);
  if (!CHAIN.rpcUrl) return Promise.reject(new Error('Configure VITE_RPC_URL para conectar a carteira.'));
  connectLoading ??= createConnectProvider().catch((error) => {
    connectLoading = null;
    throw error;
  });
  return connectLoading;
}

/** Keeps track of the wallet chain so reads can go through the wallet when it is on our chain. */
export function setWalletChainId(chainId: number | null) {
  if (chainId !== walletChainId) browserProvider = null;
  walletChainId = chainId;
}

function getBrowserProvider(): BrowserProvider {
  const p = provider();
  if (!browserProvider || browserProviderFor !== p) {
    browserProvider = new BrowserProvider(p, CHAIN.id);
    browserProviderFor = p;
  }
  return browserProvider;
}

/**
 * Reads use an injected wallet's RPC when it is on our chain (more reliable than public RPCs) and
 * the configured RPC URL otherwise — including with MetaMask Connect, whose reads would go to the
 * same URL anyway but through its relay.
 */
export function getReadProvider(): Provider {
  if (injected() && walletChainId === CHAIN.id) return getBrowserProvider();
  return getRpcProvider();
}

function getRpcProvider(): JsonRpcProvider {
  if (!rpcProvider) rpcProvider = new JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id, { staticNetwork: true });
  return rpcProvider;
}

/** Chain the wallet is on, or null when it can't tell (e.g. MetaMask Connect before connecting). */
export async function getChainId(): Promise<number | null> {
  const id = Number(await provider().request({ method: 'eth_chainId' }));
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Throws unless the wallet is on our chain right now. Called immediately before every broadcast. */
export async function assertWalletChain(): Promise<void> {
  const chainId = await getChainId();
  setWalletChainId(chainId);
  if (chainId !== CHAIN.id) {
    throw new Error(`A carteira está em outra rede. Volte para ${CHAIN.name} e tente novamente.`);
  }
}

export async function getAccounts(): Promise<string[]> {
  const p = currentProvider();
  if (!p) return [];
  const accounts = ((await p.request({ method: 'eth_accounts' })) as string[] | undefined) ?? [];
  return accounts.map((a) => getAddress(a));
}

export async function requestAccount(): Promise<string> {
  const p = await loadProvider();
  let accounts: string[];
  if (connectClient && p === connectProvider) {
    // Asks MetaMask for our chain up front, so the user approves account + network in one step.
    // The approval happens in another app; give up after a while so the button never stays stuck.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('A MetaMask não respondeu. Abra o app da MetaMask, aprove a conexão e tente de novo.')),
        CONNECT_TIMEOUT_MS,
      );
    });
    try {
      ({ accounts } = await Promise.race([connectClient.connect({ chainIds: [CHAIN.hexId as `0x${string}`] }), timeout]));
    } finally {
      clearTimeout(timer);
    }
  } else {
    accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  }
  if (!accounts.length) throw new Error('Nenhuma conta autorizada na carteira.');
  return getAddress(accounts[0]);
}

const chainParameters = () => ({
  chainId: CHAIN.hexId,
  chainName: CHAIN.name,
  rpcUrls: [CHAIN.rpcUrl],
  nativeCurrency: { name: CHAIN.currency, symbol: CHAIN.currency, decimals: 18 },
  blockExplorerUrls: CHAIN.explorer ? [CHAIN.explorer] : undefined,
});

export async function switchNetwork(): Promise<void> {
  const p = provider();
  if (connectClient && p === connectProvider) {
    await connectClient.switchChain({ chainId: CHAIN.hexId as `0x${string}`, chainConfiguration: chainParameters() });
  } else {
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hexId }] });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code !== 4902) throw error;
      await p.request({ method: 'wallet_addEthereumChain', params: [chainParameters()] });
    }
  }
  setWalletChainId(await getChainId());
}

/** Ends a MetaMask Connect session (logout). Injected wallets have no programmatic disconnect. */
export async function disconnectWallet(): Promise<void> {
  if (connectClient && connectClient.status !== 'disconnected') await connectClient.disconnect();
}

/**
 * Signer for write calls. Always checks the network first: sending a write on the wrong chain
 * can transfer real funds to an address that has no contract there.
 */
export async function getSigner(): Promise<JsonRpcSigner> {
  let chainId = await getChainId();
  if (chainId !== CHAIN.id) {
    await switchNetwork();
    chainId = await getChainId();
    if (chainId !== CHAIN.id) throw new Error(`Troque a rede da carteira para ${CHAIN.name} para continuar.`);
  }
  setWalletChainId(chainId);
  return getBrowserProvider().getSigner();
}
