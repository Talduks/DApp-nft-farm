import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Coins, Egg, Gauge, Layers, Loader2, PauseCircle, TrendingUp, Zap } from 'lucide-react';
import { TOKEN_SYMBOL } from '../config';
import { useTx } from '../hooks/useTx';
import { formatToken } from '../lib/format';
import { logRewardClaim } from '../services/activity';
import { claimRewards, stakeNfts, withdrawNfts, type FarmData, type NftItem } from '../web3/farm';
import NftCard from './NftCard';
import { useToast } from './ui/Toaster';

interface DashboardProps {
  uid: string;
  account: string;
  data: FarmData | null;
  loading: boolean;
  refresh: () => Promise<void>;
  onGoToEggs: () => void;
}

/** Below this (1e-6 DAPPF) the amount renders as zero, so claiming would only burn gas. */
const DUST = 10n ** 12n;

/** Pending rewards extrapolated in real time from the last on-chain snapshot. */
function useLiveRewards(data: FarmData | null): bigint {
  const [now, setNow] = useState(Date.now());
  const accruing = Boolean(data && data.rewardPerSecond > 0n);

  useEffect(() => {
    if (!accruing) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [accruing]);

  if (!data) return 0n;
  const elapsedMs = BigInt(Math.max(0, now - data.fetchedAt));
  return data.pendingRewards + (data.rewardPerSecond * elapsedMs) / 1000n;
}

function StatCard({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
      <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-400 uppercase">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold text-white sm:text-3xl">{children}</div>
    </div>
  );
}

function useSelection(items: NftItem[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Drop selections for NFTs that moved (staked, withdrawn, transferred).
  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => items.some((n) => n.id === id))));
  }, [items]);
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { selected, toggle, clear: () => setSelected(new Set()) };
}

