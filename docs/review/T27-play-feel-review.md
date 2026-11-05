# T27 play-feel review

- **Status:** PENDING. Waiting for Amit's feedback.
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

(Recorded as given, verbatim.)

## Decision

(Accepted, or the tuning Amit authorizes.)

## Retests after tuning

(None yet.)
