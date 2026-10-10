// Contract-record behaviours. Inert until the record is stated; the market never imports this file.
import { scanAddresses } from '../lib/register.mjs';

export function initCa(R) {
  // gate warning: any address-shaped string on the page must match a stated record (the CA itself is exempt)
  const text = document.body.innerText || '';
  const bad = scanAddresses(text, R).filter(f => !f.registered && !f.exempt);
  if (bad.length) { document.documentElement.dataset.gateWarning = String(bad.length); console.warn('Unregistered address-shaped strings on the page:', bad.length); }

  const ca = R.ca, rpc = R.rpc;
  const out = document.querySelector('[data-supply]');
  if (!out || !ca || ca.state !== 'stated' || !rpc || rpc.state !== 'stated') return;
  fetch(rpc.url, { method: 'POST', headers: { 'content-type': 'application/json' }, referrerPolicy: 'no-referrer', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [ca.value] }) })
    .then(r => r.json())
    .then(j => {
      const v = j?.result?.value;
      if (!v) return;
      const n = Number(v.uiAmountString ?? v.uiAmount);
      if (!Number.isFinite(n)) return;
      out.textContent = 'Supply on chain: ' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
      out.hidden = false;
    })
    .catch(() => { /* the card simply stays without a supply line */ });
}
