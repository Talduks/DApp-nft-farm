import { useState } from 'react';
import { formatEther } from 'ethers';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Egg, Loader2, Minus, Plus, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { BLOCK_TIME_SECONDS, CHAIN } from '../config';
import { useAsyncData } from '../hooks/useAsyncData';
import { usePolling } from '../hooks/usePolling';
import { useTx } from '../hooks/useTx';
import { formatDuration, formatNumber } from '../lib/format';
import { RARITIES, rarityOdds, rarityOf } from '../lib/nft';
import { logEggHatches } from '../services/activity';
import { buyEggs, fetchEggShop, getBlockNumber, hatchEggs, waitForBlockAfter, type HatchResult } from '../web3/eggs';
import type { EggItem } from '../web3/farm';
import { stakeNfts } from '../web3/farm';
import NftCard from './NftCard';

interface MysteryEggProps {
  uid: string;
  account: string;
  pendingEggs: EggItem[];
  refresh: () => Promise<void>;
  onGoToDashboard: () => void;
}

type Phase = 'idle' | 'buying' | 'incubating' | 'hatching';

const MysteryEgg = ({ uid, account, pendingEggs, refresh, onGoToDashboard }: MysteryEggProps) => {
  const run = useTx();
  const { data: shop } = useAsyncData('egg-shop', () => fetchEggShop(), 30_000);
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<HatchResult[] | null>(null);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [stakingResults, setStakingResults] = useState(false);

  usePolling(
    () => getBlockNumber().then(setBlockNumber).catch(() => undefined),
    BLOCK_TIME_SECONDS * 2000,
    pendingEggs.length > 0,
  );

  const busy = phase !== 'idle';
  const maxPerTx = shop?.maxPerTx ?? 10;
  const total = shop ? shop.price * BigInt(quantity) : 0n;

  const hatch = async (eggIds: number[]) => {
    setPhase('hatching');
    const outcome = await run(
      eggIds.length > 1 ? `Chocando ${eggIds.length} ovos` : 'Chocando ovo',
      (cb) => hatchEggs(eggIds, cb),
      'Seus NFTs nasceram!',
    );
    if (outcome) {
      setResults(outcome.results);
      void logEggHatches(uid, account, outcome.results, outcome.hash);
    }
    setPhase('idle');
    await refresh();
  };

  const handleBuy = async () => {
    if (!shop) return;
    setResults(null);
    setPhase('buying');
    const bought = await run(
      quantity > 1 ? `Comprando ${quantity} ovos` : 'Comprando ovo',
      (cb) => buyEggs(quantity, shop.price, cb),
      'Ovos comprados! Agora vamos chocar.',
    );
    if (!bought) {
      setPhase('idle');
      return;
    }
    // Commit-reveal: the speed comes from the hash of the purchase block, so hatch in a later one.
    setPhase('incubating');
    await waitForBlockAfter(bought.blockNumber);
    await hatch(bought.eggIds);
  };

  const handleStakeResults = async () => {
    if (!results) return;
    setStakingResults(true);
    const ok = await run('Stake dos novos NFTs', (cb) => stakeNfts(results.map((r) => r.tokenId), cb), 'NFTs farmando!');
    setStakingResults(false);
    await refresh();
    if (ok) onGoToDashboard();
  };

  const hatchWindow = shop?.hatchWindow ?? 256;
  const eggStatus = (egg: EggItem) => {
    if (blockNumber === null) return { expired: false, label: '…' };
    const blocksLeft = egg.commitBlock + hatchWindow - blockNumber;
    if (blocksLeft <= 0) return { expired: true, label: 'Expirado: nasce com velocidade mínima (10)' };
    return { expired: false, label: `Choque em até ~${formatDuration(blocksLeft * BLOCK_TIME_SECONDS)}` };
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      {pendingEggs.length > 0 && !busy && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-5"
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="flex items-center gap-2 font-bold text-yellow-200">
                <Clock className="h-5 w-5" /> {pendingEggs.length} ovo{pendingEggs.length > 1 ? 's' : ''} esperando para chocar
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-yellow-100/80">
                {pendingEggs.slice(0, 5).map((egg) => {
                  const status = eggStatus(egg);
                  return (
                    <li key={egg.id} className={status.expired ? 'text-red-300' : undefined}>
                      Ovo #{egg.id}: {status.label}
                    </li>
                  );
                })}
                {pendingEggs.length > 5 && <li>e mais {pendingEggs.length - 5}…</li>}
              </ul>
            </div>
            <button
              onClick={() => hatch(pendingEggs.slice(0, 50).map((e) => e.id))}
              className="shrink-0 rounded-xl bg-yellow-500 px-5 py-3 font-bold text-black transition-colors hover:bg-yellow-400"
            >
              Chocar agora
            </button>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col items-center gap-8">
          <AnimatePresence mode="wait">
            {results && !busy ? (
              <motion.div
                key="results"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="w-full rounded-[2rem] border border-purple-500/40 bg-slate-900/80 p-6 sm:p-8"
              >
                <div className="mb-6 text-center">
                  <Sparkles className="mx-auto mb-2 h-10 w-10 text-yellow-400" />
                  <h2 className="text-2xl font-bold text-white sm:text-3xl">
                    {results.length > 1 ? `${results.length} NFTs nasceram!` : 'Seu NFT nasceu!'}
                  </h2>
                  {results.some((r) => r.expired) && (
                    <p className="mt-2 text-sm text-red-300">
                      Algum ovo passou do prazo de chocagem e nasceu com velocidade mínima.
                    </p>
                  )}
                </div>
                <div
                  className={`mx-auto grid gap-4 ${results.length === 1 ? 'max-w-[240px] grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}`}
                >
                  {results.map((r, i) => (
                    <motion.div
                      key={r.tokenId}
                      initial={{ rotateY: 90, opacity: 0 }}
                      animate={{ rotateY: 0, opacity: 1 }}
                      transition={{ delay: i * 0.15, type: 'spring' }}
                    >
                      <NftCard id={r.tokenId} speed={r.speed} />
                    </motion.div>
                  ))}
                </div>
                <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <button
                    onClick={() => setResults(null)}
                    className="rounded-xl bg-white/5 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
                  >
                    Comprar mais
                  </button>
                  <button
                    onClick={onGoToDashboard}
                    className="rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15"
                  >
                    Ver dashboard
                  </button>
                  <button
                    onClick={handleStakeResults}
                    disabled={stakingResults}
                    className="flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition-colors hover:bg-purple-500 disabled:opacity-60"
                  >
                    {stakingResults && <Loader2 className="h-4 w-4 animate-spin" />}
                    Fazer stake agora
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="egg"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="relative flex w-full flex-col items-center"
              >
                <motion.div
                  animate={
                    busy
                      ? { rotate: [0, -6, 6, -6, 6, 0], transition: { repeat: Infinity, duration: phase === 'hatching' ? 0.3 : 0.6 } }
                      : { y: [0, -10, 0], transition: { repeat: Infinity, duration: 4 } }
                  }
                  className="relative z-10"
                >
                  <div className="relative flex h-72 w-56 items-center justify-center overflow-hidden rounded-[50%_50%_50%_50%/60%_60%_40%_40%] border-4 border-yellow-600/20 bg-gradient-to-b from-yellow-100 to-yellow-500 shadow-[0_0_60px_rgba(234,179,8,0.25)] sm:h-96 sm:w-72">
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/40 to-transparent opacity-50" />
                    <span className="text-8xl font-black text-yellow-900 opacity-20 select-none sm:text-9xl">?</span>
                    {quantity > 1 && !busy && (
                      <span className="absolute right-6 bottom-10 rounded-full bg-yellow-900/80 px-3 py-1 text-sm font-black text-yellow-100">
                        x{quantity}
                      </span>
                    )}
                  </div>
                </motion.div>
                <div className="pointer-events-none absolute top-1/2 left-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-400 opacity-10 blur-[80px]" />

                <div className="mt-8 flex min-h-[64px] flex-col items-center gap-2">
                  {busy ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                      <p className="animate-pulse text-lg font-bold text-yellow-400">
                        {phase === 'buying' && 'Comprando…'}
                        {phase === 'incubating' && 'Incubando… aguardando o próximo bloco'}
                        {phase === 'hatching' && 'Chocando…'}
                      </p>
                    </>
                  ) : (
                    <p className="text-center text-sm text-slate-400">
                      Cada ovo choca um Speed NFT com velocidade aleatória entre 10 e 100.
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-xs font-bold tracking-wider text-gray-400 uppercase">Preço por ovo</p>
            <p className="mt-1 text-3xl font-black text-white">
              {shop ? formatNumber(Number(formatEther(shop.price)), 4) : '…'}{' '}
              <span className="text-lg text-yellow-400">{CHAIN.currency}</span>
            </p>

            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-300">Quantidade</span>
              <div className="flex items-center gap-2 rounded-xl bg-white/5 p-1">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={busy || quantity <= 1}
                  className="rounded-lg p-2 text-white hover:bg-white/10 disabled:opacity-30"
                  aria-label="Diminuir quantidade"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center font-bold text-white tabular-nums">{quantity}</span>
                <button
                  onClick={() => setQuantity((q) => Math.min(maxPerTx, q + 1))}
                  disabled={busy || quantity >= maxPerTx}
                  className="rounded-lg p-2 text-white hover:bg-white/10 disabled:opacity-30"
                  aria-label="Aumentar quantidade"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <button
              onClick={handleBuy}
              disabled={busy || !shop || shop.paused}
              className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-500 px-6 py-4 text-lg font-bold text-black shadow-[0_0_30px_rgba(234,179,8,0.3)] transition-all hover:from-yellow-400 hover:to-orange-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Egg size={22} className="text-yellow-900" />
              {shop?.paused
                ? 'Vendas pausadas'
                : `Comprar ${quantity > 1 ? `${quantity} ovos` : 'ovo'} (${shop ? formatNumber(Number(formatEther(total)), 4) : '…'} ${CHAIN.currency})`}
            </button>
            <p className="mt-3 text-center text-xs text-gray-500">
              São duas confirmações: a compra e, um bloco depois, a chocagem.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <Zap className="h-4 w-4 text-yellow-400" /> Chances por raridade
            </h3>
            <ul className="space-y-2">
              {RARITIES.map((rarity) => (
                <li key={rarity.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${rarity.badgeClass}`}>{rarity.label}</span>
                  <span className="text-gray-400">
                    {rarity.min}–{rarity.max} SPD
                  </span>
                  <span className="w-14 text-right font-bold text-white tabular-nums">
                    {formatNumber(rarityOdds(rarity) * 100, 1)}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex gap-2 text-xs text-gray-500">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
              Sorteio justo: a velocidade vem do hash do bloco da compra, que ainda não existia quando você pagou.
              Ninguém consegue escolher o resultado.
            </p>
          </div>

          {shop && (
            <p className="text-center text-xs text-gray-500">
              {shop.eggsSold} ovos vendidos · {shop.totalMinted} NFTs nascidos ·{' '}
              {rarityOf(100).label} a partir de 90 SPD
            </p>
          )}
        </aside>
      </div>
    </div>
  );
};

export default MysteryEgg;
