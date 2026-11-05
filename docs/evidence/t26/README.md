# T26 regression and performance results

Recorded on 5 Nov 2026 against the production build (`vite build`, root base, served by `vite preview`). Each browser ran headed, so frames follow the real display's vsync.

To reproduce: `npx playwright test --config tools/profiling/playwright.config.ts`. Add `RESTARTS=200` for the longer leak check.

## Recorded desktop

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| GPU | Intel Arc Pro 140T (ANGLE, Direct3D 11) |
| Browsers | Chrome 156.0.8078.80 and Edge 156.0.4314.58 (installed stable builds, driven by Playwright 1.64.1) |
| Display | 60 Hz (the idle frame interval median is 16.7 ms). The window is 800×1000 CSS px at DPR 1 |

**Phone: NOT RUN.** No phone is connected to this machine. The midrange-phone budgets stay open, and they move to T29 (real devices).

## Budgets (GDD 10)

| Measure | Budget | Chrome | Edge | Result |
|---|---|---|---|---|
| p95 active-animation frame interval (line-clear feedback, after warm-up) | ≤ 20 ms | 17.3 ms (max 18.0, n = 109) | 16.8 ms (max 16.9, n = 109) | Pass |
| Command processing, p95 (`GameSession.place`, no storage or drawing; 50 full games, 1,266 commands) | < 8 ms | 0.1 ms (max 0.5) | 0.1 ms (max 0.3) | Pass. The timer is coarsened to 0.1 ms |
| Initial compressed transfer, excluding optional audio | ≤ 2 MB | 200,396 B served (gzip estimate 193,306 B, 18 files) | same | Pass |
| Interactive with a cold cache at 10 Mbps / 100 ms (CDP throttling; the menu's New game button usable) | ≤ 3 s | 1,479 / 1,459 / 1,368 ms | 1,347 / 1,450 / 1,404 ms | Pass |
| Render DPR cap 2 | cap | Checked by the T09 DPR 1/2/3 pointer tests (in `regression-output.txt`) | — | Pass |
| 60 fps on the recorded desktop | 60 fps | median 16.7 ms | median 16.7 ms | Pass |
| 60 fps on a midrange phone | 60 fps | NOT RUN | NOT RUN | Open (T29) |

No audio files load before sound is unlocked, so the audio transfer was 0 B at startup.

## 100 restarts (Pause → Restart → confirm, plus one move per run)

| | Event listeners (`Memory.getDOMCounters`) | DOM nodes | Live WebGL objects (created minus deleted) | JS heap after GC |
|---|---|---|---|---|
| Chrome, restart 1 → 100 | 71 → 71 | 426 → 426 | equal | 4.96 → 5.79 MB |
| Edge, restart 1 → 100 | 71 → 71 | 426 → 426 | equal | 4.95 → 5.73 MB |
| Chrome, 200 restarts | 71 → 71 | 426 → 426 | +1 vertex array and +2 buffers once (between restarts 50 and 75), then flat to 200 | 4.96 → 5.88 MB, levelling off (+0.07 MB over the last 100) |

There are no page errors in any run. In the first Chrome run (`chrome-restarts-100-run1.json`), the same one-time step happened between restarts 75 and 100. That made the original strict-equality check fail. The step is exactly one Pixi batch geometry, and the count stays flat for the next 125 restarts. So it is a one-time pool growth, not a leak per restart. The check now allows slack of 4 objects per kind, which a real leak would quickly exceed.

The run loop does not keep stale sessions. There is no direct count of `GameSession` objects (class names are minified), so this rests on three signs: listeners stay equal, DOM nodes stay equal and the heap levels off.

**Not covered:** full app teardown (`start()` after Retry or Load latest), repeated 100 times. That path rebuilds the Pixi app, and players reach it only through error recovery.

## Regressions

`regression-output.txt` holds the full run:
- `npm run typecheck`: 0 errors.
- `npm test`: 317 passed.
- `npx playwright test --workers=4`: 34 passed. That covers rules and golden replay in Chromium, Firefox and WebKit, pointer input at DPR 1/2/3, saves, two tabs, quota, context loss, content versions and WebGL unavailable.

The default worker count (8) times out on this machine, on `main` as well (see the T25 handoff). The suite was therefore run with `--workers=4`.

## Not run

- The phone measurements (see above) and real mobile GPU performance. CI-style software rendering would not count as evidence of either.
- Profiler captures (traces). The JSON files here come from the browser's own counters (CDP and `requestAnimationFrame`).
