import {
  Contract,
  Interface,
  isError,
  type ContractRunner,
  type ContractTransactionResponse,
  type TransactionReceipt,
} from 'ethers';
import { CHAIN, CONTRACTS, type ContractName } from '../config';
import { FARM_ABI, NFT_ABI, STAKING_ABI, TOKEN_ABI } from './abis';
import { assertWalletChain, getReadProvider, getSigner } from './wallet';

/** How long to wait for a confirmation before giving up (the transaction may still land later). */
const CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000;

const ABIS: Record<ContractName, string[]> = {
  token: TOKEN_ABI,
  nft: NFT_ABI,
  farm: FARM_ABI,
  staking: STAKING_ABI,
};

export const INTERFACES: Record<ContractName, Interface> = {
  token: new Interface(TOKEN_ABI),
  nft: new Interface(NFT_ABI),
  farm: new Interface(FARM_ABI),
  staking: new Interface(STAKING_ABI),
};

export function readContract(name: ContractName, runner: ContractRunner = getReadProvider()): Contract {
  return new Contract(CONTRACTS[name], ABIS[name], runner);
}

const deployed = new Set<string>();

/** Contract bound to the wallet signer, after making sure the contract exists on this chain. */
export async function writeContract(name: ContractName): Promise<Contract> {
  const signer = await getSigner();
  const address = CONTRACTS[name];
  if (!deployed.has(address)) {
    const code = await signer.provider.getCode(address);
    if (code === '0x') {
      throw new Error(`Contrato "${name}" não encontrado em ${CHAIN.name}. Confira os endereços configurados.`);
    }
    deployed.add(address);
  }
  return new Contract(address, ABIS[name], signer);
}

export interface TxCallbacks {
  /** Called with the hash as soon as the wallet broadcasts the transaction. */
  onSent?: (hash: string) => void;
  /** Progress message for multi-step flows (approve → stake, buy → hatch...). */
  onStep?: (message: string) => void;
}

/**
 * Broadcasts a transaction and waits for its receipt. `send` is a thunk so the network can be
 * re-checked right before broadcasting: multi-step flows reuse one signer and the wallet may
 * have switched chains in between.
 */
export async function sendTx(
  send: () => Promise<ContractTransactionResponse>,
  callbacks?: TxCallbacks,
): Promise<TransactionReceipt> {
  await assertWalletChain();
  const startBlock = await getReadProvider().getBlockNumber();
  const tx = await send();
  callbacks?.onSent?.(tx.hash);

  let receipt: TransactionReceipt | null;
  try {
    // Contract.send() drops the start block ethers needs to notice a sped-up or cancelled
    // transaction; restoring it lets wait() detect the replacement instead of hanging forever.
    receipt = await tx.replaceableTransaction(startBlock).wait(1, CONFIRMATION_TIMEOUT_MS);
  } catch (error) {
    if (isError(error, 'TRANSACTION_REPLACED')) {
      if (error.reason !== 'repriced') throw new Error('A transação foi cancelada ou substituída na carteira.');
      callbacks?.onSent?.(error.hash);
      receipt = error.receipt;
    } else if (isError(error, 'TIMEOUT')) {
      throw new Error('A rede não confirmou a transação a tempo. Confira o status no explorer antes de tentar de novo.');
    } else {
      throw error;
    }
  }
  if (!receipt || receipt.status !== 1) throw new Error('A transação foi revertida.');
  return receipt;
}

/** Parses the logs of `receipt` emitted by contract `name` and returns those named `eventName`. */
export function eventsOf(receipt: TransactionReceipt, name: ContractName, eventName: string) {
  const address = CONTRACTS[name].toLowerCase();
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === address)
    .map((log) => {
      try {
        return INTERFACES[name].parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((parsed): parsed is NonNullable<typeof parsed> => parsed?.name === eventName);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
