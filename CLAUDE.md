# Line Garden (working title)

A browser block-placement puzzle inspired by 1010! classic endless mode: a 10x10 board, a tray of 3 pieces, row and column clears, no rotation. Built with strict TypeScript, PixiJS (WebGL2 only), Vite, Vitest and Playwright.

The spec lives in `For Claude/`. Treat it as the source of truth:
- `For Claude/AGENTS.md` is the working agreement. Read it before every task.
- `For Claude/01_GDD.md` defines behavior. If the code conflicts with it, report the conflict before implementing.
- `For Claude/02_Agent_Roadmap.md` and `For Claude/tasks.json` hold tasks T01–T30, with dependencies and acceptance criteria.
- `For Claude/*.example.json` contain the baseline rules, the 19 pieces, theme, runtime and audio. They become `public/content/releases/1.1.0/` (see CONFIGURATION.md).

Key rules (details in the GDD):
- Do one task at a time, then stop at the task boundary.
- Never fabricate results. A check that wasn't run is marked NOT RUN.
- The domain layer stays pure: no Pixi, DOM, IndexedDB, audio or wall-clock time.
- Each PlacePiece command is one atomic transaction. Score per move is placed cells + 10 × completed lines.
- Deals use xorshift32_v1 with rejection sampling. Never use Math.random for deals.
- Do not publish anything live without explicit approval.
