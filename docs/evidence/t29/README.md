# T29 hosted delivery and browser/device results

- **Host:** GitHub Pages, published with Amit's approval on 5 Nov 2026. The repo was made public by Amit, who also turned on Pages and started the run.
- **URL:** https://amit2008.github.io/TenTen/
- **Deploys** (all `workflow_dispatch` from `main`, all successful):
  - [42030913940](https://github.com/Amit2008/TenTen/actions/runs/42030913940): `cf86a31`, first release
  - [42033717753](https://github.com/Amit2008/TenTen/actions/runs/42033717753): `772424f`, review round 2
  - [42036000377](https://github.com/Amit2008/TenTen/actions/runs/42036000377): `3c53522`, round 3
  - [42037920063](https://github.com/Amit2008/TenTen/actions/runs/42037920063): **`3a4453f`, final** (round 4)

## Hosted delivery (checked from this PC, 5 Nov 2026)

| Check | Result | Evidence |
|---|---|---|
| Served files match the release artifact | 29 of 29 files byte-identical to the T28 `nested.sha256` | `hosted-hashes.txt` |
| HTTPS | `http://` returns 301 to `https://amit2008.github.io/TenTen/` | `hosted-headers.txt` |
| MIME types | `text/html`, `application/javascript`, `application/json`, `audio/wav`, `font/woff2`, `image/svg+xml` and `text/plain`, all correct | `hosted-headers.txt` |
| Compression | gzip on HTML, JS, JSON, SVG and TXT. The 102-byte `content/index.json` is served uncompressed. WAV and WOFF2 are not compressed, which is correct | `hosted-headers.txt` |
| Caching | Every file gets `Cache-Control: max-age=600` with an ETag. Pages does not allow `immutable` or `no-cache` headers. This is the known limit in the runbook: after a deploy, an open tab may keep the previous `index.html` for up to 10 minutes. The loader asks for `index.json` with `cache: 'no-cache'` | `hosted-headers.txt` |
| Nested base path | Every request goes to `/TenTen/...` on a single origin. An unknown path returns 404, which is expected because the game has no routes | `hosted-headers.txt`, `live-desktop.json` |
| Root path on the host | **NOT RUN.** A project Pages site is served only under `/TenTen/`. The root build was verified locally in T28 | — |

## Desktop browsers on the live URL

| Browser | Load | Move + Saved | Refresh → Continue | Context loss → restore → Resume | Errors |
|---|---|---|---|---|---|
| Chrome 156.0.8078.80 (Windows 11, Intel Arc Pro 140T) | WebGL2 in 1.96 s | yes | score kept | score kept | none |
| Edge 156.0.4314.58 (same PC) | WebGL2 in 0.99 s | yes | score kept | score kept | none |

Raw output: `live-desktop.json`. Both browsers were driven by Playwright 1.64.1, headed. Keyboard and mouse play on the same builds is covered by the local suite (T26 and T28).

## Final build `3a4453f` (rechecked after the last deploy)

- **Files:** all 29 match a fresh `npm run release` of `3a4453f` (`final-hosted-hashes.txt`, `final-nested.sha256`).
- **Live desktop:** Chrome 156.0.8078.80 loaded in 1.60 s and Edge 156.0.4314.58 in 1.28 s. In both, a move saved, refresh plus Continue kept the score, and context loss and restore kept the score. No errors and no failed requests (`final-live-desktop.json`).

## Android: Samsung Galaxy S24, Chrome (Amit, manual, live site)

Amit played the live site on a Galaxy S24, which led to review rounds 2 to 4 (`docs/review/T27-play-feel-review.md`):
- **Touch pickup:** better after the larger pickup column and the bigger tray pieces. In round 4 Amit said "much better".
- **Saves:** Amit's screenshot shows Score 5 and "Saved" on the device.
- **Pause button:** sat too low; fixed in round 4, and Amit replied "approved".

Not confirmed by Amit, so recorded as **NOT CONFIRMED**:
- the Android and Chrome version numbers;
- the separate results of the sound unlock, refresh plus Continue, switching apps and rotation steps.

## Not run (no device or access)

- Firefox desktop, Safari on macOS and Safari on iPhone. Amit has no such device available for this task.
- Rollback on the host. Amit has not yet chosen whether to run the proposed colours-only 1.1.1 test. The procedure is in the runbook and in `docs/configuration/content-updates.md`, and content rollback was proven against an emulated host in T24.
