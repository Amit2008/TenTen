# Asset manifest

Every file shipped in the build that is not code, with its source and license. Board cells, tray pieces, ghosts and feedback are drawn in code from the piece catalog and `theme.json`; there is no sprite sheet. No screenshot, logo, font or art from 1010! or any other game is included.

| Shipped file | What | Author / source | License | SHA-256 |
|---|---|---|---|---|
| `src/bootstrap/fonts/atkinson-hyperlegible-latin-400-normal.woff2` | Body text font, regular, Latin subset | Braille Institute of America (Atkinson Hyperlegible, 2020). Taken from the npm package `@fontsource/atkinson-hyperlegible` 5.3.0 (`npm pack`, not installed as a dependency), file `files/atkinson-hyperlegible-latin-400-normal.woff2` | SIL OFL 1.1 | `d64ba838ef5472bba248620ec4fd8b5aa7cf0db2908e0bb230600caf279ba7bc` |
| `src/bootstrap/fonts/atkinson-hyperlegible-latin-700-normal.woff2` | Same font, bold | Same package, `files/atkinson-hyperlegible-latin-700-normal.woff2` | SIL OFL 1.1 | `140e2bd25a7315c8a062508391426b0d8c3297400c947b8d847be28f73a199f0` |
| `public/licenses/OFL-Atkinson-Hyperlegible.txt` | The font's license, shipped next to the build as the OFL requires; linked from Credits | `LICENSE` from the same package, unchanged | SIL OFL 1.1 | `e137caeef2ff7c04fbf87078ad09cf3dcba8a3a58a4aa4e2f399d42c50bc4b18` |
| `public/icon.svg` | App icon / favicon: a 3×3 grid with a filled middle row and four colored tiles in the theme palette | Original, written for this project (T03) | Project's own | `1b032fb8511019cd7ccd84466f3ecc3c8a049ea02739ba376290bd2827e7eca8` |
| `public/apple-touch-icon.png` | 180×180 home-screen icon | Rendered from `public/icon.svg` with square corners (iOS rounds them) in Playwright Chromium, T21 | Project's own | `9c990a7150ca2b858027611f47b04948ebb939dfb4f7d502acadd0d47568cee0` |
| Pause icon (inline SVG in `index.html`) | Two rounded bars, drawn in the text color | Original, T21 | Project's own | n/a (inline) |

The font files are the Fontsource builds, unchanged by this project (Fontsource converts the upstream fonts to WOFF2 and splits them by script). The license header declares no Reserved Font Name.

To regenerate the touch icon after changing `icon.svg`: render the SVG without `rx="12"` at 180×180 and screenshot it (the T21 handoff has the exact command).

Libraries (code, not assets): PixiJS 8.22.0, MIT License, credited in the Credits dialog.

Audio: none yet (T22).
