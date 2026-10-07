import { useCallback, useEffect, useState } from 'react';
import { getAddress } from 'ethers';
import { CHAIN } from '../config';
import { getAccounts, getChainId, hasWallet, requestAccount, setWalletChainId, switchNetwork } from '../web3/wallet';

export function useWallet() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  const updateChain = useCallback((id: number | null) => {
    setWalletChainId(id);
    setChainId(id);
  }, []);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;

    getAccounts()
      .then((accounts) => setAccount(accounts[0] ?? null))
      .catch(() => undefined);
    getChainId()
      .then(updateChain)
      .catch(() => undefined);

    const onAccountsChanged = (accounts: string[]) => setAccount(accounts[0] ? getAddress(accounts[0]) : null);
    const onChainChanged = (hexId: string) => updateChain(Number(hexId));
    eth.on?.('accountsChanged', onAccountsChanged);
    eth.on?.('chainChanged', onChainChanged);
    return () => {
      eth.removeListener?.('accountsChanged', onAccountsChanged);
      eth.removeListener?.('chainChanged', onChainChanged);
    };
  }, [updateChain]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
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
  }, [updateChain]);

  const changeNetwork = useCallback(async () => {
    await switchNetwork();
    updateChain(await getChainId());
  }, [updateChain]);

  /** Forgets the account locally (wallets don't expose a programmatic disconnect). */
  const disconnect = useCallback(() => setAccount(null), []);

  return {
    account,
    chainId,
    connecting,
    hasWallet: hasWallet(),
    wrongNetwork: account !== null && chainId !== null && chainId !== CHAIN.id,
    connect,
    changeNetwork,
    disconnect,
  };
}
