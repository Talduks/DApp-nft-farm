import { eventsOf, readContract, sendTx, writeContract, type TxCallbacks } from './contracts';
import { getReadProvider } from './wallet';

export interface EggShop {
  price: bigint;
  maxPerTx: number;
  hatchWindow: number;
  paused: boolean;
  eggsSold: number;
  totalMinted: number;
}

export interface HatchResult {
  eggId: number;
  tokenId: number;
  speed: number;
  expired: boolean;
}

export async function fetchEggShop(): Promise<EggShop> {
  const nft = readContract('nft');
  const [price, maxPerTx, hatchWindow, paused, eggsSold, totalMinted] = await Promise.all([
    nft.mintPrice(),
    nft.MAX_EGGS_PER_TX(),
    nft.HATCH_WINDOW(),
    nft.paused(),
    nft.nextEggId(),
    nft.totalMinted(),
  ]);
  return {
    price,
    maxPerTx: Number(maxPerTx),
    hatchWindow: Number(hatchWindow),
    paused,
    eggsSold: Number(eggsSold),
    totalMinted: Number(totalMinted),
  };
}

export async function getBlockNumber(): Promise<number> {
  return getReadProvider().getBlockNumber();
}

/** Buys eggs (commit step). Returns the new egg ids and the block they were bought in. */
export async function buyEggs(quantity: number, unitPrice: bigint, callbacks?: TxCallbacks) {
  const nft = await writeContract('nft');
  const receipt = await sendTx(nft.buyEggs(quantity, { value: unitPrice * BigInt(quantity) }), callbacks);
  const [event] = eventsOf(receipt, 'nft', 'EggsPurchased');
  const first = Number(event.args.firstEggId);
  const eggIds = Array.from({ length: Number(event.args.quantity) }, (_, i) => first + i);
  return { eggIds, blockNumber: receipt.blockNumber, hash: receipt.hash };
}

/**
 * Waits until the chain is past `blockNumber`, so the hatch transaction (and its gas estimate)
 * runs in a later block than the purchase. Gives up quietly after `timeoutMs` — on a local node
 * that only mines on demand the hatch transaction itself produces the next block.
 */
export async function waitForBlockAfter(blockNumber: number, timeoutMs = 20_000): Promise<void> {
  const provider = getReadProvider();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await provider.getBlockNumber()) > blockNumber) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Hatches eggs (reveal step). */
export async function hatchEggs(eggIds: number[], callbacks?: TxCallbacks) {
  const nft = await writeContract('nft');
  const receipt = await sendTx(nft.hatchEggs(eggIds), callbacks);
  const results: HatchResult[] = eventsOf(receipt, 'nft', 'EggHatched').map((e) => ({
    eggId: Number(e.args.eggId),
    tokenId: Number(e.args.tokenId),
    speed: Number(e.args.speed),
    expired: Boolean(e.args.expired),
  }));
  return { results, hash: receipt.hash };
}
