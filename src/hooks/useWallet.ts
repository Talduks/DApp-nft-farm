import { useCallback, useEffect, useRef, useState } from 'react';
import { getAddress } from 'ethers';
import { CHAIN } from '../config';
import {
  disconnectWallet,
  getAccounts,
  getChainId,
  loadProvider,
  requestAccount,
  setWalletChainId,
  switchNetwork,
  walletSource,
} from '../web3/wallet';

export function useWallet() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const listening = useRef<EthereumProvider | null>(null);
  const detach = useRef<() => void>(() => undefined);

  const updateChain = useCallback((id: number | null) => {
    setWalletChainId(id);
    setChainId(id);
  }, []);

  /** Subscribes to the provider's events once, whichever path loaded it first. */
  const listen = useCallback(
    (eth: EthereumProvider) => {
      if (listening.current === eth) return;
      detach.current();
      const onAccountsChanged = (accounts: string[]) => setAccount(accounts?.[0] ? getAddress(accounts[0]) : null);
      const onChainChanged = (hexId: string) => updateChain(Number(hexId) || null);
      // MetaMask Connect emits `disconnect` when the session ends in the MetaMask app. Injected
      // wallets use it for RPC hiccups, which must not log the user out.
      const onDisconnect = () => setAccount(null);
      const sessionEvents = walletSource() === 'metamask-connect';
      eth.on?.('accountsChanged', onAccountsChanged);
      eth.on?.('chainChanged', onChainChanged);
      if (sessionEvents) eth.on?.('disconnect', onDisconnect);
      listening.current = eth;
      detach.current = () => {
        eth.removeListener?.('accountsChanged', onAccountsChanged);
        eth.removeListener?.('chainChanged', onChainChanged);
        if (sessionEvents) eth.removeListener?.('disconnect', onDisconnect);
        listening.current = null;
      };
    },
    [updateChain],
  );

  useEffect(() => {
    let cancelled = false;
    // Injected wallets are ready at once; MetaMask Connect is loaded here and restores any previous
    // session, so a returning user is reconnected without a new approval.
    loadProvider()
      .then(async (eth) => {
        if (cancelled) return;
        listen(eth);
        const accounts = await getAccounts();
        if (cancelled) return;
        setAccount(accounts[0] ?? null);
        updateChain(await getChainId().catch(() => null));
      })
      .catch((error) => console.warn('Wallet provider unavailable', error));
    return () => {
      cancelled = true;
      detach.current();
    };
  }, [listen, updateChain]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      listen(await loadProvider());
      const address = await requestAccount();
      setAccount(address);
      let id = await getChainId();
      if (id !== CHAIN.id) {
        await switchNetwork().catch(() => undefined);
        id = await getChainId();
      }
      updateChain(id);
      return address;
    } finally {
      setConnecting(false);
    }
  }, [listen, updateChain]);

  const changeNetwork = useCallback(async () => {
    await switchNetwork();
    updateChain(await getChainId());
  }, [updateChain]);

  /** Forgets the account locally and ends a MetaMask Connect session (extensions can't be disconnected). */
  const disconnect = useCallback(() => {
    setAccount(null);
    disconnectWallet().catch((error) => console.warn('Could not end the wallet session', error));
  }, []);

  return {
    account,
    chainId,
    connecting,
    /** 'injected' = extension or wallet browser; 'metamask-connect' = MetaMask app via deep link / QR. */
    source: walletSource(),
    wrongNetwork: account !== null && chainId !== null && chainId !== CHAIN.id,
    connect,
    changeNetwork,
    disconnect,
  };
}
