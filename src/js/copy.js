// Clipboard with visible and announced feedback.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'visually-hidden';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function flashCopied(el, message, ms = 1700) {
  const live = document.querySelector('[data-live]');
  if (live) live.textContent = message;
  const hint = el.querySelector('[data-hint]');
  const prev = hint ? hint.textContent : null;
  el.setAttribute('data-copied', '');
  if (hint) hint.textContent = message.startsWith('Copy failed') ? 'Failed' : 'Copied';
  clearTimeout(el._ct);
  el._ct = setTimeout(() => {
    el.removeAttribute('data-copied');
    if (hint && prev != null) hint.textContent = prev;
    if (live) live.textContent = '';
  }, ms);
}

export function bindCopy() {
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-copy]');
    if (!el) return;
    const ok = await copyText(el.getAttribute('data-copy'));
    flashCopied(el, ok ? 'Copied to clipboard' : 'Copy failed');
  });
}
