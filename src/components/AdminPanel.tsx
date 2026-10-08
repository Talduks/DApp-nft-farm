import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ethers, formatEther, formatUnits, isAddress, parseEther, parseUnits } from 'ethers';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ban,
  CheckCircle,
  Copy,
  Egg,
  Loader2,
  Pause,
  Play,
  PiggyBank,
  RefreshCw,
  Search,
  Settings,
  Shield,
  TrendingUp,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { CHAIN, TOKEN_SYMBOL, addressUrl } from '../config';
import { useAsyncData } from '../hooks/useAsyncData';
import { useTx } from '../hooks/useTx';
import { formatNumber, formatPercentBps, formatToken, shortAddress } from '../lib/format';
import { rarityOf } from '../lib/nft';
import { getAllUsers, getEggHistory, setUserBan, type UserProfile } from '../services/activity';
import {
  fetchAdminOverview,
  fetchUserNfts,
  fundStakingPool,
  setMintPrice,
  setPaused,
  setRewardRate,
  setStakingPlan,
  setTreasury,
  sweepToTreasury,
  withdrawSales,
  withdrawStakingPool,
  type AdminOverview,
} from '../web3/admin';

interface AdminPanelProps {
  account: string;
  uid: string;
}

type Tab = 'overview' | 'controls' | 'users';

const sameAddress = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

