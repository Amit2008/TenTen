# ADR-001 Browser baseline, toolchain and rule baseline

Status: accepted | Task: T01 | Date: 2026-10-29

## Decision

Line Garden is a strict-TypeScript browser game that renders through PixiJS on an actual WebGL2 context. It is built by Vite and tested with Vitest (rules) and Playwright (browser). The rule baseline is the v1.1 GDD, unchanged.

## Pinned toolchain

Each version is the npm `latest` stable on 2026-10-29. All versions are pinned exactly (`-E`), and the lock file is committed in T02.

| Tool | Version | Released | Note |
|---|---|---|---|
| Node.js | 24.11.1 | — | Installed version; Vite 8 needs ≥22.12 and Vitest 5 accepts ^24 |
| npm | 11.6.2 | — | Package manager |
| TypeScript | 7.0.2 | 2026-07-08 | Used only for type checking (`tsc --noEmit`); Vite transpiles |
| pixi.js | 8.22.0 | 2026-10-01 | Stable 8.x line; docs at pixijs.com/8.x [S6] |
| Vite | 8.3.5 | 2026-10-21 | [S7] |
| Vitest | 5.0.5 | 2026-10-15 | Its peer range accepts Vite ^8 |
| Playwright (@playwright/test) | 1.64.1 | 2026-10-14 | Bundles Chromium 156.0.8078.4 |

Only stable releases are used. Pixi APIs are checked against the 8.x docs, never the dev branch.

## WebGL2 requirement and evidence

Pixi is initialized with `preference: 'webgl'`. At startup the game must confirm `renderer.type === RendererType.WEBGL` and `renderer.context.webGLVersion === 2`; otherwise it shows the DOM error screen (T03). The game will not ship a WebGPU or Canvas2D fallback.

The spike in [docs/evidence/t01/](../evidence/t01/) ran pixi.js 8.22.0 under Playwright Chromium 156.0.8078.4. Its output is in [webgl2-spike-output.txt](../evidence/t01/webgl2-spike-output.txt):

| Run | Renderer | Context | GPU string |
|---|---|---|---|
| headless, DPR 1 | WEBGL, webGLVersion 2 | WebGL2RenderingContext | SwiftShader (software) |
| headless, DPR 2 | WEBGL, webGLVersion 2 | WebGL2RenderingContext | SwiftShader (software) |
| headed, DPR 1 | WEBGL, webGLVersion 2 | WebGL2RenderingContext | Intel Arc Pro 140T, D3D11 (hardware) |

With `resolution = min(devicePixelRatio, 2)` and `autoDensity`, the canvas CSS size stayed 720×960 while the backing buffer was 720×960 at DPR 1 and 1440×1920 at DPR 2. Headless CI therefore proves WebGL2 only on software rendering. Hardware evidence comes from headed or real-browser runs.

## Browser and device matrix (target, not a support claim)

| Target | Device | Status |
|---|---|---|
| Chrome on Windows | Dev laptop: Windows 11 Pro 10.0.26200, Intel Arc Pro 140T + NVIDIA RTX PRO 2000 Blackwell; Chrome 156.0.8078.49 installed | Available |
| Edge on Windows | Same laptop; Edge 156.0.4314.50 installed | Available |
| Firefox desktop | Not installed on the dev laptop | Install before T20/T29 |
| Safari on macOS | No Mac recorded | NOT RUN until a Mac is available; Playwright WebKit does not substitute |
| Safari on iPhone | Amit's iPhone (model to record at first device test) | Available |
| Chrome on Android | Amit's Android phone (model to record at first device test) | Available |

The exact builds are refreshed at T29. Devices without WebGL2 get the unsupported-renderer message.

## Hosting

The app must work both at the origin root and under the nested base path **`/TenTen/`** (Amit's choice, matching GitHub Pages for `Amit2008/TenTen`). The base path is set through Vite `base` at build time. Content URLs are resolved against `import.meta.env.BASE_URL` [S13]. No host has been selected or published.

## Rule baseline (from GDD §2, §4 and §5)

Sourced from the reference game:
- 10×10 board [S2].
- Completed rows and columns clear [S1][S4].
- No timer or speed escalation [S1].
- No color matching [S2].
- Three-piece tray that refills after all three are used [S5].
- Play continues until no piece fits [S5].

Proposed (this project's own decisions, not verified original values):
- The 19 fixed-orientation catalog in `pieces.example.json`, all with weight 1.
- No rotation.
- Score delta = placed cells + 10 × completed lines, with no multiline bonus.
- Independent weighted draws with replacement.
- `xorshift32_v1` PRNG (seed 1 gives 270369, 67634689, 2647435461) with rejection sampling.
- Simultaneous clears with no gravity.
- Game over only when no live slot has a legal placement.

## Consequences

- TypeScript 7 is the native compiler. If a tool needs the TS 5.x JS API, record that as a decision rather than silently downgrading.
- Firefox and macOS Safari evidence is blocked until those environments exist.
