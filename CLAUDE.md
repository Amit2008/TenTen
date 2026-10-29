# Line Garden (working title)

A browser block-placement puzzle inspired by 1010! classic endless mode: a 10x10 board, a tray of 3 pieces, row and column clears, no rotation. Built with strict TypeScript, PixiJS (WebGL2 only), Vite, Vitest and Playwright.

## Where things are

- `AGENTS.md` is the working agreement. Read it before every task.
- `tasks.json` is the task ledger (T01–T30). Handoffs are in `docs/handoffs/`, decisions in `docs/decisions/` (ADR-001 pins the toolchain), and evidence in `docs/evidence/`.
- `For Claude/01_GDD.md` defines behavior. If the code conflicts with it, report the conflict before implementing.
- `For Claude/02_Agent_Roadmap.md` holds per-task scope and acceptance criteria.
- `For Claude/*.example.json` contain the baseline content. It becomes `public/content/releases/1.1.0/` (see `For Claude/CONFIGURATION.md`).
- The source layers are `src/domain`, `src/application`, `src/presentation`, `src/adapters` and `src/bootstrap`. Tests are in `tests/unit` (Vitest, Node) and `tests/browser` (Playwright, run against the production build).

## Commands

`npm ci` · `npm run typecheck` · `npm test` · `npm run test:browser` · `npm run build` · `npm run dev`

## Key rules (details in the GDD)

- Do one task at a time, then stop at the task boundary.
- Never fabricate results. A check that wasn't run is marked NOT RUN.
- The domain layer stays pure: no Pixi, DOM, IndexedDB, audio, wall-clock time or Math.random. `tests/unit/architecture.test.ts` enforces this.
- Each PlacePiece command is one atomic transaction. Score per move is placed cells + 10 × completed lines.
- Deals use xorshift32_v1 with rejection sampling.
- Hosting base path is `/TenTen/`, and the app must also work at the root.
- Do not publish anything live without explicit approval.

## Git workflow (Amit's standing instruction)

For each task:
1. Create a branch (`tNN-short-name`) and push it.
2. Implement and test the task.
3. Get Amit's approval when a manual test is needed.
4. Commit with a title and description, then push.
5. Check out `main`, merge with `--no-ff`, and push.
6. Continue automatically to the next task.
