// Market pipeline, pure functions only (no DOM, no register, no contract state).
export const POLL_MS = 60000;
export const BACKOFF = { base: 2000, max: 60000, jitter: 0.15 };
export const PAIR_CHUNK = 30;
export const TOP_N = 10;

export function backoffDelay(attempt, opts = BACKOFF, rand = Math.random) {
  const raw = Math.min(opts.max, opts.base * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (1 + (rand() * 2 - 1) * opts.jitter));
}

// Solana entries only, de-duplicated, order preserved.
export function pickSolanaAddresses(boosts, limit = PAIR_CHUNK) {
  const seen = new Set(), out = [];
  if (!Array.isArray(boosts)) return out;
  for (const b of boosts) {
    if (!b || b.chainId !== 'solana' || typeof b.tokenAddress !== 'string' || seen.has(b.tokenAddress)) continue;
    seen.add(b.tokenAddress); out.push(b.tokenAddress);
    if (out.length >= limit) break;
  }
  return out;
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Group pairs per base token. Volume and depth sum over the token's pairs; price and move come from its deepest pair.
export function buildTokens(pairs, addresses) {
  const want = new Set(addresses), by = new Map();
  if (!Array.isArray(pairs)) return [];
  for (const p of pairs) {
    const a = p?.baseToken?.address;
    if (!a || p.chainId !== 'solana' || !want.has(a)) continue;
    let t = by.get(a);
    if (!t) { t = { address: a, symbol: p.baseToken.symbol || '?', name: p.baseToken.name || '', imageUrl: null, price: null, change: null, volume: 0, liquidity: 0, _depth: -1 }; by.set(a, t); }
    const liq = num(p.liquidity?.usd) ?? 0;
    t.volume += num(p.volume?.h24) ?? 0;
    t.liquidity += liq;
    if (!t.imageUrl && p.info?.imageUrl) t.imageUrl = p.info.imageUrl;
    if (liq > t._depth) { t._depth = liq; t.price = num(p.priceUsd); t.change = num(p.priceChange?.h24); }
  }
  return [...by.values()].map(({ _depth, ...t }) => t);
}

export function topByVolume(tokens, n = TOP_N) {
  return [...tokens].sort((a, b) => b.volume - a.volume).slice(0, n);
}

export const SORTS = {
  vol: (a, b) => b.volume - a.volume,
  chg: (a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity),
  liq: (a, b) => b.liquidity - a.liquidity
};
export const sortTokens = (tokens, key) => [...tokens].sort(SORTS[key] || SORTS.vol);

export function fmtCompact(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: v >= 1e5 ? 2 : 1 }).format(v);
}
export function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
  if (v >= 1) return '$' + v.toFixed(2);
  if (v >= 0.01) return '$' + v.toFixed(4);
  if (v === 0) return '$0';
  const digits = Math.min(12, -Math.floor(Math.log10(v)) + 3);
  return '$' + v.toFixed(digits);
}
export function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const arrow = v > 0 ? '▲ ' : v < 0 ? '▼ ' : '';
  return arrow + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 }) + '%';
}
export const fmtInt = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));

export function letterFor(symbol) {
  const m = String(symbol || '').match(/[A-Za-z0-9]/);
  return (m ? m[0] : '?').toUpperCase();
}
export function tileIndex(address) {
  let h = 0;
  for (const ch of String(address)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}
export const shortAddr = a => (a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '');
