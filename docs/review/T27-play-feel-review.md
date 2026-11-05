# T27 play-feel review

- **Status:** ACCEPTED. Amit approved the round 1 changes on 5 Nov 2026.
- **Candidate:** `main` at `e66dcd9` (the T26 merge), production build with content 1.1.0 and ruleset `classic_proposed_v1`. It is served locally with `vite preview --host` at `http://localhost:4300/` and `http://10.30.40.235:4300/` (local network only, nothing is published).

## What is being reviewed, and the current values

| Area | Current value | Where it is tuned |
|---|---|---|
| Placement accuracy | Drag threshold 6 CSS px, and the ghost snaps to the nearest cell | `runtime.json` `drag_threshold_css_px` |
| Touch comfort | On touch, the piece floats 36 CSS px above the finger. Controls are at least 44 CSS px | `runtime.json` `touch_lift_css_px`, `minimum_control_css_px` |
| Readability | Atkinson Hyperlegible, light, dark and high-contrast themes, piece colours | `theme.json` |
| Difficulty | 10×10 board, 3-piece tray, weighted random pieces, no rotation | `rules.json`, `pieces.json` (a gameplay change gives a new hash) |
| Retry pace | Place 120 ms, clear 280 ms, invalid return 160 ms. Results show after the last move's feedback, and Play again starts a new run at once | `theme.json` `feedback_ms` |

## Amit's feedback

### Round 1 (5 Nov 2026)

> things to change:
> 1) I want that the touch will not only be on the squares of the shape but I want a collider that engulf the whole shape
> 2) when a line is finished I want that each square of the line will shrink and fadeout until disappeares with a small delay between each square so it looks like it happes 1 after the other

## Decision

Round 1 asked for two changes. Both were implemented, and Amit re-checked them and replied "approved" (5 Nov 2026). The review is accepted.

1. **Pickup collider.** A press anywhere inside a tray piece's bounding box now picks it up for a drag. That includes the empty cells of L shapes (`src/presentation/drag/drag.ts`). Taps already selected anywhere in the slot. The grabbed cell, even an empty one, stays under the pointer, so the ghost and the placed cells still match.
2. **Line clear.** Each cleared tile now shrinks about its centre and fades, one after another along its line: rows left to right, columns top to bottom, and crossing lines sweep from their top-left. The new theme key is `feedback_ms.clear_stagger` (optional, default 0, at most 200 ms). Content 1.1.0 now has `clear` 200 ms per tile (was 280 ms for all tiles at once) and `clear_stagger` 25 ms. A full 10-tile line therefore takes 425 ms. With reduced motion, the tiles fade together without shrinking, over 200 ms.
   - New moves are not accepted while the clear plays (GDD 6.3), so a longer sweep slows the pace of play slightly.
   - The view reuses one hidden tile per board cell, so a clear creates no graphics objects.

Neither change touches the rules, so the gameplay hash is unchanged. `theme.json` in release 1.1.0 was edited in place because 1.1.0 has never been published. Once content is hosted, a change like this would ship as a new version (see `docs/configuration/content-updates.md`).

## Retests after tuning

- `npm run typecheck`: 0 errors. `npm test`: 324 passed. This includes:
  - a new stagger and reduced-motion test (`tests/states/states.test.ts`);
  - the updated pickup test, now with a ghost-and-commit case grabbed by the L's empty origin (`tests/pointer/drag.test.ts`).
- `npx playwright test --workers=4`: 34 passed.
  - The first run had 2 `content-deploy` failures on the root project. Playwright had reused an older `vite preview` on port 4173 that was serving a stale `dist/`. After a rebuild, all 34 passed.
- Candidate rebuilt from the working tree and served again at `http://10.30.40.235:4300/`.

## Round 2 (5 Nov 2026, during T29, on the live build)

> there is still something that needs fixing
> I feel that is not so easy to click on shapes before dragging them
> we should have bigger interaction area when we try to drag a shape

**Change.** A drag now starts from anywhere in a tray slot's whole column below the board (`src/presentation/drag/drag.ts`). The column is the slot's width, and the first and last slots reach the canvas edges. It runs from the board's bottom edge to the canvas bottom.

A press outside the shape grabs the shape's nearest bounding-box cell, and the piece jumps so that cell sits under the pointer. The ghost and the placed cells still match. Taps already selected anywhere in the slot.

The rules and the gameplay hash are unchanged.

**Retests:**
- Typecheck: clean. `npm test`: 325 passed, including a new test for pickup from the canvas corners and the gap under the board, with exact ghost anchors.
- `npx playwright test --workers=4`: 34 passed.
- Status: superseded by round 3, after Amit found it still not good enough on a Galaxy S24.

## Round 3 (5 Nov 2026, Galaxy S24, live build)

> in my android samsung s24 the clicking area is still not so good
> it should be in the size of 3X3 shape that we have
> for all types of shapes
> treat them like they all have 3X3 shape

Asked to choose between a 3×3-board-square pickup box, bigger tray pieces, or a re-test, Amit chose **bigger tray pieces**.

**Change.** The tray pitch is now sized for a 3×3 box: 120 / (3 + 1) = 30 logical px, up from 20 (`src/presentation/views/layout.ts`).
- Every piece up to 3×3 is drawn at that size, so tray squares are 50% larger. On the S24 that is about 16 CSS px instead of 11.
- Longer pieces shrink only as much as their slot needs: the vertical 4-bar to 24 px, the vertical 5-bar to 20 px. The horizontal bars keep 30 px.
- The round 2 pickup column is unchanged. The rules and the gameplay hash are unchanged.
- Screenshot: `docs/evidence/t29/tray-3x3-s24.png` (384×832 CSS px at DPR 3, Playwright mobile emulation, not the device).

**Retests:**
- Typecheck: clean. `npm test`: 326 passed, with updated tray layout tests, including that every piece up to 3×3 shares the tray pitch.
- `npx playwright test --workers=4`: 34 passed.
- Status: waiting for Amit's re-check on the live site.
