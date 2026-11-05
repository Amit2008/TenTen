# Line Garden: release handover

This page is for whoever runs, deploys or extends Line Garden next. It records what is live, how to rebuild and publish it, how to change it, and what has not been verified.

Line Garden is a browser block-placement puzzle: a 10×10 board, a tray of 3 pieces, row and column clears, no rotation. It is built with TypeScript, PixiJS on WebGL2, and Vite. It is a static web game. There is no offline install, no native app, no account and no music track; the five sound effects are synthesized.

## Release identity

| | |
|---|---|
| Live URL | https://amit2008.github.io/TenTen/ (GitHub Pages, published with Amit's approval on 5 Nov 2026) |
| Deployed commit | `3a4453fb87658e107758073572578112c005e7f9` on `main` |
| Deployment | GitHub Actions run [42037920063](https://github.com/Amit2008/TenTen/actions/runs/42037920063) (`workflow_dispatch`, success, 13:40 UTC) |
| Content version | 1.1.0 (`public/content/index.json` → `releases/1.1.0/`) |
| Ruleset and gameplay hash | `classic_proposed_v1`, `sha256:c8781bbed8b3eb1cf81e0bc4bf9f92b639b9f796f84369e6d48f70d59a523f03` |
| Artifact | `release/nested`: 29 files. Hashes are in `docs/evidence/t29/final-nested.sha256` |
| Live site matches the artifact | 29 of 29 files are byte-identical (`docs/evidence/t29/final-hosted-hashes.txt`) |
| Release manifest | `docs/evidence/t29/final-release-manifest.json`. Source zip `line-garden-src-3a4453f.zip`, SHA-256 `7df3131f…d9ad`. Lock-file SHA-256 `979c9521…fb0b` |
| Toolchain | Node 24.11.1, npm 11.6.2, and the exact dependency versions in `package-lock.json` (ADR-001) |

Commits after `3a4453f` on `main` change only documentation. `npm run release` at any later docs-only commit produces the same 29 files.

## Build, test, deploy

```sh
npm ci
npm run typecheck
npm test                                # 326 unit tests (Node)
npm run test:browser -- --workers=4     # 34 browser tests on the production build, about 2 min
npm run release                         # needs a clean tree; writes release/ (nested + root sites, hashes, manifest, source zip)
```

- **Deploy:** Actions → *Deploy to GitHub Pages* → Run workflow on `main`. Steps, cache and MIME headers, preview commands and rollback: [docs/deployment/runbook.md](../deployment/runbook.md). Publishing needs Amit's approval each time.
- **Change content** (board or tray size, pieces, scoring, colours, timings, audio): [docs/configuration/content-updates.md](../configuration/content-updates.md). Ship each change as a new content version, then switch `content/index.json`. Changing a gameplay rule changes the gameplay hash, and the pinned value in `tests/config/gameplay-config.test.ts` must be updated.
- **Change code:** read [CLAUDE.md](../../CLAUDE.md) and [AGENTS.md](../../AGENTS.md) first. The source layers are `domain` (pure rules), `application`, `presentation`, `adapters` (Pixi, DOM, IndexedDB, audio) and `bootstrap`. The behaviour spec is `For Claude/01_GDD.md`, and the per-task history is in `docs/handoffs/T01–T30`.

## Controls (also in the game's How to play)

- **Mouse or touch:** drag a piece from the tray onto the board. A press anywhere in a piece's tray column below the board picks it up. On touch screens the piece floats above the finger.
- **Tap or click:** pick a piece (or its 1, 2 or 3 button), then tap the board cell for the piece's top-left corner.
- **Keyboard:** 1 to 3 pick a piece, the arrow keys move it, Enter or Space places it, and Escape cancels or pauses.
- **Pause:** the button beside the score, or Escape. Hiding the tab also pauses the game.

Credits and licences are in the game's Credits dialog. The release ships `licenses/OFL-Atkinson-Hyperlegible.txt` and `licenses/MIT-PixiJS.txt`.

## Evidence

| Gate | Evidence |
|---|---|
| Rules, golden deals, replay in Chromium, Firefox and WebKit | `npm test`, `tests/browser/replay.spec.ts`, T05–T12 handoffs |
| Input (drag, tap, keyboard, DPR 1/2/3) | T13–T16 and T20 handoffs, `tests/pointer`, `tests/browser/pointer.spec.ts` |
| Saves, two tabs, quota, refresh | T17–T19 handoffs, `tests/browser/persistence.spec.ts`, `lifecycle.spec.ts` |
| Context loss and failure faults | `docs/evidence/t25/` |
| Performance budgets (desktop) | `docs/evidence/t26/README.md`: all met on Chrome 156 and Edge 156 |
| Release reproducibility | `docs/evidence/t28/`: a clean clone gives byte-identical artifacts |
| Hosted delivery and live browsers | `docs/evidence/t29/README.md` |
| Amit's review | `docs/review/T27-play-feel-review.md`: rounds 1–4, accepted. The changes were a staggered line clear, a larger pickup area, bigger tray pieces and the pause button position |

## Known issues and gaps

**Not verified:**
- Firefox desktop, Safari on macOS and iPhone Safari (no devices). The Galaxy S24's Android and Chrome versions, and its separate sound, refresh, background and rotation results, were not confirmed.
- Rollback on the live host: waiting for Amit's decision on the colours-only 1.1.1 test. Content rollback is proven against an emulated host (T24).
- The site at the root path on the host: Pages serves only `/TenTen/`. The root build is verified locally (T28).
- Phone performance budgets (T26).
- The "Saving is waiting for another tab" message: it cannot be reached at save schema v1.

**Limits:**
- GitHub Pages sends `max-age=600` on every file. After a deploy, a tab can keep the old version for up to 10 minutes.
- The game needs a secure context (`crypto.randomUUID`). It works on HTTPS and on `localhost`, but not over plain `http://` on a local network, for example when testing on a phone over Wi-Fi.
- On tall phones the game keeps its 3:4 logical shape, which leaves empty bands above and below. Amit was offered a change to use that space; it has not been requested.

**Tooling:**
- `npm run test:browser` at the default 8 workers times out on the development PC, and on older `main` commits too. Use `--workers=4`, or set `workers: 4` in `playwright.config.ts`.
- From Git Bash, `vite --base /TenTen/` is rewritten into a Windows path. Use PowerShell or cmd, or `npm run release`, which avoids the shell.
