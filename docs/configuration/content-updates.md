# Publishing a content update

For the operator who hosts the game. Players never edit these files. No code rebuild is needed: the same built app reads whichever version `content/index.json` names.

## What can change this way

Board size (5–16), tray size (1–5), pieces (add, remove, weights), scoring, colors, feedback timings, layout and audio. Anything else (new rules, new generator, undo, rotation) needs code.

## Steps

1. **Copy** the current version directory to a new one, e.g. `content/releases/1.1.0/` → `content/releases/1.2.0/`. Never edit a published version directory in place: open tabs and rollback depend on it.
2. **Edit** the files in the new directory and set `content_version` in its `manifest.json` to `1.2.0`. Every path inside (audio files) is relative to that directory, so copy any audio it names.
3. **Upload** the whole new directory. Open each of its URLs and check it answers (the test does this for every file).
4. **Switch** by changing `content/index.json` to `{"schema_version": 1, "content_version": "1.2.0", "manifest": "releases/1.2.0/manifest.json"}`. That file must be served with revalidation (no long cache).
5. **Rollback**: point `index.json` back at the previous version. Keep old directories; never delete the one you might roll back to.

## What players see

| Change | Open tabs | Next load |
|---|---|---|
| Colors, timings, layout, audio only (gameplay hash unchanged) | Keep the old version until reloaded | Continue works; same run, new look |
| Board, tray, pieces or scoring (gameplay hash changes) | Keep playing the old rules and saving normally until reloaded | The saved run "was played with different rules". It is kept in the browser, not deleted, and the player chooses Start a new game. Best scores are kept separately per ruleset |
| Rollback after a gameplay change | — | The run played under the newer rules is now the incompatible one, and the same choice appears |

If a tab on the old version keeps playing after another tab has started a game under the new version, the older tab stops at its next save and offers Load latest. The T17 two-tab guard covers this.

## Proof

`tests/browser/content-deploy.spec.ts` runs the real production build against an emulated host:
- **1.2.0 (gameplay change):** 8×8 board, 2 slots, 20 points a line, `bar_5_h` removed, `skew_4` added, new colors, pick sound removed.
- **1.1.1 (colors only).**

It checks the old tab, the new rules, the separate best scores, rollback, and that a cosmetic update keeps the saved run.
