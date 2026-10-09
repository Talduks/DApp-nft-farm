import { formatEther } from 'ethers';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

// Off-chain activity log for the admin panel. The blockchain stays the source of truth for
// balances; these records are best-effort and never block the user flow.

const toNumber = (wei: bigint) => Number(formatEther(wei));

async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.warn(`Activity log failed (${label})`, error);
  }
}

function touchUser(uid: string, fields: Record<string, unknown>) {
  return setDoc(doc(db, 'users', uid), { ...fields, lastActive: serverTimestamp() }, { merge: true });
}

export function logEggHatches(
  uid: string,
  wallet: string,
  hatches: { tokenId: number; speed: number; eggId: number }[],
  txHash: string,
) {
  return safely('egg hatch', async () => {
    const batch = writeBatch(db);
    for (const h of hatches) {
      batch.set(doc(collection(db, 'egg_mints')), { uid, wallet, ...h, txHash, timestamp: serverTimestamp() });
    }
    await batch.commit();
    await touchUser(uid, { totalMinted: increment(hatches.length) });
  });
}

export function logStake(
  uid: string,
  wallet: string,
  stake: { stakeId: number; amount: bigint; lockMonths: number; endTime: number },
  txHash: string,
) {
  return safely('stake', async () => {
    await setDoc(doc(db, 'stakes', `${wallet.toLowerCase()}_${stake.stakeId}`), {
      uid,
      wallet,
      stakeId: stake.stakeId,
      amount: formatEther(stake.amount),
      lockMonths: stake.lockMonths,
      endTime: stake.endTime,
      status: 'active',
      txHash,
      timestamp: serverTimestamp(),
    });
    await touchUser(uid, { totalStaked: increment(toNumber(stake.amount)), activeStakes: increment(1) });
  });
}

export function logUnstake(
  uid: string,
  wallet: string,
  positions: { stakeId: number; amount: bigint; reward: bigint }[],
  txHash: string,
) {
  return safely('unstake', async () => {
    let principal = 0n;
    let reward = 0n;
    for (const p of positions) {
      principal += p.amount;
      reward += p.reward;
      await updateDoc(doc(db, 'stakes', `${wallet.toLowerCase()}_${p.stakeId}`), {
        status: 'withdrawn',
        withdrawalTxHash: txHash,
        withdrawalTimestamp: serverTimestamp(),
      }).catch(() => undefined);
    }
    await addDoc(collection(db, 'withdrawals'), {
      uid,
      wallet,
      type: 'unstake',
      principal: formatEther(principal),
      reward: formatEther(reward),
      txHash,
      timestamp: serverTimestamp(),
    });
    await touchUser(uid, {
      totalStaked: increment(-toNumber(principal)),
      activeStakes: increment(-positions.length),
      totalRewardsClaimed: increment(toNumber(reward)),
    });
  });
}

export function logRewardClaim(uid: string, wallet: string, amount: bigint, txHash: string) {
  if (amount === 0n) return Promise.resolve();
  return safely('reward claim', async () => {
    await addDoc(collection(db, 'withdrawals'), {
      uid,
      wallet,
      type: 'claim_rewards',
      amount: formatEther(amount),
      txHash,
      timestamp: serverTimestamp(),
    });
    await touchUser(uid, { totalRewardsClaimed: increment(toNumber(amount)) });
  });
}

// ---- Admin reads (allowed by firestore.rules only for users listed in /admins) ----

export interface UserProfile {
  uid: string;
  username: string;
  address?: string;
  totalMinted?: number;
  totalStaked?: number;
  activeStakes?: number;
  totalRewardsClaimed?: number;
  isBanned?: boolean;
  createdAt?: Timestamp;
  lastActive?: Timestamp;
}

export interface EggMintRecord {
  id: string;
  wallet: string;
  tokenId: number;
  speed: number;
  txHash: string;
  timestamp?: Timestamp;
}

export async function getAllUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(500)));
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
}

export async function getEggHistory(max = 100): Promise<EggMintRecord[]> {
  const snap = await getDocs(query(collection(db, 'egg_mints'), orderBy('timestamp', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EggMintRecord, 'id'>) }));
}

/**
 * Bans or unbans an account together with every wallet indexed to it. The wallet documents are
 * looked up by owner, never derived from the profile's free-form `address` field, so a user can't
 * point the ban at someone else's wallet.
 */
export async function setUserBan(user: UserProfile, banned: boolean) {
  const wallets = await getDocs(query(collection(db, 'wallets'), where('uid', '==', user.uid)));
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', user.uid), { isBanned: banned });
  wallets.forEach((wallet) => batch.update(wallet.ref, { banned }));
  // Profiles from before the wallets index only carry users.address: index that wallet so the
  // ban reaches it, but never touch a document that already belongs to someone else.
  if (wallets.empty && user.address) {
    const legacyRef = doc(db, 'wallets', user.address.toLowerCase());
    if (!(await getDoc(legacyRef)).exists()) batch.set(legacyRef, { uid: user.uid, banned, linkedAt: serverTimestamp() });
  }
  await batch.commit();
}
