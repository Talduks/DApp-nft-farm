import { useMemo, useState } from 'react';
import { formatUnits, parseUnits } from 'ethers';
import { motion } from 'framer-motion';
import { CalendarClock, Gift, Loader2, Lock, PiggyBank, ShieldCheck, TrendingUp } from 'lucide-react';
import { TOKEN_SYMBOL } from '../config';
import { useAsyncData } from '../hooks/useAsyncData';
import { useTx } from '../hooks/useTx';
import { formatDate, formatDuration, formatPercentBps, formatToken } from '../lib/format';
import { logStake, logUnstake } from '../services/activity';
import { eventsOf } from '../web3/contracts';
import { fetchStakingData, quoteReward, stakeTokens, unstake, type StakePosition } from '../web3/staking';

const PLAN_COLORS = ['from-blue-500 to-cyan-500', 'from-purple-500 to-pink-500', 'from-orange-500 to-red-500'];
const MONTH_SECONDS = 30 * 24 * 60 * 60;

interface TokenStakingProps {
  uid: string;
  account: string;
  onChanged: () => Promise<void>;
}

function parseAmount(value: string): bigint | null {
  if (!value.trim()) return null;
  try {
    const parsed = parseUnits(value.trim().replace(',', '.'), 18);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

const TokenStaking = ({ uid, account, onChanged }: TokenStakingProps) => {
  const run = useTx();
  const { data, refresh } = useAsyncData(account, fetchStakingData, 20_000);
  const [selectedMonths, setSelectedMonths] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'stake' | 'unstake' | null>(null);

  const plans = data?.plans ?? [];
  const plan = plans.find((p) => p.months === selectedMonths) ?? plans[plans.length - 1];
  const amount = parseAmount(input);
  const reward = amount && plan ? quoteReward(amount, plan) : 0n;
  const now = Math.floor(Date.now() / 1000);

  const validation = useMemo(() => {
    if (!data || !input) return null;
    if (amount === null) return 'Valor inválido.';
    if (amount > data.balance) return `Saldo insuficiente. Você tem ${formatToken(data.balance, 4)} ${TOKEN_SYMBOL}.`;
    if (reward > data.rewardPool)
      return `O pool de recompensas cobre no máximo ${formatToken(data.rewardPool, 2)} ${TOKEN_SYMBOL} de rendimento agora. Tente um valor menor.`;
    return null;
  }, [data, input, amount, reward]);

  const unlocked = (data?.positions ?? []).filter((p) => p.endTime <= now);

  const handleStake = async () => {
    if (!amount || !plan || validation) return;
    setBusy('stake');
    const receipt = await run(
      `Stake de ${formatToken(amount, 2)} ${TOKEN_SYMBOL}`,
      (cb) => stakeTokens(amount, plan.months, cb),
      `Tokens bloqueados por ${plan.months} meses.`,
    );
    if (receipt) {
      setInput('');
      const [event] = eventsOf(receipt, 'staking', 'Staked');
      if (event) {
        void logStake(
          uid,
          account,
          {
            stakeId: Number(event.args.stakeId),
            amount,
            lockMonths: plan.months,
            endTime: Number(event.args.endTime),
          },
          receipt.hash,
        );
      }
    }
    await Promise.all([refresh(), onChanged()]);
    setBusy(null);
  };

  const handleUnstake = async (positions: StakePosition[]) => {
    setBusy('unstake');
    const receipt = await run(
      positions.length > 1 ? `Resgatando ${positions.length} stakes` : 'Resgatando stake',
      (cb) => unstake(positions.map((p) => p.stakeId), cb),
      'Principal + recompensa enviados para sua carteira.',
    );
    if (receipt) void logUnstake(uid, account, positions, receipt.hash);
    await Promise.all([refresh(), onChanged()]);
    setBusy(null);
  };

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando staking…
      </div>
    );
  }

  const maxApr = plans.reduce((max, p) => Math.max(max, p.aprBps), 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:gap-8">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-green-500/10 p-3">
          <TrendingUp className="h-8 w-8 text-green-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Token Staking</h1>
          <p className="text-sm text-gray-400">Bloqueie {TOKEN_SYMBOL} e receba rendimento garantido no fim do prazo</p>
        </div>
      </div>

      {data.paused && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Novos stakes estão pausados pelo administrador. Resgates continuam funcionando normalmente.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-green-500/30 bg-gradient-to-r from-green-900/40 to-blue-900/40 p-6 md:col-span-2"
        >
          <p className="mb-1 text-xs font-bold tracking-wider text-green-400 uppercase">Rendimento anual (APR)</p>
          <p className="mb-2 text-3xl font-black text-white sm:text-4xl">até {formatPercentBps(maxApr)}</p>
          <p className="flex max-w-md gap-2 text-sm text-gray-300">
            <ShieldCheck className="h-5 w-5 shrink-0 text-green-400" />
            Cada stake reserva a própria recompensa no momento em que é criado. O administrador não consegue sacar o
            seu principal nem recompensas já prometidas.
          </p>
          <TrendingUp className="absolute right-0 bottom-0 -mr-8 -mb-8 h-40 w-40 text-green-500/10" />
        </motion.div>

        <div className="flex flex-col justify-center gap-4 rounded-2xl border border-white/10 bg-slate-900/80 p-6">
          <div>
            <p className="mb-1 text-xs font-bold tracking-wider text-gray-400 uppercase">Saldo disponível</p>
            <p className="truncate text-2xl font-bold text-white" title={formatUnits(data.balance, 18)}>
              {formatToken(data.balance, 2)} <span className="text-sm text-gray-500">{TOKEN_SYMBOL}</span>
            </p>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-bold tracking-wider text-gray-400 uppercase">
              <PiggyBank className="h-3.5 w-3.5" /> Pool de recompensas
            </p>
            <p className="text-lg font-bold text-emerald-300">
              {formatToken(data.rewardPool, 2)} <span className="text-xs text-gray-500">{TOKEN_SYMBOL}</span>
            </p>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <CalendarClock size={18} className="text-purple-400" />
          Escolha o período
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {plans.map((p, i) => {
            const active = plan?.months === p.months;
            return (
              <motion.button
                key={p.months}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedMonths(p.months)}
                className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all sm:p-6 ${
                  active
                    ? 'border-purple-500 bg-purple-500/10 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                    : 'border-white/10 bg-white/5 hover:border-white/30'
                }`}
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${PLAN_COLORS[i % PLAN_COLORS.length]} opacity-0 transition-opacity group-hover:opacity-10`}
                />
                <div className="mb-4 flex items-start justify-between">
                  <div className={`rounded-lg p-2 ${active ? 'bg-purple-500 text-white' : 'bg-white/10 text-gray-400'}`}>
                    <Lock size={20} />
                  </div>
                  {active && (
                    <span className="rounded-full bg-purple-500 px-2 py-1 text-[10px] font-bold text-white">SELECIONADO</span>
                  )}
                </div>
                <p className="mb-1 text-3xl font-black text-white">+{formatPercentBps((p.aprBps * p.months) / 12)}</p>
                <p className="text-sm font-medium text-gray-400">
                  {p.months} meses · {formatPercentBps(p.aprBps)} ao ano
                </p>
              </motion.button>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-8">
        <h3 className="mb-6 text-lg font-bold text-white">Quanto você quer colocar em stake?</h3>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row">
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="decimal"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="0,00"
              aria-label={`Quantidade de ${TOKEN_SYMBOL}`}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-4 pr-20 text-xl text-white transition-colors focus:border-purple-500 focus:outline-none"
            />
            <button
              onClick={() => setInput(formatUnits(data.balance, 18))}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-purple-300 transition-colors hover:bg-white/20"
            >
              MAX
            </button>
          </div>
          <button
            onClick={handleStake}
            disabled={busy !== null || !amount || Boolean(validation) || data.paused || !plan}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 py-4 text-lg font-bold text-white shadow-lg transition-all hover:from-purple-500 hover:to-pink-500 disabled:cursor-not-allowed disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500 sm:w-52"
          >
            {busy === 'stake' && <Loader2 className="h-5 w-5 animate-spin" />}
            Confirmar stake
          </button>
        </div>

        {validation && <p className="mb-4 text-sm text-amber-400">{validation}</p>}

        {amount && plan && !validation && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-green-500/20 bg-green-500/10 p-4 sm:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-bold tracking-wider text-green-400 uppercase">Rendimento garantido</p>
              <p className="text-xl font-bold text-white">
                +{formatToken(reward, 4)} {TOKEN_SYMBOL}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold tracking-wider text-gray-500 uppercase">Você recebe no fim</p>
              <p className="text-xl font-bold text-white">
                {formatToken(amount + reward, 4)} {TOKEN_SYMBOL}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold tracking-wider text-gray-500 uppercase">Liberação</p>
              <p className="font-medium text-white">{formatDate(now + plan.months * MONTH_SECONDS)}</p>
            </div>
          </div>
        )}
      </section>

      {data.positions.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Gift size={18} className="text-pink-400" />
              Seus stakes ativos
            </h2>
            {unlocked.length > 1 && (
              <button
                onClick={() => handleUnstake(unlocked)}
                disabled={busy !== null}
                className="rounded-full bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:opacity-50"
              >
                Resgatar todos liberados ({unlocked.length})
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.positions.map((position) => {
              const total = position.endTime - position.startTime;
              const progress = Math.min(100, Math.max(0, ((now - position.startTime) / total) * 100));
              const canWithdraw = position.endTime <= now;
              return (
                <motion.div
                  key={position.stakeId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-white/5 bg-slate-800/50 p-5 transition-colors hover:border-white/10"
                >
                  <div className="mb-5 flex items-start justify-between">
                    <div>
                      <p className="text-2xl font-bold text-white">{formatToken(position.amount, 2)}</p>
                      <p className="text-xs text-gray-500">
                        {TOKEN_SYMBOL} em stake · #{position.stakeId}
                      </p>
                    </div>
                    <span className="rounded-lg border border-white/5 bg-white/5 px-3 py-1 text-xs font-bold text-gray-300">
                      {position.lockMonths} meses
                    </span>
                  </div>

                  <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full ${canWithdraw ? 'bg-green-500' : 'bg-gradient-to-r from-purple-500 to-pink-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Recompensa</span>
                      <span className="font-bold text-green-400">
                        +{formatToken(position.reward, 4)} {TOKEN_SYMBOL}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Status</span>
                      <span className={`font-bold ${canWithdraw ? 'text-green-400' : 'text-yellow-500'}`}>
                        {canWithdraw ? 'Liberado para resgate' : `${formatDuration(position.endTime - now)} restantes`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Libera em</span>
                      <span className="text-gray-300">{formatDate(position.endTime)}</span>
                    </div>
                  </div>

                  {canWithdraw && (
                    <button
                      onClick={() => handleUnstake([position])}
                      disabled={busy !== null}
                      className="mt-4 w-full rounded-xl bg-green-600 py-3 font-bold text-white shadow-lg transition-all hover:bg-green-500 active:scale-95 disabled:opacity-50"
                    >
                      Resgatar {formatToken(position.amount + position.reward, 2)} {TOKEN_SYMBOL}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default TokenStaking;
