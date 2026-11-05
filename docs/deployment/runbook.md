# Line Garden deployment runbook

This runbook is for the operator who publishes the game. It covers building, verifying and publishing the static release.

**Do not publish without Amit's explicit approval.** None of the steps below upload anything unless you run the publish step yourself.

## 1. Build the release candidate

You need Node 24.11.1 and npm 11.6.2 (ADR-001) and a clean checkout of the commit you will release.

```sh
npm ci
npm run typecheck
npm test
npm run test:browser -- --workers=4   # about 2 min; 8 workers time out on slower machines
npm run release
```

`npm run release` refuses to run on a dirty tree. It writes `release/`, which is not committed:

| Path | Contents |
|---|---|
| `release/nested/` | The site for `https://<user>.github.io/TenTen/`, built with base `/TenTen/` |
| `release/root/` | The same site for an origin root, built with base `/` |
| `release/nested.sha256`, `release/root.sha256` | The SHA-256 of every file, in `sha256sum -c` format |
| `release/release-manifest.json` | Commit, Node and npm versions, lock-file hash, content version, and the file count and size per target |
| `release/line-garden-src-<commit>.zip` | The source at that commit (`git archive`) |

The script stops if:
- a build fails;
- `index.html` does not load its script from the base;
- the content pointer chain (`content/index.json` → `releases/<v>/manifest.json` → every content and audio file) is missing a file, has invalid JSON or names different versions.

Each target is a complete static site. The site needs no server code, and the game also includes `licenses/` (the font OFL and the PixiJS MIT licence).

## 2. Preview locally (not production hosting)

Run these from PowerShell or cmd. Git Bash rewrites `/TenTen/` into a Windows path.

```sh
npx vite preview --base /TenTen/ --outDir release/nested --port 4174   # open http://localhost:4174/TenTen/
npx vite preview --base / --outDir release/root --port 4173            # open http://localhost:4173/
```

Do not open `index.html` from disk (`file://`): modules and content fetches need HTTP.

## 3. Publish (needs Amit's approval)

### GitHub Pages (the chosen target, `Amit2008/TenTen`)

1. In the repository, set Settings → Pages → Source to **GitHub Actions**.
2. Copy `docs/deployment/github-pages.yml.example` to `.github/workflows/pages.yml` and commit it. It only runs when started by hand (`workflow_dispatch`).
3. Actions → *Deploy to GitHub Pages* → **Run workflow** on the approved commit. The workflow runs `npm ci`, the type and unit checks and `npm run release`, then uploads `release/nested/`.
4. Record the run URL, the commit and the `nested.sha256` of the build in the T29 evidence.

### Any other static host

Upload the contents of `release/nested/` (served at `/TenTen/`) or `release/root/` (served at `/`). Use the headers below.

## 4. Cache and MIME headers

| Path | Cache-Control | Why |
|---|---|---|
| `index.html` | `no-cache` (revalidate) | It names the current hashed script |
| `content/index.json` | `no-cache` (revalidate) | It names the current content version (the loader also sends `cache: 'no-cache'`) |
| `assets/*` (hashed file names) | `public, max-age=31536000, immutable` | Names change whenever the contents change |
| `content/releases/<version>/*` | `public, max-age=31536000, immutable` | A published version is never edited; changes ship as a new version |
| `icon.svg`, `apple-touch-icon.png`, `licenses/*` | `public, max-age=86400` | Stable but not hashed |

| Extension | MIME type |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.js` | `text/javascript` |
| `.css` | `text/css` |
| `.json` | `application/json` |
| `.wav` | `audio/wav` |
| `.woff2` | `font/woff2` |
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.txt` | `text/plain; charset=utf-8` |

Turn on gzip or brotli for `.html`, `.js`, `.css`, `.json`, `.svg` and `.txt`. GitHub Pages compresses automatically, but it sets `max-age=600` on every file and does not allow custom headers. That is acceptable: hashed names and versioned content stay correct, and after a deploy old tabs may keep the previous build for up to 10 minutes.

## 5. Rollback

- **App (code or build):** redeploy the previous approved commit. With Pages, run the workflow on that commit. On other hosts, re-upload that release's `release/nested/` and check it against its `nested.sha256`. Keep at least the previous release artifact.
- **Content only:** point `content/index.json` back at the previous version. Do not delete newer version folders while old tabs may still be loading them. Steps: `docs/configuration/content-updates.md`.
- Saves are kept per gameplay hash, so a rollback never deletes a player's runs or best scores.

## 6. After publishing (T29)

Check:
- the root and nested URLs, and a refresh on each;
- HTTPS and the response headers;
- a content update and a rollback;
- play without an account, and that saves stay with their origin;
- the device matrix (GDD 10).

Record the exact URL, commit and browser builds.
