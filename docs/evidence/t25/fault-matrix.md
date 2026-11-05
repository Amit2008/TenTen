# T25 failure and recovery matrix

Recorded on 5 Nov 2026 on Windows 11 Pro, with Playwright 1.64.1 Chromium (headless, a real GPU WebGL2 context) against the production build (`vite build`, served with `vite preview`). This is browser automation, not a real-device test.

## Graphics

| Fault | How it was injected | Result | Source |
|---|---|---|---|
| WebGL2 unavailable at startup | `--disable-webgl --disable-webgl2 --disable-3d-apis` | An HTML error appears, Retry works, and no canvas is created | `tests/browser/unsupported.spec.ts` (T03, still passing) |
| Context lost during a run | `WEBGL_lose_context.loseContext()` called directly, so Pixi does not auto-restore | The "Graphics paused" overlay appears and the canvas is inert, so no input reaches the game. After 10 s without restoration, the overlay offers Reload with "Save status: Saved" and moves focus to Reload | `tests/browser/persistence.spec.ts` "a lost WebGL context …" |
| Context restored | `restoreContext()` | The overlay hides and the pause screen waits for Resume. After Resume the canvas pixels match the pre-loss screenshot exactly, and the score is unchanged. The stored save revision is unchanged too: no move was replayed or saved again. The next recorded move scores as it does in Node | same test |

## Content and browser services

Script: `fault-injection.mjs`. Raw output: `fault-injection-output.json`. Each content case first creates a saved run, then reloads with the fault, then removes the fault and clicks Retry.

| Fault | Message shown | After Retry |
|---|---|---|
| Missing file (`theme.json` 404) | "The game content could not be loaded. theme.json could not be downloaded (HTTP 404)" | The game loads, the menu offers Continue and the status is Saved, so the saved run is intact |
| Failed fetch (`rules.json` connection reset) | "… rules.json could not be downloaded (network error)" | Same as above |
| Malformed JSON (`pieces.json` truncated) | "… pieces.json is not valid JSON" | Same as above |
| Wrong MIME, HTML body (`rules.json` served as an SPA fallback page) | "… rules.json is not valid JSON" | Same as above |
| Wrong MIME, valid JSON body (`index.json` served as `text/html`) | No error: the game loads normally | Not needed. By design, the loader validates the body, not the header |
| Audio rejection (the `AudioContext` constructor throws `NotAllowedError`) | None | The run starts and can be played, Pause and Resume work, and there are no page errors. The autoplay refusal itself is covered in `audio.spec.ts` (T21) |
| Storage denial (`indexedDB.open` throws `SecurityError`) | Status reads "Not saved (this session only)" | The run can be played and there are no page errors. A quota failure on write is covered in `persistence.spec.ts` (T17) |
| A newer save schema opens in another tab (a real `versionchange`) | Notice: "A newer version of Line Garden opened in another tab. Reload this tab to keep saving." The status changes to "Not saved (this session only)" | The run stays playable |
| Blocked upgrade | Partly checked, see below | — |

**Blocked upgrade.** This cannot happen with the shipped saves: the database schema is version 1, and `blocked` only fires when an older open connection holds up an upgrade. A synthetic `blocked` event, fired by a wrapper just before the open succeeded, caused no error and did not leave the notice showing. That is correct, because the notice is cleared once the open completes. The "Saving is waiting for another Line Garden tab …" message itself was therefore **NOT VERIFIED** in a browser. It becomes testable with the first schema v2.

The first run of the script stopped at the `theme.json` case: the error screen did not appear within the script's wait. The second run, recorded above, passed every case. The cause was not investigated.

## Not run

- Real-device context loss on a mobile GPU, and Safari. These belong to T29.
- Recordings (video) of context loss. The pixel comparison in the browser test replaces them.
