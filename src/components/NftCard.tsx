import { motion } from 'framer-motion';
import { Check, Zap } from 'lucide-react';
import { TOKEN_SYMBOL } from '../config';
import { formatToken } from '../lib/format';
import { nftImageUrl, rarityOf } from '../lib/nft';

interface NftCardProps {
  id: number;
  speed: number;
  /** Reward per speed unit per second (wei), to show the daily yield. */
  rewardRate?: bigint;
  selected?: boolean;
  onToggle?: () => void;
  staked?: boolean;
}

const NftCard = ({ id, speed, rewardRate, selected = false, onToggle, staked = false }: NftCardProps) => {
  const rarity = rarityOf(speed);
  const perDay = rewardRate !== undefined ? rewardRate * BigInt(speed) * 86_400n : null;

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      onClick={onToggle}
      disabled={!onToggle}
      aria-pressed={selected}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-slate-900/80 text-left transition-all ${
        selected
          ? 'border-purple-400 ring-2 ring-purple-500/50'
          : 'border-white/10 hover:border-white/25 disabled:hover:border-white/10'
      }`}
      style={{ boxShadow: rarity.key === 'legendary' ? `0 0 24px ${rarity.color}33` : undefined }}
    >
      <div className="relative aspect-square w-full">
        <img
          src={nftImageUrl(id, speed)}
          alt={`Speed NFT #${id}`}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        {staked && (
          <span className="absolute top-2 left-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-black tracking-wide text-emerald-950 uppercase">
            Farmando
          </span>
        )}
        {onToggle && (
          <span
            className={`absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
              selected ? 'border-purple-400 bg-purple-500 text-white' : 'border-white/40 bg-black/40 text-transparent'
            }`}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-white">#{id}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${rarity.badgeClass}`}>
            {rarity.label}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: rarity.color }}>
          <Zap className="h-3.5 w-3.5" /> {speed} SPD
        </div>
        {perDay !== null && (
          <p className="text-[11px] text-slate-400">
            ≈ {formatToken(perDay, 2)} {TOKEN_SYMBOL}/dia
          </p>
        )}
      </div>
    </motion.button>
  );
};

export default NftCard;
