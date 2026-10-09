import { Signature, verifyTypedData, type Contract, type JsonRpcSigner } from 'ethers';
import { CONTRACTS } from '../config';
import { readContract, sendTx, writeContract, type TxCallbacks } from './contracts';
import { isUserRejection, revertName } from './errors';
import { getReadProvider } from './wallet';

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

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
  /** Latest block timestamp (seconds); lock expiry is judged by chain time, not the device clock. */
  chainTime: number;
  fetchedAt: number;
}

export async function fetchStakingData(account: string): Promise<StakingData> {
  const staking = readContract('staking');
  const token = readContract('token');
  const [plans, rewardPool, paused, balance, active, block] = await Promise.all([
    staking.getPlans(),
    staking.rewardPool(),
    staking.paused(),
    token.balanceOf(account),
    staking.getActiveStakes(account),
    getReadProvider().getBlock('latest'),
  ]);

  return {
    chainTime: block?.timestamp ?? Math.floor(Date.now() / 1000),
    fetchedAt: Date.now(),
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
  const [domain, nonce, block] = await Promise.all([token.eip712Domain(), token.nonces(owner), getReadProvider().getBlock('latest')]);
  // Deadline from chain time, so a device clock far behind the chain can't produce an expired permit.
  const deadline = BigInt((block?.timestamp ?? Math.floor(Date.now() / 1000)) + 30 * 60);
  const eip712Domain = { name: domain.name, version: domain.version, chainId: domain.chainId, verifyingContract: domain.verifyingContract };
  const message = { owner, spender: CONTRACTS.staking, value, nonce, deadline };
  const signature = await signer.signTypedData(eip712Domain, PERMIT_TYPES, message);
  // Smart-contract wallets (ERC-1271) return signatures that don't recover to the owner; the
  // token would silently ignore the permit, so treat it as "can't sign" and use approve instead.
  if (verifyTypedData(eip712Domain, PERMIT_TYPES, message, signature).toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Permit signature does not recover to the owner');
  }
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
  if (allowance >= amount) return sendTx(async () => staking.stake(amount, months), callbacks);

  // Only a failure to *sign* falls back to approve + stake. A revert of stakeWithPermit itself
  // (pool too small, paused…) is a real error and must reach the user as such.
  let permit: Awaited<ReturnType<typeof signPermit>> | null = null;
  try {
    callbacks?.onStep?.('Assine a autorização na carteira (sem custo de gás)…');
    permit = await signPermit(token, signer, owner, amount);
  } catch (error) {
    if (isUserRejection(error)) throw error;
    console.warn('Wallet could not sign the permit, falling back to approve + stake', error);
  }
  if (permit) {
    const { deadline, v, r, s } = permit;
    callbacks?.onStep?.('Confirme o stake na carteira…');
    try {
      return await sendTx(async () => staking.stakeWithPermit(amount, months, deadline, v, r, s), callbacks);
    } catch (error) {
      // The contract swallows a rejected permit and the transfer then fails on allowance: that is
      // the one revert that means "the permit didn't take", so fall back; anything else is real.
      if (revertName(error) !== 'ERC20InsufficientAllowance') throw error;
      console.warn('Token did not accept the permit, falling back to approve + stake', error);
    }
  }

  callbacks?.onStep?.('Aprove o uso dos seus tokens (1/2)…');
  await sendTx(async () => token.approve(CONTRACTS.staking, amount), callbacks);
  callbacks?.onStep?.('Confirme o stake (2/2)…');
  return sendTx(async () => staking.stake(amount, months), callbacks);
}

export async function unstake(stakeIds: number[], callbacks?: TxCallbacks) {
  const staking = await writeContract('staking');
  return sendTx(
    async () => (stakeIds.length === 1 ? staking.unstake(stakeIds[0]) : staking.unstakeMany(stakeIds)),
    callbacks,
  );
}
