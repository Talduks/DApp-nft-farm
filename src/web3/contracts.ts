import {
  Contract,
  Interface,
  isError,
  type ContractRunner,
  type TransactionReceipt,
  type TransactionResponse,
} from 'ethers';
import { CHAIN, CONTRACTS, type ContractName } from '../config';
import { FARM_ABI, NFT_ABI, STAKING_ABI, TOKEN_ABI } from './abis';
import { assertWalletChain, getAccounts, getReadProvider, getSigner, walletSource } from './wallet';

/** How long to wait for a confirmation before giving up (the transaction may still land later). */
const CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000;
/** After a lost MetaMask Connect answer, how long to keep looking for the transaction on-chain. */
const LOST_ANSWER_WINDOW_MS = 4 * 60 * 1000;

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

/** Errors after which nothing can have been broadcast: the user said no, or the node refused it. */
function isDefinitiveFailure(error: unknown): boolean {
  const e = error as { code?: unknown; info?: { error?: { code?: unknown } } };
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001 || e?.info?.error?.code === 4001) return true;
  return ['CALL_EXCEPTION', 'INSUFFICIENT_FUNDS', 'NONCE_EXPIRED', 'REPLACEMENT_UNDERPRICED', 'INVALID_ARGUMENT'].includes(
    e?.code as string,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Looks for the transaction `account` sent with `nonce` to one of our contracts, scanning blocks
 * from `fromBlock` as they are mined. Returns null when nothing shows up within the window.
 */
async function findSentTransaction(account: string, nonce: number, fromBlock: number): Promise<TransactionResponse | null> {
  const provider = getReadProvider();
  const ours = new Set(Object.values(CONTRACTS).map((a) => a.toLowerCase()));
  const deadline = Date.now() + LOST_ANSWER_WINDOW_MS;
  let next = fromBlock;
  while (Date.now() < deadline) {
    try {
      if ((await provider.getTransactionCount(account, 'latest')) > nonce) {
        const latest = await provider.getBlockNumber();
        for (; next <= latest; next++) {
          const block = await provider.getBlock(next, true);
          const tx = block?.prefetchedTransactions.find(
            (t) => t.from.toLowerCase() === account.toLowerCase() && t.nonce === nonce,
          );
          if (tx) return tx.to && ours.has(tx.to.toLowerCase()) ? tx : null;
        }
      }
    } catch (error) {
      console.warn('Still looking for the transaction', error);
    }
    await sleep(4000);
  }
  return null;
}

/**
 * Broadcasts a transaction and waits for its receipt. `send` is a thunk so the network can be
 * re-checked right before broadcasting: multi-step flows reuse one signer and the wallet may
 * have switched chains in between.
 *
 * With MetaMask Connect, the request travels to the MetaMask app through a relay that gives up
 * after 60 s while the user may still approve it there. Such a lost answer is not a failure: the
 * transaction is traced on-chain by the account's nonce, so the user is never invited to pay twice.
 */
export async function sendTx(send: () => Promise<TransactionResponse>, callbacks?: TxCallbacks): Promise<TransactionReceipt> {
  await assertWalletChain();
  const provider = getReadProvider();
  const startBlock = await provider.getBlockNumber();

  let watch: { account: string; nonce: number } | null = null;
  if (walletSource() === 'metamask-connect') {
    const [account] = await getAccounts();
    if (account) watch = { account, nonce: await provider.getTransactionCount(account, 'pending') };
  }

  let tx: TransactionResponse;
  try {
    tx = await send();
  } catch (error) {
    if (!watch || isDefinitiveFailure(error)) throw error;
    console.warn('No answer from the wallet; looking for the transaction on-chain', error);
    callbacks?.onStep?.('A MetaMask ainda não respondeu. Se você aprovou, aguarde: procurando a transação na rede…');
    const found = await findSentTransaction(watch.account, watch.nonce, startBlock);
    if (!found) {
      throw new Error(
        'A MetaMask não confirmou a tempo. Se você ainda aprovar no app da MetaMask, a transação pode ser enviada: confira lá antes de tentar de novo.',
      );
    }
    tx = found;
  }
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
