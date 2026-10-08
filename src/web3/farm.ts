import type { JsonRpcSigner } from 'ethers';
import { CONTRACTS } from '../config';
import { chunk, eventsOf, readContract, sendTx, writeContract, type TxCallbacks } from './contracts';

export interface NftItem {
  id: number;
  speed: number;
}

export interface EggItem {
  id: number;
  commitBlock: number;
}

export interface FarmData {
  walletNfts: NftItem[];
  stakedNfts: NftItem[];
  totalSpeed: number;
  pendingRewards: bigint;
  /** User's rewards per second, in wei. */
  rewardPerSecond: bigint;
  /** Farm reward per speed unit per second, in wei. */
  rewardRate: bigint;
  tokenBalance: bigint;
  pendingEggs: EggItem[];
  /** Farm paused: no new stakes or claims; withdrawals return NFTs and keep rewards owed. */
  paused: boolean;
  /** When the snapshot was taken (ms), used to extrapolate pending rewards in real time. */
  fetchedAt: number;
}

export interface WithdrawResult {
  /** DAPPF actually minted to the user. */
  claimed: bigint;
  /** Rewards that stayed owed (farm paused, supply cap or token refused to mint). */
  deferred: bigint;
  hash: string;
}

const MAX_BATCH = 50;

function toNfts(ids: bigint[], speeds: bigint[]): NftItem[] {
  return ids
    .map((id, i) => ({ id: Number(id), speed: Number(speeds[i]) }))
    .sort((a, b) => b.speed - a.speed || a.id - b.id);
}

/** Everything the dashboard needs in 5 parallel RPC calls (the old version made one call per NFT). */
export async function fetchFarmData(account: string): Promise<FarmData> {
  const nft = readContract('nft');
  const farm = readContract('farm');
  const token = readContract('token');

  const [owned, info, balance, eggs, rewardRate, paused] = await Promise.all([
    nft.tokensOfOwner(account),
    farm.getUserInfo(account),
    token.balanceOf(account),
    nft.pendingEggsOf(account),
    farm.rewardRate(),
    farm.paused(),
  ]);

  return {
    walletNfts: toNfts(owned.ids, owned.speeds),
    stakedNfts: toNfts(info.tokenIds, info.speeds),
    totalSpeed: Number(info.totalSpeed),
    pendingRewards: info.pending,
    rewardPerSecond: info.rewardPerSecond,
    rewardRate,
    tokenBalance: balance,
    pendingEggs: eggs.eggIds.map((id: bigint, i: number) => ({ id: Number(id), commitBlock: Number(eggs.commitBlocks[i]) })),
    paused,
    fetchedAt: Date.now(),
  };
}

export async function stakeNfts(tokenIds: number[], callbacks?: TxCallbacks) {
  const nft = await writeContract('nft');
  const farm = await writeContract('farm');
  const account = await (nft.runner as JsonRpcSigner).getAddress();

  const batches = chunk(tokenIds, MAX_BATCH);
  const approved: boolean = await nft.isApprovedForAll(account, CONTRACTS.farm);
  const totalSteps = batches.length + (approved ? 0 : 1);
  let step = 0;

  if (!approved) {
    callbacks?.onStep?.(`Autorize o farm a movimentar seus NFTs (${++step}/${totalSteps})…`);
    await sendTx(async () => nft.setApprovalForAll(CONTRACTS.farm, true), callbacks);
  }
  let receipt;
  for (const batch of batches) {
    if (totalSteps > 1) callbacks?.onStep?.(`Confirme o stake (${++step}/${totalSteps})…`);
    receipt = await sendTx(async () => farm.stake(batch), callbacks);
  }
  return receipt!;
}

export async function withdrawNfts(tokenIds: number[], callbacks?: TxCallbacks): Promise<WithdrawResult> {
  const farm = await writeContract('farm');
  const batches = chunk(tokenIds, MAX_BATCH);
  let claimed = 0n;
  let deferred = 0n;
  let hash = '';
  for (const [i, batch] of batches.entries()) {
    if (batches.length > 1) callbacks?.onStep?.(`Confirme o saque (${i + 1}/${batches.length})…`);
    const receipt = await sendTx(async () => farm.withdraw(batch), callbacks);
    hash = receipt.hash;
    for (const event of eventsOf(receipt, 'farm', 'RewardClaimed')) claimed += event.args.reward as bigint;
    // The last batch's RewardDeferred carries the full amount still owed.
    deferred = eventsOf(receipt, 'farm', 'RewardDeferred').reduce((sum, e) => sum + (e.args.amount as bigint), 0n);
  }
  return { claimed, deferred, hash };
}

export async function claimRewards(callbacks?: TxCallbacks) {
  const farm = await writeContract('farm');
  const receipt = await sendTx(async () => farm.claimAll(), callbacks);
  const claimed = eventsOf(receipt, 'farm', 'RewardClaimed').reduce((sum, e) => sum + (e.args.reward as bigint), 0n);
  return { claimed, hash: receipt.hash };
}
