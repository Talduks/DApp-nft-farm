import { getAddress } from 'ethers';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

// Accounts are username-based; Firebase Auth needs an e-mail, so a synthetic one is derived.
const EMAIL_DOMAIN = '@nexus.farm';
const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;
const WALLET_CHANGE_COOLDOWN_DAYS = 7;
const BANNED_WALLET_MESSAGE =
  'Este endereço de carteira está com restrição na plataforma por violar os termos de uso.';

const normalize = (username: string) => username.trim().toLowerCase();

/** A wallet that can't be used with this account (banned, owned by another account, cooldown). */
export class WalletLinkError extends Error {}

function authErrorMessage(error: unknown): string | null {
  switch ((error as { code?: string })?.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-email':
      return 'Usuário ou senha incorretos.';
    case 'auth/email-already-in-use':
      return 'Nome de usuário já está em uso.';
    case 'auth/weak-password':
      return 'Senha muito fraca. Use pelo menos 8 caracteres.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    case 'auth/network-request-failed':
      return 'Sem conexão com o servidor. Verifique sua internet.';
    default:
      return null;
  }
}

function rethrow(error: unknown): never {
  const message = authErrorMessage(error);
  throw message ? new Error(message) : error;
}

export function validateUsername(username: string): string | null {
  return USERNAME_RULE.test(normalize(username))
    ? null
    : 'Use de 3 a 20 caracteres: letras, números ou _ (sem espaços ou acentos).';
}

export async function registerUser(username: string, password: string) {
  const name = normalize(username);
  const invalid = validateUsername(name);
  if (invalid) throw new Error(invalid);
  if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  if ((await getDoc(doc(db, 'usernames', name))).exists()) throw new Error('Nome de usuário já está em uso.');

  const { user } = await createUserWithEmailAndPassword(auth, `${name}${EMAIL_DOMAIN}`, password).catch(rethrow);
  try {
    // Reserve the username and create the profile atomically, so two people can't race for a name.
    await runTransaction(db, async (tx) => {
      const usernameRef = doc(db, 'usernames', name);
      if ((await tx.get(usernameRef)).exists()) throw new Error('Nome de usuário já está em uso.');
      tx.set(usernameRef, { uid: user.uid });
      tx.set(doc(db, 'users', user.uid), {
        username: username.trim(),
        usernameLower: name,
        createdAt: serverTimestamp(),
        totalMinted: 0,
        totalStaked: 0,
        activeStakes: 0,
        totalRewardsClaimed: 0,
      });
    });
  } catch (error) {
    // The Firestore side is the only fatal step: roll the Auth account back so the username
    // isn't burned. Retry once — a failed rollback would leave a profile-less account behind.
    await deleteUser(user).catch(() => deleteUser(user).catch(() => undefined));
    throw error;
  }
  // Cosmetic: the display name is derived from the profile anyway, so a failure here is not fatal.
  await updateProfile(user, { displayName: username.trim() }).catch(() => undefined);
  return user;
}

/** Whether the account is banned. Used by the app shell before rendering any signed-in UI. */
export async function isUserBanned(uid: string): Promise<boolean> {
  const profile = await getDoc(doc(db, 'users', uid));
  return profile.exists() && profile.data().isBanned === true;
}

export async function loginUser(username: string, password: string) {
  const { user } = await signInWithEmailAndPassword(auth, `${normalize(username)}${EMAIL_DOMAIN}`, password).catch(
    rethrow,
  );
  const profile = await getDoc(doc(db, 'users', user.uid));
  if (profile.exists() && profile.data().isBanned) {
    await signOut(auth);
    throw new Error('Esta conta foi banida pelo administrador.');
  }
  return user;
}

export const logoutUser = () => signOut(auth);

export async function checkWalletBan(address: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'wallets', address.toLowerCase()));
    return snap.exists() && Boolean(snap.data().banned);
  } catch (error) {
    console.warn('Could not check wallet ban', error);
    return false;
  }
}

/**
 * Links a wallet to the account. A wallet belongs to one account only, and an account can switch
 * wallets once every 7 days (also enforced in firestore.rules).
 */
export async function linkWalletToUser(uid: string, walletAddress: string) {
  const address = getAddress(walletAddress);
  const lower = address.toLowerCase();
  const userRef = doc(db, 'users', uid);
  const walletRef = doc(db, 'wallets', lower);

  await runTransaction(db, async (tx) => {
    const [userSnap, walletSnap] = await Promise.all([tx.get(userRef), tx.get(walletRef)]);
    if (walletSnap.exists()) {
      const wallet = walletSnap.data();
      if (wallet.banned) throw new WalletLinkError(BANNED_WALLET_MESSAGE);
      if (wallet.uid !== uid) throw new WalletLinkError('Esta carteira já está vinculada a outra conta.');
    }

    const profile = userSnap.data() ?? {};
    const current: string | undefined = profile.address?.toLowerCase();
    if (current === lower) {
      if (!walletSnap.exists()) tx.set(walletRef, { uid, banned: false, linkedAt: serverTimestamp() });
      return;
    }
    // All reads must happen before the first write in a transaction.
    const oldWalletRef = current ? doc(db, 'wallets', current) : null;
    const oldWalletSnap = oldWalletRef ? await tx.get(oldWalletRef) : null;

    if (current && profile.walletLastUpdated) {
      const daysPassed = (Date.now() - profile.walletLastUpdated.toDate().getTime()) / 86_400_000;
      if (daysPassed < WALLET_CHANGE_COOLDOWN_DAYS) {
        const daysLeft = Math.ceil(WALLET_CHANGE_COOLDOWN_DAYS - daysPassed);
        throw new WalletLinkError(
          `Sua conta está vinculada à carteira ${profile.address}. Troque para ela na sua carteira ou aguarde ${daysLeft} dia${daysLeft > 1 ? 's' : ''} para vincular outra.`,
        );
      }
    }

    tx.set(userRef, { address, addressLower: lower, walletLastUpdated: serverTimestamp() }, { merge: true });
    if (!walletSnap.exists()) tx.set(walletRef, { uid, banned: false, linkedAt: serverTimestamp() });
    // Release the previous wallet only if its index document exists and is ours (profiles from
    // before the wallets index have none, and deleting a missing doc is denied by the rules).
    if (oldWalletRef && oldWalletSnap?.exists() && oldWalletSnap.data().uid === uid && !oldWalletSnap.data().banned) {
      tx.delete(oldWalletRef);
    }
  });
}
