import type { JsonRpcSigner } from 'ethers';
import { CONTRACTS, type ContractName } from '../config';
import { readContract, sendTx, writeContract, type TxCallbacks } from './contracts';
import type { NftItem } from './farm';

export interface AdminOverview {
  owners: Record<'nft' | 'farm' | 'staking', string>;
  nft: { balance: bigint; mintPrice: bigint; eggsSold: number; totalMinted: number; paused: boolean };
  farm: { rewardRate: bigint; maxRewardRate: bigint; totalSpeed: number; totalStaked: number; paused: boolean };
  token: { totalSupply: bigint; maxSupply: bigint };
  staking: {
    totalStaked: bigint;
    rewardsReserved: bigint;
    rewardPool: bigint;
    activeStakes: number;
    paused: boolean;
    plans: { months: number; aprBps: number; staked: bigint }[];
  };
}

export async function fetchOwners(): Promise<AdminOverview['owners']> {
  const [nft, farm, staking] = await Promise.all([
    readContract('nft').owner(),
    readContract('farm').owner(),
    readContract('staking').owner(),
  ]);
  return { nft, farm, staking };
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const nft = readContract('nft');
  const farm = readContract('farm');
  const token = readContract('token');
  const staking = readContract('staking');
  const provider = nft.runner!.provider!;

  const [owners, balance, mintPrice, eggsSold, totalMinted, nftPaused] = await Promise.all([
    fetchOwners(),
    provider.getBalance(CONTRACTS.nft),
    nft.mintPrice(),
    nft.nextEggId(),
    nft.totalMinted(),
    nft.paused(),
  ]);
  const [rewardRate, maxRewardRate, totalSpeed, farmStaked, farmPaused, totalSupply, maxSupply] = await Promise.all([
    farm.rewardRate(),
    farm.MAX_REWARD_RATE(),
    farm.totalSpeedStaked(),
    farm.totalStaked(),
    farm.paused(),
    token.totalSupply(),
    token.MAX_SUPPLY(),
  ]);
  const [stakingTotal, reserved, pool, active, stakingPaused, plans] = await Promise.all([
    staking.totalStaked(),
    staking.totalRewardsReserved(),
    staking.rewardPool(),
    staking.activeStakes(),
    staking.paused(),
    staking.getPlans(),
  ]);
  const months: number[] = plans.months.map(Number);
  const stakedByPeriod: bigint[] = await Promise.all(months.map((m) => staking.stakedByPeriod(m)));

  return {
    owners,
    nft: { balance, mintPrice, eggsSold: Number(eggsSold), totalMinted: Number(totalMinted), paused: nftPaused },
    farm: { rewardRate, maxRewardRate, totalSpeed: Number(totalSpeed), totalStaked: Number(farmStaked), paused: farmPaused },
    token: { totalSupply, maxSupply },
    staking: {
      totalStaked: stakingTotal,
      rewardsReserved: reserved,
      rewardPool: pool,
      activeStakes: Number(active),
      paused: stakingPaused,
      plans: months.map((m, i) => ({ months: m, aprBps: Number(plans.aprs[i]), staked: stakedByPeriod[i] })),
    },
  };
}

export async function fetchUserNfts(address: string): Promise<(NftItem & { staked: boolean })[]> {
  const [owned, info] = await Promise.all([
    readContract('nft').tokensOfOwner(address),
    readContract('farm').getUserInfo(address),
  ]);
  const wallet = owned.ids.map((id: bigint, i: number) => ({ id: Number(id), speed: Number(owned.speeds[i]), staked: false }));
  const staked = info.tokenIds.map((id: bigint, i: number) => ({ id: Number(id), speed: Number(info.speeds[i]), staked: true }));
  return [...wallet, ...staked].sort((a, b) => a.id - b.id);
}

export async function withdrawSales(to: string, callbacks?: TxCallbacks) {
  return sendTx((await writeContract('nft')).withdraw(to), callbacks);
}

export async function setMintPrice(price: bigint, callbacks?: TxCallbacks) {
  return sendTx((await writeContract('nft')).setMintPrice(price), callbacks);
}

export async function setRewardRate(rate: bigint, callbacks?: TxCallbacks) {
  return sendTx((await writeContract('farm')).setRewardRate(rate), callbacks);
}

export async function setPaused(name: Exclude<ContractName, 'token'>, paused: boolean, callbacks?: TxCallbacks) {
  const contract = await writeContract(name);
  return sendTx(paused ? contract.pause() : contract.unpause(), callbacks);
}

export async function fundStakingPool(amount: bigint, callbacks?: TxCallbacks) {
  const token = await writeContract('token');
  const staking = await writeContract('staking');
  const owner = await (token.runner as JsonRpcSigner).getAddress();
  const allowance: bigint = await token.allowance(owner, CONTRACTS.staking);
  if (allowance < amount) {
    callbacks?.onStep?.('Aprove os tokens para o pool (1/2)…');
    await sendTx(token.approve(CONTRACTS.staking, amount), callbacks);
    callbacks?.onStep?.('Confirme o aporte (2/2)…');
  }
  return sendTx(staking.fundRewards(amount), callbacks);
}

export async function withdrawStakingPool(amount: bigint, to: string, callbacks?: TxCallbacks) {
  return sendTx((await writeContract('staking')).withdrawRewardPool(amount, to), callbacks);
}

export async function setStakingPlan(months: number, aprBps: number, callbacks?: TxCallbacks) {
  return sendTx((await writeContract('staking')).setPlan(months, aprBps), callbacks);
}
