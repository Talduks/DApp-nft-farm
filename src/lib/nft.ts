export type RarityKey = 'common' | 'rare' | 'epic' | 'legendary';

export interface Rarity {
  key: RarityKey;
  /** Label used on-chain (metadata and SVG). */
  onChainLabel: string;
  label: string;
  color: string;
  min: number;
  max: number;
  badgeClass: string;
}

export const MIN_SPEED = 10;
export const MAX_SPEED = 100;

export const RARITIES: Rarity[] = [
  {
    key: 'common',
    onChainLabel: 'Common',
    label: 'Comum',
    color: '#94a3b8',
    min: 10,
    max: 39,
    badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-400/30',
  },
  {
    key: 'rare',
    onChainLabel: 'Rare',
    label: 'Raro',
    color: '#3b82f6',
    min: 40,
    max: 69,
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-400/30',
  },
  {
    key: 'epic',
    onChainLabel: 'Epic',
    label: 'Épico',
    color: '#a855f7',
    min: 70,
    max: 89,
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
  },
  {
    key: 'legendary',
    onChainLabel: 'Legendary',
    label: 'Lendário',
    color: '#f59e0b',
    min: 90,
    max: 100,
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
  },
];

export function rarityOf(speed: number): Rarity {
  for (let i = RARITIES.length - 1; i >= 0; i--) {
    if (speed >= RARITIES[i].min) return RARITIES[i];
  }
  return RARITIES[0];
}

/** Probability of each tier: hatching draws uniformly from MIN_SPEED..MAX_SPEED. */
export function rarityOdds(rarity: Rarity): number {
  return (rarity.max - rarity.min + 1) / (MAX_SPEED - MIN_SPEED + 1);
}

/** Same art as SpeedNFT._svg, rendered locally so cards need no RPC call. */
export function nftSvg(tokenId: number, speed: number): string {
  const rarity = rarityOf(speed);
  const c = rarity.color;
  return [
    '<svg width="350" height="350" viewBox="0 0 350 350" xmlns="http://www.w3.org/2000/svg">',
    '<defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>',
    '<filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/>',
    '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
    '<rect width="350" height="350" fill="url(#bg)"/>',
    '<g transform="translate(175,155)" filter="url(#glow)">',
    `<circle r="80" fill="none" stroke="${c}" stroke-width="3" opacity="0.3"/>`,
    `<path d="M-40,-40 L-30,-50 L-50,-30 Z M40,-40 L50,-30 L30,-50 Z M40,40 L30,50 L50,30 Z M-40,40 L-50,30 L-30,50 Z" fill="${c}"/>`,
    `<circle r="60" fill="none" stroke="${c}" stroke-width="8"/><circle r="20" fill="${c}"/></g>`,
    `<text x="175" y="280" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="#ffffff">#${tokenId}</text>`,
    `<text x="175" y="308" text-anchor="middle" font-family="sans-serif" font-size="16" fill="${c}">SPEED ${speed} | ${rarity.onChainLabel}</text>`,
    '</svg>',
  ].join('');
}

export function nftImageUrl(tokenId: number, speed: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(nftSvg(tokenId, speed))}`;
}
