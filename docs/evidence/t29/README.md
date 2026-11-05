# T29 hosted delivery and browser/device results

- **Host:** GitHub Pages, published with Amit's approval on 5 Nov 2026. The repo was made public by Amit, who also turned on Pages and started the run.
- **URL:** https://amit2008.github.io/TenTen/
- **Deploy:** run [42030913940](https://github.com/Amit2008/TenTen/actions/runs/42030913940) (`workflow_dispatch`, success, 12:53 UTC) from commit `cf86a31` on `main`.

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

## Not run (no device or access)

- Firefox desktop, Safari on macOS and Safari on iPhone. Amit has no such device available for this task.
- Android Chrome: pending Amit's manual run (guide in the conversation).
- Rollback on the host: pending.
