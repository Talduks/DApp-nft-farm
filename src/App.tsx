import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AlertTriangle, Egg, LayoutDashboard, LogOut, Shield, Sprout, TrendingUp, Wallet } from 'lucide-react';
import AdminPanel from './components/AdminPanel';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import MysteryEgg from './components/MysteryEgg';
import TokenStaking from './components/TokenStaking';
import { useToast } from './components/ui/Toaster';
import { CHAIN, MISSING_CONTRACTS } from './config';
import { useAsyncData } from './hooks/useAsyncData';
import { useWallet } from './hooks/useWallet';
import { shortAddress } from './lib/format';
import { WalletLinkError, linkWalletToUser, logoutUser } from './services/authService';
import { auth } from './services/firebase';
import { fetchOwners } from './web3/admin';
import { parseError } from './web3/errors';
import { fetchFarmData } from './web3/farm';

type View = 'dashboard' | 'staking' | 'egg' | 'admin';

interface NavItem {
  key: View;
  label: string;
  icon: ReactNode;
  activeClass: string;
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} />, activeClass: 'bg-purple-600 text-white' },
  { key: 'staking', label: 'Staking', icon: <TrendingUp size={16} />, activeClass: 'bg-green-600 text-white' },
  { key: 'egg', label: 'Ovos', icon: <Egg size={16} />, activeClass: 'bg-yellow-500 text-black' },
];
const ADMIN_NAV: NavItem = { key: 'admin', label: 'Admin', icon: <Shield size={16} />, activeClass: 'bg-red-600 text-white' };

