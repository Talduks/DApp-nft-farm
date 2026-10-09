import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AlertTriangle, Egg, LayoutDashboard, Loader2, LogOut, RefreshCw, Shield, Sprout, TrendingUp, Wallet } from 'lucide-react';
import AdminPanel from './components/AdminPanel';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import MysteryEgg from './components/MysteryEgg';
import TokenStaking from './components/TokenStaking';
import { useToast } from './components/ui/Toaster';
import { CHAIN, CONFIG_ERRORS, MISSING_CONTRACTS } from './config';
import { useAsyncData } from './hooks/useAsyncData';
import { useWallet } from './hooks/useWallet';
import { shortAddress } from './lib/format';
import { WalletLinkError, linkWalletToUser, logoutUser, waitForProfile } from './services/authService';
import { auth } from './services/firebase';
import { fetchOwners } from './web3/admin';
import { parseError } from './web3/errors';
import { fetchFarmData } from './web3/farm';
import { isNativeApp } from './web3/wallet';

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

/** Wallet ↔ account link. The wallet is usable only while `linked` to the very address in use. */
type LinkState =
  | { status: 'idle' | 'linking' }
  | { status: 'linked'; account: string }
  | { status: 'error'; message: string; policy: boolean };

function App() {
  const toast = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const wallet = useWallet();
  const [link, setLink] = useState<LinkState>({ status: 'idle' });
  const [linkAttempt, setLinkAttempt] = useState(0);

  // Gate the signed-in UI on the profile check (exists + not banned), not on the raw auth state:
  // a banned login never flashes the dashboard, the message isn't lost when <Auth /> remounts,
  // and a fresh registration can't race the wallet link before its profile exists.
  useEffect(() => {
    return onAuthStateChanged(auth, async (current) => {
      if (current) {
        let profile;
        try {
          profile = await waitForProfile(current.uid);
        } catch (error) {
          console.error(error);
          toast.show({ type: 'error', title: 'Não foi possível verificar sua conta', message: 'Verifique a conexão e entre novamente.' });
          setUser(null);
          setAuthLoading(false);
          return;
        }
        if (profile.banned) {
          await logoutUser();
          toast.show({ type: 'error', title: 'Conta banida', message: 'Esta conta foi banida pelo administrador.' });
          setUser(null);
          setAuthLoading(false);
          return;
        }
      }
      setUser(current);
      setAuthLoading(false);
    });
  }, [toast]);

  // (Re)validate the link whenever the user or the wallet account changes. `active` below also
  // compares the linked address with the one in use, so an account switch never shows wallet A's
  // data while wallet B signs — not even for one render.
  useEffect(() => {
    const account = wallet.account;
    if (!user || !account) {
      setLink({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLink({ status: 'linking' });
    linkWalletToUser(user.uid, account)
      .then(() => {
        if (!cancelled) setLink({ status: 'linked', account });
      })
      .catch((error) => {
        if (cancelled) return;
        const policy = error instanceof WalletLinkError;
        setLink({ status: 'error', message: policy ? error.message : parseError(error), policy });
      });
    return () => {
      cancelled = true;
    };
  }, [user, wallet.account, linkAttempt]);

  const active = link.status === 'linked' && link.account === wallet.account && !wallet.wrongNetwork ? link.account : null;
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
  const configErrors = [
    ...CONFIG_ERRORS,
    ...(MISSING_CONTRACTS.length
      ? [`Endereços de contrato não configurados: ${MISSING_CONTRACTS.join(', ')} (variáveis VITE_*_ADDRESS em .env.local).`]
      : []),
  ];

  const renderGate = () => {
    if (!wallet.account) {
      const viaMetaMaskApp = wallet.source === 'metamask-connect';
      return (
        <>
          <p className="max-w-md text-sm text-slate-400 sm:text-lg">
            Conecte sua carteira na rede {CHAIN.name} para chocar ovos, farmar e fazer staking.
          </p>
          <button
            onClick={handleConnect}
            disabled={wallet.connecting}
            className="rounded-full bg-white px-8 py-4 text-lg font-bold text-slate-900 shadow-xl shadow-purple-500/20 transition-transform hover:scale-105 disabled:opacity-60"
          >
            {wallet.connecting
              ? viaMetaMaskApp
                ? 'Aguardando a MetaMask…'
                : 'Conectando…'
              : viaMetaMaskApp
                ? 'Conectar com MetaMask'
                : 'Conectar carteira'}
          </button>
          {viaMetaMaskApp && (
            <p className="max-w-sm text-xs text-slate-500">
              {isNativeApp()
                ? 'O app da MetaMask vai abrir para você aprovar. Depois de aprovar, volte para este app.'
                : 'No celular, o app da MetaMask abre para você aprovar; no computador, escaneie o QR code com ele.'}{' '}
              Não tem a MetaMask?{' '}
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="font-semibold text-purple-300 underline">
                Baixe aqui
              </a>
              .
            </p>
          )}
        </>
      );
    }
    if (wallet.wrongNetwork) {
      return <p className="max-w-md text-sm text-slate-400 sm:text-lg">Troque a rede da carteira para {CHAIN.name} no aviso acima.</p>;
    }
    if (link.status === 'error') {
      return (
        <>
          <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
            <p className="font-bold">Carteira {shortAddress(wallet.account)} não pôde ser vinculada</p>
            <p className="mt-1">{link.message}</p>
            {link.policy && <p className="mt-2 text-xs text-red-300/80">Troque de conta na sua carteira para usar outro endereço.</p>}
          </div>
          <button
            onClick={() => setLinkAttempt((n) => n + 1)}
            className="flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-slate-900 shadow-xl transition-transform hover:scale-105"
          >
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </button>
        </>
      );
    }
    return (
      <p className="flex items-center gap-2 text-sm text-slate-400 sm:text-lg">
        <Loader2 className="h-5 w-5 animate-spin" /> Vinculando a carteira {shortAddress(wallet.account)} à sua conta…
      </p>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-white selection:bg-purple-500/30">
      <nav className="pt-safe px-safe sticky top-0 z-50 border-b border-white/10 bg-slate-900/60 backdrop-blur-md">
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
                  active
                    ? 'border-white/10 bg-white/5 text-white'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}
                title={wallet.account}
              >
                <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-amber-400'}`} />
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

      <main className="mx-auto max-w-7xl pt-4 pr-[calc(0.75rem+var(--sar))] pb-[calc(6rem+var(--sab))] pl-[calc(0.75rem+var(--sal))] sm:pt-8 sm:pr-[calc(1rem+var(--sar))] sm:pl-[calc(1rem+var(--sal))] md:pb-[calc(2rem+var(--sab))]">
        {configErrors.length > 0 && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
            <ul className="space-y-1">
              {configErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {wallet.account && wallet.wrongNetwork && (
          <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
            <p className="flex items-center gap-2 text-sm text-amber-200">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
              Sua carteira está em outra rede. Este app funciona na <b>{CHAIN.name}</b>.
            </p>
            <button
              onClick={() =>
                wallet.changeNetwork().catch((e) => toast.show({ type: 'error', title: 'Erro ao trocar de rede', message: parseError(e) }))
              }
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
            {renderGate()}
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
            farmPaused={farm.data?.paused ?? false}
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
        <nav className="pb-safe px-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-900/90 backdrop-blur-md md:hidden">
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
