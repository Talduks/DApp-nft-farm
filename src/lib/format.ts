import { formatUnits } from 'ethers';

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Formats a token amount in pt-BR without going through floating point. */
export function formatToken(value: bigint, maxDecimals = 4, decimals = 18): string {
  const negative = value < 0n;
  const [whole, fraction = ''] = formatUnits(negative ? -value : value, decimals).split('.');
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  const grouped = BigInt(whole).toLocaleString('pt-BR');
  return `${negative ? '-' : ''}${grouped}${trimmed ? `,${trimmed}` : ''}`;
}

export function formatNumber(value: number, maxDecimals = 2): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: maxDecimals });
}

export function formatPercentBps(bps: number): string {
  return `${formatNumber(bps / 100, 2)}%`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${s % 60}s`;
  return `${s}s`;
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
