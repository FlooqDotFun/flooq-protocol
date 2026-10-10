// Register helpers shared by the renderer, the browser bundle and the gates.
// One record per external fact. State is stated | absent | unconfirmed.
// Anything that is not stated renders inert and carries no value and no url.

export const STATES = ['stated', 'absent', 'unconfirmed'];

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58decode(s) {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of s) { if (ch === '1') bytes.unshift(0); else break; }
  return bytes;
}

export const isSolanaAddress = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58decode(s)?.length === 32;
export const isEvmAddress = s => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);

// An address is judged against the chain the register states, never by blanket prefix rules.
export function validateAddress(value, chain) {
  const c = String(chain || '').toLowerCase();
  if (c === 'solana') return isSolanaAddress(value);
  if (c === 'ethereum' || c === 'base' || c === 'bnb' || c === 'bsc' || c === 'evm') return isEvmAddress(value);
  return isSolanaAddress(value) || isEvmAddress(value);
}

// Link rule: the url is stored, the handle is derived from it.
export function deriveHandle(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean);
    if (host === 'x.com' || host === 'twitter.com') return seg[0] ? '@' + seg[0] : host;
    if (host === 'github.com') return seg.length ? seg.slice(0, 2).join('/') : host;
    return host;
  } catch { return ''; }
}

export const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };

// Enforce the record invariants and drop everything that must not reach the page (dates stay in register.json).
export function publicView(register) {
  const out = {};
  for (const [id, r] of Object.entries(register.records)) {
    const rec = { id, label: r.label, kind: r.kind, state: STATES.includes(r.state) ? r.state : 'unconfirmed' };
    if (rec.state === 'stated') {
      if (r.value != null) rec.value = r.value;
      if (r.url != null) rec.url = r.url;
      if (r.pairsUrl != null) rec.pairsUrl = r.pairsUrl;
    }
    out[id] = rec;
  }
  return out;
}

export function checkRegister(register) {
  const errs = [];
  const chain = register.records.chain?.value;
  for (const [id, r] of Object.entries(register.records)) {
    if (!STATES.includes(r.state)) errs.push(`${id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      if ('value' in r || 'url' in r || 'pairsUrl' in r) errs.push(`${id}: inert record carries value or url`);
    } else {
      if (r.kind === 'address' && !validateAddress(r.value, chain)) errs.push(`${id}: stated address does not match chain ${chain}`);
      if (r.kind === 'url') { try { new URL(r.url); } catch { errs.push(`${id}: stated url is not a url`); } }
      if ((r.kind === 'text' || r.kind === 'address') && !r.value) errs.push(`${id}: stated record has no value`);
      if (!r.source) errs.push(`${id}: stated record has no source`);
    }
  }
  return errs;
}

// Address scanner. Finds address-shaped strings and matches them to the stated registry.
// Hex that is not address-shaped is never rejected. The CA record is exempt by design.
export function scanAddresses(text, publicRecords) {
  const stated = new Set();
  let exempt = null;
  for (const r of Object.values(publicRecords)) {
    if (r.state === 'stated' && r.kind === 'address' && r.value) { stated.add(r.value); if (r.id === 'ca') exempt = r.value; }
  }
  const found = [];
  const re = /(?<![A-Za-z0-9])(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})(?![A-Za-z0-9])/g;
  for (const m of String(text).matchAll(re)) {
    const s = m[1];
    const shaped = s.startsWith('0x') ? isEvmAddress(s) : isSolanaAddress(s);
    if (!shaped) continue;
    found.push({ value: s, registered: stated.has(s), exempt: s === exempt });
  }
  return found;
}
