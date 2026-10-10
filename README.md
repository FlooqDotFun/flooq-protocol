# Flooq

**One unbroken ribbon on Solana.**

[![Live site](https://img.shields.io/badge/live-flooq.fun-informational?style=for-the-badge)](https://flooq.fun)
![Chain](https://img.shields.io/badge/chain-Solana-informational?style=for-the-badge)

| | |
|---|---|
| Chain | Solana |
| Contract address (CA) | _pending, to be stated by the team_ |
| Site | https://flooq.fun |

## Overview

Flooq is a Solana token whose mark is a single ribbon folded back on itself. This repository holds its public site: a live market tape, a register of stated facts, and a short path ahead. Nothing on the site is switched on before it is real.

## Features

- Live Solana market tape: top ten tokens by 24h volume with logo, price, 24h move, volume, liquidity and a copy-address button.
- Ticker, skeleton loaders, count-up numbers and flash-on-change, all driven by the same feed.
- Polling every 60 seconds, paused while the tab is hidden, exponential backoff on failure, last good data kept.
- A register of external facts. Each record is stated or pending; pending records render inert with no link and no value.
- Contract strip pinned to the top of the page, click to copy once an address is stated.
- Social icons (X, GitHub) that stay inert until their links are stated.
- Spring-physics reveals, hero parallax, spotlight hover, scroll progress bar and full `prefers-reduced-motion` support.

## Links

- Website: https://flooq.fun
- X: _pending_
- GitHub: _pending_
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm install
npm run assets   # palette, premultiplied logo sizes, favicon
npm run build    # writes dist/
npm run gates    # build checks and both contract branches
npm run serve    # preview dist/ on http://localhost:4173
```

Deploy by dragging the `dist/` folder to Cloudflare Pages.

## License

MIT, see [LICENSE](LICENSE).