function App() {
  const toast = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const wallet = useWallet();
  // The wallet the account is allowed to use; null while unlinked or blocked.
  const [linkedAccount, setLinkedAccount] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthLoading(false);
    });
  }, []);

  // Link (or re-validate) the wallet whenever the user or the wallet account changes.
  useEffect(() => {
    if (!user || !wallet.account) {
      setLinkedAccount(null);
      return;
    }
    let cancelled = false;
    linkWalletToUser(user.uid, wallet.account)
      .then(() => {
        if (!cancelled) setLinkedAccount(wallet.account);
      })
      .catch((error) => {
        if (cancelled) return;
        setLinkedAccount(null);
        toast.show({
          type: 'error',
          title: 'Carteira não vinculada',
          message: error instanceof WalletLinkError ? error.message : parseError(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [user, wallet.account, toast]);

  const active = wallet.wrongNetwork ? null : linkedAccount;
  const farm = useAsyncData(active, fetchFarmData, 15_000);
  const owners = useAsyncData(active ? 'owners' : null, () => fetchOwners(), 120_000);
  const isOwner = Boolean(
    active && owners.data && Object.values(owners.data).some((o) => o.toLowerCase() === active.toLowerCase()),
  );

  useEffect(() => {
    if (view === 'admin' && !isOwner && owners.data) setView('dashboard');
  }, [view, isOwner, owners.data]);

  const handleConnect = useCallback(async () => {
    try {
      await wallet.connect();
    } catch (error) {
      toast.show({ type: 'error', title: 'Não foi possível conectar', message: parseError(error) });
    }
  }, [wallet, toast]);

  const handleLogout = async () => {
    await logoutUser();
    wallet.disconnect();
    setView('dashboard');
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Auth />;

  const navItems = isOwner ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-white selection:bg-purple-500/30">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-slate-900/60 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:h-20 sm:px-4">
          <button onClick={() => setView('dashboard')} className="flex items-center gap-2 sm:gap-3">
            <div className="rounded-xl bg-gradient-to-tr from-purple-600 to-blue-600 p-1.5 shadow-lg shadow-purple-500/20 sm:p-2.5">
              <Sprout size={20} className="text-white sm:h-7 sm:w-7" />
            </div>
            <div className="flex flex-col text-left">
              <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-base leading-tight font-bold text-transparent sm:text-xl">
                DApp NFT Farm
              </span>
              <span className="text-[10px] font-medium tracking-wider text-gray-400 sm:text-xs">{CHAIN.name.toUpperCase()}</span>
            </div>
          </button>

          {active && (
            <div className="hidden items-center gap-1 rounded-full border border-white/5 bg-white/5 p-1 md:flex">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all ${
                    view === item.key ? `${item.activeClass} shadow-md` : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            {wallet.account ? (
              <div
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold sm:text-sm ${
                  wallet.wrongNetwork
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-white/10 bg-white/5 text-white'
                }`}
                title={wallet.account}
              >
                <span className={`h-2 w-2 rounded-full ${wallet.wrongNetwork ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <span className="font-mono">{shortAddress(wallet.account)}</span>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={wallet.connecting}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-xs font-bold text-white shadow-lg transition-all hover:shadow-purple-500/50 disabled:opacity-60 sm:px-6 sm:py-3 sm:text-sm"
              >
                <Wallet size={18} />
                <span className="hidden sm:inline">{wallet.connecting ? 'Conectando…' : 'Conectar carteira'}</span>
              </button>
            )}
            <button
              onClick={handleLogout}
              className="rounded-xl bg-white/5 p-2 text-gray-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
              title="Sair"
              aria-label="Sair"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-3 py-4 pb-24 sm:px-4 sm:py-8 md:pb-8">
        {MISSING_CONTRACTS.length > 0 && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
            <p>
              Endereços de contrato não configurados: <b>{MISSING_CONTRACTS.join(', ')}</b>. Defina as variáveis{' '}
              <code className="rounded bg-black/30 px-1">VITE_*_ADDRESS</code> em <code className="rounded bg-black/30 px-1">.env.local</code> (veja o
              README).
            </p>
          </div>
        )}

        {wallet.account && wallet.wrongNetwork && (
          <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
            <p className="flex items-center gap-2 text-sm text-amber-200">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
              Sua carteira está em outra rede. Este app funciona na <b>{CHAIN.name}</b>.
            </p>
            <button
              onClick={() => wallet.changeNetwork().catch((e) => toast.show({ type: 'error', title: 'Erro ao trocar de rede', message: parseError(e) }))}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-black hover:bg-amber-400"
            >
              Trocar para {CHAIN.name}
            </button>
          </div>
        )}

        {!active ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-5 px-4 text-center">
            <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-purple-500/10 sm:h-24 sm:w-24">
              <Wallet size={40} className="text-purple-400 sm:h-12 sm:w-12" />
            </div>
            <h1 className="bg-gradient-to-b from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent sm:text-4xl md:text-6xl">
              Olá, {user.displayName ?? 'farmer'}
            </h1>
            <p className="max-w-md text-sm text-slate-400 sm:text-lg">
              {wallet.hasWallet
                ? `Conecte sua carteira na rede ${CHAIN.name} para chocar ovos, farmar e fazer staking.`
                : 'Nenhuma carteira detectada. Instale a MetaMask ou abra este site pelo navegador da sua carteira.'}
            </p>
            {wallet.hasWallet ? (
              !wallet.account && (
                <button
                  onClick={handleConnect}
                  disabled={wallet.connecting}
                  className="rounded-full bg-white px-8 py-4 text-lg font-bold text-slate-900 shadow-xl shadow-purple-500/20 transition-transform hover:scale-105 disabled:opacity-60"
                >
                  {wallet.connecting ? 'Conectando…' : 'Conectar carteira'}
                </button>
              )
            ) : (
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white px-8 py-4 text-lg font-bold text-slate-900 shadow-xl transition-transform hover:scale-105"
              >
                Instalar MetaMask
              </a>
            )}
          </div>
        ) : view === 'dashboard' ? (
          <Dashboard
            uid={user.uid}
            account={active}
            data={farm.data}
            loading={farm.loading}
            refresh={farm.refresh}
            onGoToEggs={() => setView('egg')}
          />
        ) : view === 'staking' ? (
          <TokenStaking uid={user.uid} account={active} onChanged={farm.refresh} />
        ) : view === 'egg' ? (
          <MysteryEgg
            uid={user.uid}
            account={active}
            pendingEggs={farm.data?.pendingEggs ?? []}
            refresh={farm.refresh}
            onGoToDashboard={() => setView('dashboard')}
          />
        ) : (
          <AdminPanel account={active} uid={user.uid} />
        )}

        {farm.error && active && (
          <p className="mt-6 text-center text-xs text-red-400">Falha ao ler a blockchain: {farm.error}</p>
        )}
      </main>

      {active && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-900/90 backdrop-blur-md md:hidden">
          <div className="flex items-stretch justify-around">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-semibold transition-colors ${
                  view === item.key ? 'text-white' : 'text-gray-500'
                }`}
              >
                <span className={`rounded-full p-1.5 ${view === item.key ? item.activeClass : ''}`}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

export default App;
