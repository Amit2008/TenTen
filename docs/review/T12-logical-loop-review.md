# T12 review: the complete logical puzzle loop

- **Reviewed:** 2026-10-29
- **Commit:** `main` after T11 (`d448302`), plus the T12 additions
- **Ruleset:** `classic_proposed_v1`, gameplay hash `sha256:c8781bbe…3f03`

This review audits the headless rules (T04–T11) against GDD §4 and §5 before UI work builds on them. **Sourced** means the reference evidence supports the behavior (GDD §2: S1, S2, S4, S5). **Proposed** means it's this project's own decision, not a verified original value.

## Result

- **No correctness defects found in the move transaction.**
- **No GDD contradictions** required a rule change.
- **New in T12:** alternate-ruleset runs and a readable sample trace. I didn't change any code.

## Checklist

### Board, pieces and placement (GDD 4)

| GDD rule | Basis | Implementation | Evidence | Status |
|---|---|---|---|---|
| 10×10 board, x right, y down, (0,0) top-left | Sourced (board) | `BoardState` row-major; `rules.json` | `tests/domain/*` fixtures | Pass |
| Boards 5–16 per side, trays 1–5 | Proposed | `parseGameplay` ranges | `tests/config` (4/17 rejected); `tests/property/alternate-rulesets.test.ts` (5×5/1, 16×16/5, 7×12/2, 12×5/3, no invariant failures) | Pass |
| 19 fixed orientations, weight 1, no rotation | Proposed | `pieces.json`, `rotation_allowed: false` enforced | `tests/config/gameplay-config.test.ts` | Pass |
| Shape validation (duplicates, repeats, empty, disconnected, negative, non-integer, unsafe, missing color, weight > 0) | Proposed | `parseGameplay`, `parseTheme` | 35 invalid-content cases | Pass |
| A shape that can't fit the empty board is rejected | Proposed | `parseGameplay` | "shape too large for board" case | Pass |
| Legal only if every cell is in bounds and empty; no clamping; all or nothing | Proposed | `canPlace` | `tests/domain/placement.test.ts`, all 19 shapes at every border, per-cell overlap | Pass |
| Preview and commit use the same validator | Proposed | `placePiece` calls `canPlace`; presentation must do the same (T14) | Code path | Pass (UI pending) |
| An invalid placement changes nothing | Proposed | Rejections return before any computation | `tests/application/session.test.ts`; 10,934 injected rejections in T11 | Pass |
| A valid placement consumes only the selected slot; other slots keep identity and position | Sourced (tray), proposed (details) | `placePiece` | Session tests; T11 tray invariant | Pass |
| A blocked piece doesn't end the run while another fits | Proposed | `hasAnyLegalMove` | `legal-moves.test.ts`, `session.test.ts` | Pass |

### Turn resolution, scoring and generation (GDD 5)

| GDD rule | Basis | Implementation | Evidence | Status |
|---|---|---|---|---|
| Command guards: session, revision, live instance, anchor | Proposed | `placePiece` (order below) | Rejection matrix in session tests | Pass |
| Order: copy → place → collect all lines → clear union → score → consume → refill if empty → legal-move search → publish one state | Proposed | `placePiece` | T11 per-move invariants (19,009 + 24,656 moves) | Pass |
| No gravity or cascade; cells outside the union keep their positions | Sourced (line clears), proposed (no gravity) | `resolveClears` | `clearing.test.ts`; T11 "every other cell unchanged" | Pass |
| Lines scanned before any change, so a crossing row and column both count | Proposed | `resolveClears` | 19-cell and 36-cell fixtures | Pass |
| MoveResult fields: id, placed, rows, columns, cleared, delta, consumed, dealt, status | Proposed | `MoveResult` type | Session tests | Pass |
| Revision +1 per accepted move; duplicates and stale commands have no effect | Proposed | `placePiece`, `GameSession` | Duplicate and old-session tests; T11 | Pass |
| Score = P + 10 × L; examples 4 / 11 / 21 / 44 | **Proposed** (not the original formula) | `scoreDelta` | `scoring.test.ts` through real place, clear and score | Pass |
| 19 / 36 unique cells for 1×1 / 2×2 crossings | Proposed | `resolveClears` | `clearing.test.ts`, `scoring.test.ts` | Pass |
| Independent draws with replacement, catalog order, duplicates allowed, no rerolls | **Proposed** | `weightedPieceSource` | `piece-source.test.ts` (distribution, duplicates) | Pass |
| xorshift32_v1: state 1 gives 270369, 67634689, 2647435461; rejection sampling; weight cap | Proposed (specified vectors) | `xorshift32.ts` | Golden tests in Node, Chromium, Firefox and WebKit | Pass |
| Seed from `crypto.getRandomValues`; zero maps to 1; never Math.random | Proposed | `cryptoSeed`, `createGenerator`; purity test bans Math.random | `piece-source.test.ts`, `architecture.test.ts` | Pass |
| Game over only when no live slot fits; a blocked fresh tray is detected immediately | Sourced (space exhaustion), proposed (details) | `hasAnyLegalMove` after every move and at start | Exhaustive 4×4 and sparse 5×5 comparison; 60 of 2,000 T11 runs ended on a blocked refill | Pass |
| Rejected commands don't touch the generator | Proposed | Pure `PieceSource`; draws only on accepted refills | Session test (50 rejections); T11 | Pass |

## Decisions made explicit here

- **Rejection precedence.** The GDD doesn't specify an order. The implementation checks:
  1. `stale_session`
  2. `game_over`
  3. `stale_revision`
  4. `unknown_slot`
  5. `illegal_placement`

  So a command from an old session is always reported as stale, even after that session's game over.
- **Board tiles store the shape ID.** Color comes from the theme mapping, so cosmetic content releases never change saved boards (T04).

## Deferred to later tasks (not transaction defects)

| Item | GDD | Owner |
|---|---|---|
| Update the personal best after each accepted move, scoped by gameplay hash | 5.2 | T17 (save envelope) and T18 (UI) |
| Unique session IDs per new game (e.g. `crypto.randomUUID`) | 5.1 | T18 bootstrap/lifecycle |
| Save revision unchanged by rejections; `storageRevision` kept separate from move revision | 4.3, 9.2 | T17 |
| Preview uses `canPlace` with the same anchor as commit | 4.3, 6.1 | T14 |

## Observations for Amit's play review (T27)

These come from automated play (random or greedy), not human play. They are inputs for T27, not defects:
- **Short automated games.** Median game length is 19 moves with random play and 23 with greedy line-seeking. Best scores were 228 and 423 respectively. Human planning should last much longer, but this suggests the uniform 19-piece weighting is unforgiving.
- **Large pieces are common.** 7 of 19 shapes are 5+ cells (`bar_5_*`, `square_3`, `corner_3_*`), so with equal weights about 37% of draws are large pieces.
- **Blocked refills happen.** 2–4% of runs ended on a fresh tray with no legal move, as the GDD allows. Changing weights would be a proposed rule change with a new gameplay hash.

## Sample trace

[docs/evidence/t12/sample-trace.md](../evidence/t12/sample-trace.md) shows a full 20-move game for seed 2026, ending in game over with score 86. It includes tray contents, anchors, lines, deltas, refills and the board after every move. Move 17 clears row 4.
