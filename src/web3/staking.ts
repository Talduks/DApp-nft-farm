import { Signature, type Contract, type JsonRpcSigner } from 'ethers';
import { CONTRACTS } from '../config';
import { readContract, sendTx, writeContract, type TxCallbacks } from './contracts';
import { isUserRejection } from './errors';

export interface StakingPlan {
  months: number;
  aprBps: number;
}

export interface StakePosition {
  stakeId: number;
  amount: bigint;
  reward: bigint;
  startTime: number;
  endTime: number;
  lockMonths: number;
}

export interface StakingData {
  plans: StakingPlan[];
  rewardPool: bigint;
  paused: boolean;
  balance: bigint;
  positions: StakePosition[];
}

export async function fetchStakingData(account: string): Promise<StakingData> {
  const staking = readContract('staking');
  const token = readContract('token');
  const [plans, rewardPool, paused, balance, active] = await Promise.all([
    staking.getPlans(),
    staking.rewardPool(),
    staking.paused(),
    token.balanceOf(account),
    staking.getActiveStakes(account),
  ]);

  return {
    plans: plans.months
      .map((m: bigint, i: number) => ({ months: Number(m), aprBps: Number(plans.aprs[i]) }))
      .filter((p: StakingPlan) => p.aprBps > 0)
      .sort((a: StakingPlan, b: StakingPlan) => a.months - b.months),
    rewardPool,
    paused,
    balance,
    positions: active.stakeIds.map((id: bigint, i: number) => ({
      stakeId: Number(id),
      amount: active.amounts[i],
      reward: active.rewards[i],
      startTime: Number(active.startTimes[i]),
      endTime: Number(active.endTimes[i]),
      lockMonths: Number(active.lockMonths[i]),
    })),
  };
}

/** Same formula as TokenStaking.quoteReward. */
export function quoteReward(amount: bigint, plan: StakingPlan): bigint {
  return (amount * BigInt(plan.aprBps) * BigInt(plan.months)) / (12n * 10_000n);
}

async function signPermit(token: Contract, signer: JsonRpcSigner, owner: string, value: bigint) {
  const domain = await token.eip712Domain();
  const nonce: bigint = await token.nonces(owner);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const signature = await signer.signTypedData(
    { name: domain.name, version: domain.version, chainId: domain.chainId, verifyingContract: domain.verifyingContract },
    {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    { owner, spender: CONTRACTS.staking, value, nonce, deadline },
  );
  const sig = Signature.from(signature);
  return { deadline, v: sig.v, r: sig.r, s: sig.s };
}

/**
 * Stakes `amount` for `months`. Uses an EIP-2612 permit signature so approval + stake happen in
 * one transaction; falls back to approve + stake when the wallet can't sign typed data.
 */
export async function stakeTokens(amount: bigint, months: number, callbacks?: TxCallbacks) {
  const token = await writeContract('token');
  const staking = await writeContract('staking');
  const signer = token.runner as JsonRpcSigner;
  const owner = await signer.getAddress();

  const allowance: bigint = await token.allowance(owner, CONTRACTS.staking);
  if (allowance >= amount) return sendTx(staking.stake(amount, months), callbacks);

  try {
    callbacks?.onStep?.('Assine a autorização na carteira (sem custo de gás)…');
    const permit = await signPermit(token, signer, owner, amount);
    callbacks?.onStep?.('Confirme o stake na carteira…');
    return await sendTx(staking.stakeWithPermit(amount, months, permit.deadline, permit.v, permit.r, permit.s), callbacks);
  } catch (error) {
    if (isUserRejection(error)) throw error;
    console.warn('Permit failed, falling back to approve + stake', error);
  }

  callbacks?.onStep?.('Aprove o uso dos seus tokens (1/2)…');
  await sendTx(token.approve(CONTRACTS.staking, amount), callbacks);
  callbacks?.onStep?.('Confirme o stake (2/2)…');
  return sendTx(staking.stake(amount, months), callbacks);
}

export async function unstake(stakeIds: number[], callbacks?: TxCallbacks) {
  const staking = await writeContract('staking');
  return sendTx(stakeIds.length === 1 ? staking.unstake(stakeIds[0]) : staking.unstakeMany(stakeIds), callbacks);
}
