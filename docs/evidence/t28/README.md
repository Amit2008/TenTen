# T28 release candidate evidence

Recorded on 5 Nov 2026, Windows 11 Pro, Node 24.11.1 and npm 11.6.2. The release commit is `02c7671` (branch `t28-release-candidate`).

| File | What |
|---|---|
| `build.log` | `npm run release` in this checkout: both Vite builds and the manifest |
| `clean-clone-ci.log` | A fresh `git clone` into a scratch folder, then `npm ci` → `npm run typecheck` → `npm test` (324 passed) → `npm run release` |
| `release-manifest.json` | Commit, toolchain, lock-file hash, content version and sizes for each target |
| `nested.sha256`, `root.sha256` | The SHA-256 of all 29 files in each target |

## Reproducibility

The clean clone's `nested.sha256` and `root.sha256` are **identical** to this checkout's, file for file, and so is the source archive hash (`e392a9e3789b…` for `02c7671`). Same commit and same lock file give the same bytes.

## Content pointers

`npm run release` checked the chain `content/index.json` (1.1.0) → `releases/1.1.0/manifest.json` (1.1.0) → rules, pieces, theme, runtime and audio JSON → 5 effect `.wav` files, in both targets. Every file exists, parses and agrees on the version.

## Served over HTTP, not `file://`

Each target was served with `vite preview` and checked in Playwright Chromium:
- **`release/nested` at `http://localhost:4401/TenTen/`:** loads with WebGL2, New game works, a keyboard move is placed and shows "Saved", and `licenses/MIT-PixiJS.txt` is served. No page errors and no 4xx or 5xx responses.
- **`release/root` at `http://localhost:4402/`:** same result.

Browser core after the T28 changes: `npx playwright test --workers=4`, 34 passed (root and nested builds, Firefox and WebKit replay).

## Not run

- Real hosting (GitHub Pages or another host). This needs Amit's approval and belongs to T29. `vite preview` is not production hosting.
- The workflow template `docs/deployment/github-pages.yml.example` has never been run.
