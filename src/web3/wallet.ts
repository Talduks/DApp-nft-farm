import { BrowserProvider, JsonRpcProvider, getAddress, type JsonRpcSigner, type Provider } from 'ethers';
import { CHAIN } from '../config';

let rpcProvider: JsonRpcProvider | null = null;
let browserProvider: BrowserProvider | null = null;
let walletChainId: number | null = null;

export const hasWallet = () => typeof window !== 'undefined' && Boolean(window.ethereum);

function ethereum(): EthereumProvider {
  if (!window.ethereum) throw new Error('Nenhuma carteira encontrada. Instale a MetaMask ou abra o site no navegador da sua carteira.');
  return window.ethereum;
}

/** Keeps track of the wallet chain so reads can go through the wallet when it is on our chain. */
export function setWalletChainId(chainId: number | null) {
  if (chainId !== walletChainId) browserProvider = null;
  walletChainId = chainId;
}

function getBrowserProvider(): BrowserProvider {
  if (!browserProvider) browserProvider = new BrowserProvider(ethereum(), CHAIN.id);
  return browserProvider;
}

/**
 * Reads use the wallet's RPC when it is connected to our chain (more reliable than public RPCs)
 * and fall back to the configured RPC URL otherwise.
 */
export function getReadProvider(): Provider {
  if (hasWallet() && walletChainId === CHAIN.id) return getBrowserProvider();
  if (!rpcProvider) rpcProvider = new JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id, { staticNetwork: true });
  return rpcProvider;
}

export async function getChainId(): Promise<number> {
  return Number(await ethereum().request({ method: 'eth_chainId' }));
}

export async function getAccounts(): Promise<string[]> {
  if (!hasWallet()) return [];
  const accounts = (await ethereum().request({ method: 'eth_accounts' })) as string[];
  return accounts.map((a) => getAddress(a));
}

export async function requestAccount(): Promise<string> {
  const accounts = (await ethereum().request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts.length) throw new Error('Nenhuma conta autorizada na carteira.');
  return getAddress(accounts[0]);
}

export async function switchNetwork(): Promise<void> {
  const eth = ethereum();
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hexId }] });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: CHAIN.hexId,
          chainName: CHAIN.name,
          rpcUrls: [CHAIN.rpcUrl],
          nativeCurrency: { name: CHAIN.currency, symbol: CHAIN.currency, decimals: 18 },
          blockExplorerUrls: CHAIN.explorer ? [CHAIN.explorer] : undefined,
        },
      ],
    });
  }
  setWalletChainId(await getChainId());
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