function Card({ title, value, hint, icon }: { title: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wider text-gray-400 uppercase">
        {icon}
        {title}
      </p>
      <div className="text-2xl font-bold text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

function ControlForm({
  title,
  description,
  disabled,
  children,
}: {
  title: string;
  description: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-slate-900/60 p-5 ${disabled ? 'opacity-50' : ''}`}>
      <h3 className="font-bold text-white">{title}</h3>
      <p className="mt-1 mb-4 text-xs text-gray-400">{description}</p>
      <fieldset disabled={disabled} className="flex flex-col gap-2 sm:flex-row">
        {children}
      </fieldset>
    </div>
  );
}

const inputClass =
  'min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none';
const buttonClass =
  'rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-purple-500 disabled:opacity-50';

function Overview({ data }: { data: AdminOverview }) {
  const supplyPct = Number((data.token.totalSupply * 10_000n) / (data.token.maxSupply || 1n)) / 100;
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <Egg className="h-5 w-5 text-yellow-500" /> Ovos e NFTs
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card
            title="Saldo de vendas"
            value={`${formatNumber(Number(formatEther(data.nft.balance)), 4)} ${CHAIN.currency}`}
            hint="No contrato SpeedNFT"
          />
          <Card title="Preço do ovo" value={`${formatNumber(Number(formatEther(data.nft.mintPrice)), 4)} ${CHAIN.currency}`} />
          <Card title="Ovos vendidos" value={data.nft.eggsSold} hint={`${data.nft.totalMinted} NFTs nascidos`} />
          <Card
            title="Vendas"
            value={data.nft.paused ? <span className="text-amber-400">Pausadas</span> : <span className="text-emerald-400">Ativas</span>}
            hint={
              data.nft.treasury === ethers.ZeroAddress ? (
                <span className="text-amber-400">Tesouraria não definida</span>
              ) : (
                <>Tesouraria {shortAddress(data.nft.treasury)}</>
              )
            }
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <Zap className="h-5 w-5 text-purple-400" /> Farm de NFTs
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card title="NFTs em farm" value={data.farm.totalStaked} hint={`${data.farm.totalSpeed} SPD no total`} />
          <Card
            title="Emissão por dia"
            value={`${formatToken(data.farm.rewardRate * BigInt(data.farm.totalSpeed) * 86_400n, 2)}`}
            hint={`${TOKEN_SYMBOL}/dia com o farm atual`}
          />
          <Card
            title="Taxa por SPD"
            value={formatToken(data.farm.rewardRate * 86_400n, 4)}
            hint={`${TOKEN_SYMBOL} por SPD por dia`}
          />
          <Card
            title={`Supply ${TOKEN_SYMBOL}`}
            value={`${formatNumber(supplyPct, 4)}%`}
            hint={`${formatToken(data.token.totalSupply, 0)} de ${formatToken(data.token.maxSupply, 0)}`}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <TrendingUp className="h-5 w-5 text-green-500" /> Staking de tokens
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card title="Total em stake" value={formatToken(data.staking.totalStaked, 2)} hint={TOKEN_SYMBOL} />
          <Card title="Recompensas reservadas" value={formatToken(data.staking.rewardsReserved, 2)} hint="Prometidas a stakes abertos" />
          <Card
            title="Pool livre"
            value={formatToken(data.staking.rewardPool, 2)}
            hint="Disponível para novos stakes"
            icon={<PiggyBank className="h-3.5 w-3.5" />}
          />
          <Card title="Stakes ativos" value={data.staking.activeStakes} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs text-gray-400 uppercase">
              <tr>
                <th className="px-5 py-3">Plano</th>
                <th className="px-5 py-3">APR</th>
                <th className="px-5 py-3">Rendimento no período</th>
                <th className="px-5 py-3 text-right">Em stake</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.staking.plans.map((p) => (
                <tr key={p.months}>
                  <td className="px-5 py-3 font-bold text-white">{p.months} meses</td>
                  <td className="px-5 py-3">{p.aprBps ? formatPercentBps(p.aprBps) : <span className="text-gray-500">desativado</span>}</td>
                  <td className="px-5 py-3">{formatPercentBps((p.aprBps * p.months) / 12)}</td>
                  <td className="px-5 py-3 text-right">
                    {formatToken(p.staked, 2)} {TOKEN_SYMBOL}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Controls({ data, account, onDone }: { data: AdminOverview; account: string; onDone: () => Promise<void> }) {
  const run = useTx();
  const [withdrawTo, setWithdrawTo] = useState(account);
  const [treasuryInput, setTreasuryInput] = useState(data.nft.treasury === ethers.ZeroAddress ? '' : data.nft.treasury);
  const [price, setPrice] = useState(formatEther(data.nft.mintPrice));
  const [perDay, setPerDay] = useState(formatUnits(data.farm.rewardRate * 86_400n, 18));
  const [fundAmount, setFundAmount] = useState('');
  const [poolWithdraw, setPoolWithdraw] = useState('');
  const [planMonths, setPlanMonths] = useState('12');
  const [planApr, setPlanApr] = useState('22');
  const [busy, setBusy] = useState(false);

  const isNftOwner = sameAddress(data.owners.nft, account);
  const isFarmOwner = sameAddress(data.owners.farm, account);
  const isStakingOwner = sameAddress(data.owners.staking, account);

  const execute = async (title: string, action: Parameters<typeof run>[1]) => {
    setBusy(true);
    const ok = await run(title, action);
    setBusy(false);
    if (ok) await onDone();
  };

  const safeParse = (fn: () => bigint): bigint | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };

  const priceWei = safeParse(() => parseEther(price || '0'));
  // Rate is configured per second; admins think per day.
  const rateWei = safeParse(() => parseUnits(perDay || '0', 18) / 86_400n);
  const fundWei = safeParse(() => parseUnits(fundAmount || '0', 18));
  const poolWei = safeParse(() => parseUnits(poolWithdraw || '0', 18));

  return (
    <div className="space-y-4">
      {!isNftOwner && !isFarmOwner && !isStakingOwner && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Esta carteira não é dona de nenhum contrato. Os controles ficam desabilitados.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ControlForm
          title="Tesouraria dos ovos"
          description={
            <>
              Destino fixo de "Varrer para tesouraria" (ideal: multisig ou carteira fria). Com ela definida, qualquer carteira — inclusive
              o bot <code className="rounded bg-black/30 px-1">npm run withdraw-bot</code> — pode disparar o saque sem ter a chave do dono.
              {data.nft.treasury === ethers.ZeroAddress && <b className="text-amber-300"> Ainda não definida.</b>}
            </>
          }
          disabled={!isNftOwner || busy}
        >
          <input value={treasuryInput} onChange={(e) => setTreasuryInput(e.target.value.trim())} className={inputClass} placeholder="0x…" />
          <button
            className={buttonClass}
            disabled={!isAddress(treasuryInput) || treasuryInput.toLowerCase() === data.nft.treasury.toLowerCase()}
            onClick={() => execute('Definindo tesouraria', (cb) => setTreasury(treasuryInput, cb))}
          >
            Salvar
          </button>
        </ControlForm>

        <ControlForm
          title="Varrer para tesouraria"
          description={`Envia ${formatNumber(Number(formatEther(data.nft.balance)), 4)} ${CHAIN.currency} do contrato para ${
            data.nft.treasury === ethers.ZeroAddress ? 'a tesouraria (defina-a primeiro)' : shortAddress(data.nft.treasury)
          }. Qualquer carteira pode executar.`}
          disabled={busy}
        >
          <button
            className={`${buttonClass} w-full`}
            disabled={data.nft.balance === 0n || data.nft.treasury === ethers.ZeroAddress}
            onClick={() => execute('Varrendo para a tesouraria', (cb) => sweepToTreasury(cb))}
          >
            Varrer agora
          </button>
        </ControlForm>

        <ControlForm
          title="Sacar vendas para outro endereço"
          description={`Só o dono. Envia ${formatNumber(Number(formatEther(data.nft.balance)), 4)} ${CHAIN.currency} do contrato para o endereço informado.`}
          disabled={!isNftOwner || busy}
        >
          <input value={withdrawTo} onChange={(e) => setWithdrawTo(e.target.value.trim())} className={inputClass} placeholder="0x…" />
          <button
            className={buttonClass}
            disabled={data.nft.balance === 0n || !isAddress(withdrawTo)}
            onClick={() => execute('Sacando vendas', (cb) => withdrawSales(withdrawTo, cb))}
          >
            Sacar
          </button>
        </ControlForm>

        <ControlForm title="Preço do ovo" description={`Em ${CHAIN.currency}. Vale para as próximas compras.`} disabled={!isNftOwner || busy}>
          <input value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} inputMode="decimal" />
          <button
            className={buttonClass}
            disabled={!priceWei}
            onClick={() => priceWei && execute('Atualizando preço', (cb) => setMintPrice(priceWei, cb))}
          >
            Salvar
          </button>
        </ControlForm>

        <ControlForm
          title="Taxa de recompensa do farm"
          description={
            <>
              {TOKEN_SYMBOL} por SPD por dia. A mudança vale só daqui pra frente — o que já foi acumulado é preservado.
              Máximo: {formatToken(data.farm.maxRewardRate * 86_400n, 2)}.
            </>
          }
          disabled={!isFarmOwner || busy}
        >
          <input value={perDay} onChange={(e) => setPerDay(e.target.value)} className={inputClass} inputMode="decimal" />
          <button
            className={buttonClass}
            disabled={rateWei === null || rateWei > data.farm.maxRewardRate}
            onClick={() => rateWei !== null && execute('Atualizando taxa', (cb) => setRewardRate(rateWei, cb))}
          >
            Salvar
          </button>
        </ControlForm>

        <ControlForm
          title="Aportar no pool de staking"
          description={`Transfere ${TOKEN_SYMBOL} da sua carteira para o pool que paga os rendimentos.`}
          disabled={!isStakingOwner || busy}
        >
          <input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} className={inputClass} placeholder="Quantidade" inputMode="decimal" />
          <button
            className={buttonClass}
            disabled={!fundWei}
            onClick={() => fundWei && execute('Aportando no pool', (cb) => fundStakingPool(fundWei, cb))}
          >
            Aportar
          </button>
        </ControlForm>

        <ControlForm
          title="Retirar do pool livre"
          description={`Só a parte não reservada (${formatToken(data.staking.rewardPool, 2)} ${TOKEN_SYMBOL}). Principal e recompensas prometidas ficam protegidos pelo contrato.`}
          disabled={!isStakingOwner || busy}
        >
          <input value={poolWithdraw} onChange={(e) => setPoolWithdraw(e.target.value)} className={inputClass} placeholder="Quantidade" inputMode="decimal" />
          <button
            className={buttonClass}
            disabled={!poolWei || poolWei > data.staking.rewardPool}
            onClick={() => poolWei && execute('Retirando do pool', (cb) => withdrawStakingPool(poolWei, account, cb))}
          >
            Retirar
          </button>
        </ControlForm>

        <ControlForm
          title="Plano de staking"
          description="Meses de bloqueio e APR (%). Vale só para novos stakes. APR 0 desativa o plano."
          disabled={!isStakingOwner || busy}
        >
          <input value={planMonths} onChange={(e) => setPlanMonths(e.target.value)} className={inputClass} placeholder="Meses" inputMode="numeric" />
          <input value={planApr} onChange={(e) => setPlanApr(e.target.value)} className={inputClass} placeholder="APR %" inputMode="decimal" />
          <button
            className={buttonClass}
            disabled={!Number(planMonths) || Number(planMonths) > 36 || Number.isNaN(Number(planApr))}
            onClick={() =>
              execute('Salvando plano', (cb) => setStakingPlan(Number(planMonths), Math.round(Number(planApr) * 100), cb))
            }
          >
            Salvar
          </button>
        </ControlForm>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
        <h3 className="font-bold text-white">Pausas de emergência</h3>
        <p className="mt-1 mb-4 text-xs text-gray-400">
          Pausar bloqueia apenas novas entradas (compras, stakes e resgates de recompensa do farm). Saques de NFTs,
          chocagem de ovos e resgates de staking sempre funcionam.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              { key: 'nft', label: 'Venda de ovos', paused: data.nft.paused, owner: isNftOwner },
              { key: 'farm', label: 'Farm de NFTs', paused: data.farm.paused, owner: isFarmOwner },
              { key: 'staking', label: 'Staking', paused: data.staking.paused, owner: isStakingOwner },
            ] as const
          ).map((c) => (
            <button
              key={c.key}
              disabled={!c.owner || busy}
              onClick={() => execute(`${c.paused ? 'Reativando' : 'Pausando'} ${c.label}`, (cb) => setPaused(c.key, !c.paused, cb))}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-bold transition-colors disabled:opacity-40 ${
                c.paused
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-white/10 bg-white/5 text-white hover:bg-white/10'
              }`}
            >
              {c.label}
              <span className="flex items-center gap-1 text-xs">
                {c.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {c.paused ? 'Reativar' : 'Pausar'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsersTab({ uid }: { uid: string }) {
  const toastRun = useTx();
  const users = useAsyncData('admin-users', () => getAllUsers(), 60_000);
  const eggs = useAsyncData('admin-eggs', () => getEggHistory(100), 60_000);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<UserProfile | null>(null);
  const nfts = useAsyncData(selected?.address ?? null, fetchUserNfts, 60_000);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const list = useMemo(() => {
    const term = search.toLowerCase();
    return (users.data ?? []).filter(
      (u) => u.username?.toLowerCase().includes(term) || u.address?.toLowerCase().includes(term),
    );
  }, [users.data, search]);

  if (users.error) {
    const denied = /permission|insufficient/i.test(users.error);
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
        {denied ? (
          <>
            <p className="font-bold">Sua conta não tem permissão de admin no Firestore.</p>
            <p className="mt-2">
              No console do Firebase, crie o documento <code className="rounded bg-black/30 px-1">admins/{uid}</code> (pode ser
              vazio) e publique o arquivo <code className="rounded bg-black/30 px-1">firestore.rules</code> deste projeto.
            </p>
            <button
              onClick={() => navigator.clipboard.writeText(uid)}
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20"
            >
              <Copy className="h-3.5 w-3.5" /> Copiar meu UID
            </button>
          </>
        ) : (
          users.error
        )}
      </div>
    );
  }

  const toggleBan = async (user: UserProfile) => {
    const banned = !(overrides[user.uid] ?? user.isBanned);
    if (!confirm(`Tem certeza que deseja ${banned ? 'banir' : 'desbanir'} ${user.username}?`)) return;
    const ok = await toastRun(banned ? 'Banindo usuário' : 'Desbanindo usuário', async () => {
      await setUserBan(user, banned);
      return true;
    });
    if (ok) setOverrides((o) => ({ ...o, [user.uid]: banned }));
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <Search className="h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por usuário ou carteira…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-none bg-transparent text-white focus:outline-none"
          />
          {users.loading && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs text-gray-400 uppercase">
              <tr>
                <th className="px-5 py-3">Usuário</th>
                <th className="px-5 py-3">Carteira</th>
                <th className="px-5 py-3">NFTs</th>
                <th className="px-5 py-3">Em stake</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map((user) => {
                const banned = overrides[user.uid] ?? Boolean(user.isBanned);
                return (
                  <tr key={user.uid} className="hover:bg-white/5">
                    <td className="px-5 py-3 font-bold text-white">{user.username}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">
                      {user.address ? (
                        <a href={addressUrl(user.address)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white">
                          <Wallet size={12} className="text-purple-400" />
                          {shortAddress(user.address)}
                        </a>
                      ) : (
                        <span className="text-gray-600 italic">Não conectada</span>
                      )}
                    </td>
                    <td className="px-5 py-3">{user.totalMinted ?? 0}</td>
                    <td className="px-5 py-3">
                      {formatNumber(user.totalStaked ?? 0)} {TOKEN_SYMBOL}
                    </td>
                    <td className="px-5 py-3">
                      {banned ? (
                        <span className="flex w-fit items-center gap-1 rounded bg-red-500/20 px-2 py-1 text-xs font-bold text-red-400">
                          <Ban size={12} /> Banido
                        </span>
                      ) : (
                        <span className="flex w-fit items-center gap-1 rounded bg-green-500/20 px-2 py-1 text-xs font-bold text-green-400">
                          <CheckCircle size={12} /> Ativo
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSelected(user)}
                          disabled={!user.address}
                          className="rounded-lg p-2 text-blue-400 hover:bg-white/10 disabled:opacity-30"
                          title="Ver NFTs"
                        >
                          <Egg size={18} />
                        </button>
                        <button
                          onClick={() => toggleBan(user)}
                          className={`rounded-lg p-2 hover:bg-white/10 ${banned ? 'text-green-400' : 'text-red-400'}`}
                          title={banned ? 'Desbanir' : 'Banir'}
                        >
                          {banned ? <CheckCircle size={18} /> : <Ban size={18} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && !users.loading && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-500">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Egg className="h-5 w-5 text-yellow-500" /> Últimos ovos chocados
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs text-gray-400 uppercase">
              <tr>
                <th className="px-5 py-3">NFT</th>
                <th className="px-5 py-3">Carteira</th>
                <th className="px-5 py-3">Velocidade</th>
                <th className="px-5 py-3">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(eggs.data ?? []).map((item) => {
                const rarity = rarityOf(item.speed);
                return (
                  <tr key={item.id} className="hover:bg-white/5">
                    <td className="px-5 py-3 font-mono text-purple-400">#{item.tokenId}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-300">{item.wallet ? shortAddress(item.wallet) : '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded border px-2 py-1 text-xs font-bold ${rarity.badgeClass}`}>
                        {item.speed} SPD · {rarity.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500">{item.timestamp?.toDate().toLocaleString('pt-BR') ?? '—'}</td>
                  </tr>
                );
              })}
              {!eggs.data?.length && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-gray-500">
                    {eggs.error ?? 'Nenhum histórico encontrado.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AnimatePresence>
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setSelected(null)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-nfts-title"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900 p-6 sm:p-8"
            >
              <div className="mb-6 flex items-center justify-between">
                <div className="min-w-0">
                  <h2 id="user-nfts-title" className="flex items-center gap-2 text-2xl font-bold text-white">
                    <Egg className="text-yellow-500" /> NFTs de {selected.username}
                  </h2>
                  <p className="mt-1 truncate font-mono text-sm text-gray-400">{selected.address}</p>
                </div>
                <button autoFocus onClick={() => setSelected(null)} className="rounded-full p-2 hover:bg-white/10" aria-label="Fechar">
                  <X size={24} className="text-gray-400" />
                </button>
              </div>
              {!nfts.data ? (
                <div className="flex min-h-[200px] flex-1 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                </div>
              ) : nfts.data.length === 0 ? (
                <p className="py-12 text-center text-gray-500">Nenhum NFT nesta carteira.</p>
              ) : (
                <div className="custom-scrollbar grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                  {nfts.data.map((nft) => {
                    const rarity = rarityOf(nft.speed);
                    return (
                      <div key={nft.id} className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
                        <span className="text-lg font-bold text-white">#{nft.id}</span>
                        <span className="text-sm font-bold" style={{ color: rarity.color }}>
                          {nft.speed} SPD · {rarity.label}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            nft.staked ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
                          }`}
                        >
                          {nft.staked ? 'Em farm' : 'Na carteira'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

const AdminPanel = ({ account, uid }: AdminPanelProps) => {
  const [tab, setTab] = useState<Tab>('overview');
  const overview = useAsyncData('admin-overview', () => fetchAdminOverview(), 30_000);

  const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
    { key: 'overview', label: 'Visão geral', icon: <TrendingUp size={16} /> },
    { key: 'controls', label: 'Controles', icon: <Settings size={16} /> },
    { key: 'users', label: 'Usuários', icon: <Users size={16} /> },
  ];

  return (
    <div className="flex w-full flex-col gap-6 pb-12 sm:gap-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-purple-500 sm:h-10 sm:w-10" />
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Painel admin</h1>
          <button
            onClick={() => overview.refresh()}
            className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${overview.loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold whitespace-nowrap transition-all ${
                tab === t.key ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'users' ? (
        <UsersTab uid={uid} />
      ) : !overview.data ? (
        <div className="flex min-h-[40vh] items-center justify-center text-gray-400">
          {overview.error ?? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando dados on-chain…
            </>
          )}
        </div>
      ) : tab === 'overview' ? (
        <Overview data={overview.data} />
      ) : (
        <Controls data={overview.data} account={account} onDone={overview.refresh} />
      )}
    </div>
  );
};

export default AdminPanel;