const Dashboard = ({ uid, account, data, loading, refresh, onGoToEggs }: DashboardProps) => {
  const run = useTx();
  const toast = useToast();
  const live = useLiveRewards(data);
  const paused = data?.paused ?? false;
  const [busy, setBusy] = useState<'stake' | 'withdraw' | 'claim' | null>(null);

  const walletNfts = useMemo(() => data?.walletNfts ?? [], [data]);
  const stakedNfts = useMemo(() => data?.stakedNfts ?? [], [data]);
  const wallet = useSelection(walletNfts);
  const staked = useSelection(stakedNfts);

  const perDay = data ? data.rewardPerSecond * 86_400n : 0n;

  const handleStake = async (ids: number[]) => {
    setBusy('stake');
    const ok = await run(`Stake de ${ids.length} NFT${ids.length > 1 ? 's' : ''}`, (cb) => stakeNfts(ids, cb), 'NFTs farmando!');
    if (ok) wallet.clear();
    await refresh();
    setBusy(null);
  };

  const handleWithdraw = async (ids: number[]) => {
    setBusy('withdraw');
    const result = await run(`Saque de ${ids.length} NFT${ids.length > 1 ? 's' : ''}`, (cb) => withdrawNfts(ids, cb), 'NFTs devolvidos.');
    if (result) {
      staked.clear();
      void logRewardClaim(uid, account, result.claimed, result.hash);
      if (result.deferred > 0n) {
        toast.show({
          type: 'info',
          title: 'Recompensas continuam pendentes',
          message: `${formatToken(result.deferred, 4)} ${TOKEN_SYMBOL} ficaram registrados para você${
            data?.paused ? ' porque o farm está pausado' : ''
          }. Use "Resgatar" quando o farm voltar a pagar.`,
        });
      } else if (result.claimed > 0n) {
        toast.show({ type: 'success', title: 'Recompensas resgatadas', message: `${formatToken(result.claimed, 4)} ${TOKEN_SYMBOL} enviados para sua carteira.` });
      }
    }
    await refresh();
    setBusy(null);
  };

  const handleClaim = async () => {
    setBusy('claim');
    const result = await run('Resgatando recompensas', (cb) => claimRewards(cb));
    if (result) void logRewardClaim(uid, account, result.claimed, result.hash);
    await refresh();
    setBusy(null);
  };

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando seus dados on-chain…
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 sm:gap-8">
      {paused && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100" role="status">
          <PauseCircle className="h-5 w-5 shrink-0 text-amber-400" />
          <p>
            O farm está <b>pausado</b> pelo administrador: novos stakes e resgates de recompensa estão suspensos. Você pode sacar seus
            NFTs a qualquer momento; as recompensas ficam registradas e continuam acumulando.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon={<Coins size={14} className="text-yellow-500" />} label={`Saldo ${TOKEN_SYMBOL}`}>
          {formatToken(data.tokenBalance, 2)}
        </StatCard>
        <StatCard icon={<Zap size={14} className="text-blue-500" />} label="Velocidade">
          {data.totalSpeed} <span className="text-sm font-normal text-gray-500">SPD</span>
        </StatCard>
        <StatCard icon={<TrendingUp size={14} className="text-emerald-500" />} label="Ganho por dia">
          {formatToken(perDay, 2)} <span className="text-sm font-normal text-gray-500">{TOKEN_SYMBOL}</span>
        </StatCard>
        <StatCard icon={<Gauge size={14} className="text-purple-400" />} label="NFTs em farm">
          {stakedNfts.length} <span className="text-sm font-normal text-gray-500">/ {stakedNfts.length + walletNfts.length}</span>
        </StatCard>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-purple-500/30 bg-gradient-to-r from-purple-900/40 to-pink-900/40 p-5 backdrop-blur-md sm:flex-row sm:items-center">
        <div>
          <p className="mb-1 text-xs font-bold tracking-wider text-purple-300 uppercase">Recompensas pendentes</p>
          <p className="bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text font-mono text-3xl font-black text-transparent tabular-nums sm:text-4xl">
            {live > 0n && live < DUST ? '< 0,000001' : formatToken(live, 6)} <span className="text-lg">{TOKEN_SYMBOL}</span>
          </p>
        </div>
        <button
          onClick={handleClaim}
          disabled={busy !== null || live < DUST || paused}
          title={paused ? 'Resgates suspensos enquanto o farm estiver pausado' : undefined}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-purple-900 shadow-lg transition-all hover:bg-purple-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {busy === 'claim' && <Loader2 className="h-4 w-4 animate-spin" />}
          Resgatar
        </button>
      </div>

      {data.pendingEggs.length > 0 && (
        <button
          onClick={onGoToEggs}
          className="flex items-center gap-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-left transition-colors hover:bg-yellow-500/15"
        >
          <Egg className="h-6 w-6 shrink-0 text-yellow-400" />
          <span className="text-sm text-yellow-100">
            Você tem <b>{data.pendingEggs.length}</b> ovo{data.pendingEggs.length > 1 ? 's' : ''} esperando para chocar.
            Choque logo para garantir uma velocidade aleatória.
          </span>
        </button>
      )}

      <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-2">
        <section className="rounded-3xl border border-white/5 bg-slate-900/60 p-5 sm:p-6">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl">
              <Layers size={20} className="text-blue-400" />
              Sua carteira
              <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">{walletNfts.length}</span>
            </h3>
            {walletNfts.length > 0 && (
              <div className="flex gap-2" title={paused ? 'Novos stakes suspensos enquanto o farm estiver pausado' : undefined}>
                <button
                  disabled={busy !== null || paused || wallet.selected.size === 0}
                  onClick={() => handleStake([...wallet.selected])}
                  className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                >
                  Stake ({wallet.selected.size})
                </button>
                <button
                  disabled={busy !== null || paused}
                  onClick={() => handleStake(walletNfts.map((n) => n.id))}
                  className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                >
                  Stake de todos
                </button>
              </div>
            )}
          </header>

          <div className="custom-scrollbar grid max-h-[520px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            <AnimatePresence>
              {walletNfts.map((nft) => (
                <NftCard
                  key={nft.id}
                  id={nft.id}
                  speed={nft.speed}
                  rewardRate={data.rewardRate}
                  selected={wallet.selected.has(nft.id)}
                  onToggle={busy ? undefined : () => wallet.toggle(nft.id)}
                />
              ))}
            </AnimatePresence>
            {walletNfts.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center gap-3 py-12 text-gray-500">
                <Layers size={32} className="opacity-20" />
                <p className="text-sm">Nenhum NFT na carteira</p>
                <button onClick={onGoToEggs} className="text-sm font-bold text-yellow-400 hover:text-yellow-300">
                  Comprar um ovo misterioso →
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-purple-500/20 bg-slate-900/60 p-5 shadow-[0_0_40px_rgba(168,85,247,0.05)] sm:p-6">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl">
              <Zap size={20} className="text-purple-400" />
              Em farm
              <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">{stakedNfts.length}</span>
            </h3>
            {stakedNfts.length > 0 && (
              <div className="flex gap-2">
                <button
                  disabled={busy !== null || staked.selected.size === 0}
                  onClick={() => handleWithdraw([...staked.selected])}
                  className="rounded-full bg-purple-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-purple-500 disabled:opacity-40"
                >
                  Sacar ({staked.selected.size})
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => handleWithdraw(stakedNfts.map((n) => n.id))}
                  className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                >
                  Sacar todos
                </button>
              </div>
            )}
          </header>

          <div className="custom-scrollbar grid max-h-[520px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            <AnimatePresence>
              {stakedNfts.map((nft) => (
                <NftCard
                  key={nft.id}
                  id={nft.id}
                  speed={nft.speed}
                  rewardRate={data.rewardRate}
                  staked
                  selected={staked.selected.has(nft.id)}
                  onToggle={busy ? undefined : () => staked.toggle(nft.id)}
                />
              ))}
            </AnimatePresence>
            {stakedNfts.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center gap-2 py-12 text-gray-500">
                <Zap size={32} className="opacity-20" />
                <p className="text-sm">Nenhum NFT em farm</p>
                {walletNfts.length > 0 && <p className="text-xs">Selecione NFTs da carteira e clique em Stake.</p>}
              </div>
            )}
          </div>
        </section>
      </div>

      <p className="text-center text-xs text-gray-500">
        {loading ? 'Atualizando…' : 'Os dados são atualizados automaticamente a cada 15 segundos.'} Sacar NFTs também
        resgata as recompensas acumuladas{paused ? ' (quando o farm não estiver pausado)' : ''}.
      </p>
    </div>
  );
};

export default Dashboard;
