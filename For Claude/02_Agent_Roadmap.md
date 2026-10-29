# Agent Implementation Roadmap

Version 1.1 | 30 bounded tasks | No implementation tasks completed

## How to execute this roadmap

Read README.md, AGENTS.md and 01_GDD.md first. Select one task whose dependencies are complete. Inspect actual repository files and prerequisite evidence before editing. Work in numeric order by default; T28 can proceed while T27 awaits user review, but T30 requires both review and browser/host verification. Scope entries identify planned responsibilities, not pre-existing files. Split a task into smaller children when necessary while retaining all acceptance criteria.

## Status and completion rules

Use not_started, in_progress, blocked, needs_review and done. Each completed task requires actual changes, executed checks and recorded evidence. A test not run must be labeled NOT RUN with a reason. Building, browser/host verification and user approval are separate facts. Do not invent any of them. Report the next ready task and stop at the current task boundary unless a batch is authorized.

## T01 Record the browser baseline and toolchain

Phase A | Depends on none

Allowed scope: docs/reference, docs/decisions.

Work: Record the classic rules, proposed score and shape catalog, WebGL2 requirement and browser matrix. Pin compatible Node, TypeScript, PixiJS, Vite, Vitest and Playwright versions plus package manager. Identify real desktop and mobile test devices and a proposed hosting base path.

Acceptance:
- Every reference claim is sourced or labeled proposed.
- A pinned minimal Pixi initialization uses an actual WebGL2 context.
- ADR-001 records tool versions, target browsers, devices and rule baseline.

Evidence: Version output, renderer/context evidence and ADR-001.

Boundary: Do not use moving dev-branch APIs or assert universal browser support.

## T02 Create the repository and task ledger

Phase A | Depends on T01

Allowed scope: project root, docs, tools.

Work: Create a strict TypeScript Vite repository with locked dependencies, domain/application/presentation/adapters folders, unit and browser test entry points, AGENTS and task ledger. Use semantic HTML for UI controls.

Acceptance:
- npm ci, npm run typecheck, npm test and npm run build succeed in a clean environment.
- The domain imports no DOM, Pixi, storage or audio APIs.
- Tasks not implemented remain not_started.

Evidence: Initial commit, clean install and build/test logs.

Boundary: Only a shell is expected; do not mark gameplay as implemented.

## T03 Build an early WebGL browser shell

Phase A | Depends on T02

Allowed scope: src/bootstrap, src/adapters/rendering, vite config, public, tests/browser.

Work: Create an early WebGL2 canvas, DOM loading/error shell and production dist build. Verify renderer selection, ResizeObserver sizing, DPR cap, base-aware asset loading and the unsupported-renderer path.

Acceptance:
- Production build serves over HTTP at root and /line-garden/.
- Actual WebGL2 is confirmed; unavailable WebGL displays a DOM error and retry.
- CSS and framebuffer dimensions remain distinct at DPR 1 and 2.

Evidence: Build output, browser console/context details and two-base screenshots.

Boundary: Do not treat a Canvas2D or WebGPU fallback as meeting WebGL acceptance. No live publication is implied.

## T04 Validate configuration and define immutable contracts

Phase A | Depends on T02

Allowed scope: src/domain/models, src/adapters/content, public/content, tests/config.

Work: Define readonly state and command contracts, runtime validation and canonical gameplay hashing. Add a versioned content index and manifest. Validate the examples, supported enums, weights and safe integers before enabling play.

Acceptance:
- All 19 pieces are unique, connected and fit the default board.
- Invalid or stale content cannot start a different ruleset silently.
- Cosmetic edits retain the gameplay hash; rule edits change it.

Evidence: Schema fixtures, content-load failure results and canonical hash examples.

Boundary: No runtime plugin loader. Unsupported features must fail rather than pretend to work.

## T05 Implement placement validation

Phase B | Depends on T04

Allowed scope: domain/placement, tests/domain/placement.

Work: Implement a pure placement query for a shape and anchor. Share it between later previews and commits. Include negative anchors, empty local top-left cells and every bounding edge.

Acceptance:
- Every catalog shape is tested at legal and illegal borders.
- Any overlapping occupied cell rejects the entire placement.
- Input board and shape remain unchanged.

Evidence: Border and overlap fixture results.

Boundary: Do not add screen-coordinate conversion to domain rules.

## T06 Implement simultaneous row and column clearing

Phase B | Depends on T05

Allowed scope: domain/clearing, tests/domain/clearing.

Work: Collect all full rows and columns before clearing. Return unique cleared coordinates and completed line indices. Preserve cells outside the union exactly.

Acceptance:
- Crossing one row and one column removes 19 unique cells.
- Crossing two rows and two columns removes 36 unique cells.
- No gravity, partial clear, color match or second scan cascade occurs.

Evidence: Before and after grid fixtures with occupancy counts.

Boundary: Do not clear rows sequentially before detecting columns.

## T07 Implement the score policy

Phase B | Depends on T06

Allowed scope: domain/scoring, tests/domain/scoring.

Work: Implement the configurable placed-cell plus completed-line formula. Keep simultaneous lines separate from unique cleared cells. Use nonnegative integer score values.

Acceptance:
- The documented examples produce 4, 11, 21 and 44.
- Invalid or previewed moves award zero.
- No implicit combo, streak or time bonus exists.

Evidence: Exact score fixture outputs.

Boundary: This is the proposed formula; do not label it verified original scoring.

## T08 Implement the reproducible piece source

Phase B | Depends on T04

Allowed scope: application/piece_source, adapters/random, tests/generator.

Work: Implement xorshift32_v1 with unsigned state, the specified rejection sampler and a scripted PieceSource. Seed through an injected browser crypto adapter and serialize state as validated integers. Keep cosmetic randomness separate.

Acceptance:
- Seed 1 produces 270369, 67634689 and 2647435461.
- Restore and replay produce identical future deals in Node and supported browser engines.
- Weighted bounds, duplicate deals and rejected-command RNG preservation are tested.

Evidence: Golden-vector outputs, bounded-draw fixtures and cross-engine replay results.

Boundary: No Math.random for deals, hidden rerolls or browser-dependent generators.

## T09 Implement legal move search and terminal detection

Phase B | Depends on T05

Allowed scope: domain/legal_moves, tests/domain/legal_moves.

Work: Enumerate anchors for each live tray instance and short-circuit on a valid one. Define game over only when none fits; consumed slots do not participate.

Acceptance:
- One blocked slot plus one legal slot keeps the game active.
- A fully blocked tray ends the run.
- Small-board exhaustive fixtures agree with an independent enumerator.

Evidence: Known playable and blocked boards, exhaustive comparison counts.

Boundary: Do not test only the selected piece or assume empty area implies a fit.

## T10 Assemble the atomic move transaction

Phase B | Depends on T06, T07, T08, T09

Allowed scope: application/session, tests/application/session.

Work: Compose placement, clear, scoring, consumption, refill and terminal check in the specified order. Clone state and RNG before computing the result. Add session/revision/slot guards.

Acceptance:
- A rejected command changes no state or random values.
- Refill occurs once only after all slots are consumed.
- Duplicate commands cannot double-score, double-deal or consume a new session slot.

Evidence: State-hash traces and lifecycle transaction tests.

Boundary: Publish only complete states; animation must not own the rules.

## T11 Create invariant and replay fixtures

Phase B | Depends on T10

Allowed scope: tests/property, tools/replay, docs/evidence.

Work: Build a headless TypeScript replay runner and bounded seeded sequences. Check occupancy, simultaneous clear invariants, slots and exact state equality on rejection. Preserve minimal failing seeds.

Acceptance:
- At least 1,000 seeded sequences pass the documented invariants.
- A recorded sequence gives identical results in Node and browser tests.
- Immediate no-move deals terminate normally.

Evidence: Actual seed range, commands, outputs and any minimized failures.

Boundary: Do not claim arbitrary random runs prove all possible board states.

## T12 Review the complete logical puzzle loop

Phase B | Depends on T11

Allowed scope: docs/review, direct rule fixes.

Work: Exercise a full headless run and audit the golden fixtures against the GDD. Resolve rule contradictions before UI work depends on them. Summarize score, tray and terminal behavior for review.

Acceptance:
- All Section 5 examples and ordering rules have passing evidence.
- The review identifies proposed behavior as proposed.
- No unresolved correctness defect remains in the transaction.

Evidence: Rule review checklist and sample trace.

Boundary: A rule change needs a decision record and updated affected fixtures.

## T13 Render the responsive WebGL board and tray

Phase C | Depends on T03, T10

Allowed scope: src/presentation/views, src/adapters/pixi, src/adapters/dom, styles, tests/layout.

Work: Render retained board and tray objects in Pixi and scores/controls in the presentation shell. Implement one CSS-to-logical viewport mapping, letterboxing, DPR cap, safe areas and responsive layout with semantic slot buttons.

Acceptance:
- Layouts fit 360 by 640 CSS pixels and desktop/landscape containers.
- All 19 pieces render at DPR 1, 2 and 3 with correct pointer inversion.
- Slot buttons remain at least 44 CSS pixels; no controls are cropped.

Evidence: Real-device and desktop screenshots with coordinate tests.

Boundary: Only the visual canvas uses WebGL; menus remain semantic DOM. No publisher assets.

## T14 Implement mouse and touch drag previews

Phase C | Depends on T13, T05

Allowed scope: src/presentation/drag, src/adapters/pointer, tests/pointer.

Work: Use one Pointer Events adapter, occupied-cell drag picks, pointer capture, one active pointer, drag threshold and touch lift. Reuse domain placement queries and recalculate release coordinates. Prevent a drag from generating a second click command.

Acceptance:
- Ghost and committed cells coincide with touch lift at all edges and scales.
- pointercancel, capture loss, blur, resize and outside release cannot consume a piece.
- A second finger and compatibility click cannot double-submit.

Evidence: Pointer fixtures and recordings from real touch hardware.

Boundary: Set touch-action only on the game canvas; do not disable page navigation globally.

## T15 Add tap selection and keyboard navigation

Phase C | Depends on T14

Allowed scope: presentation/input_modes, tests/input_modes.

Work: Implement DOM slot selection, canvas anchor marker, tap/click placement and keyboard controls for the configured tray size. Scope prevented defaults to focused game controls and suppress repeated commits.

Acceptance:
- Touch, mouse and keyboard place the same shape in identical cells.
- Empty-origin corners use the visible anchor consistently.
- Tab focus, browser shortcuts and page scrolling outside the game remain usable.

Evidence: Control matrix and real keyboard/touch walkthrough.

Boundary: Do not add rotation or automatic placement assistance.

## T16 Implement presentation states and move feedback

Phase C | Depends on T15

Allowed scope: presentation/states, presentation/feedback, tests/states.

Work: Implement selected, dragging, resolving and paused presentation states. Render MoveResult without changing committed rules. On hidden tabs or blur, cancel drag, stop the ticker, pause audio and require Resume. Reset timing on return.

Acceptance:
- Move state commits before animation starts and never replays on Resume.
- Hidden tabs do not continue the render loop.
- Restart and teardown invalidate callbacks and remove listeners.

Evidence: Visibility tests, event listener checks and visual recordings.

Boundary: No domain timers; feedback cannot change gameplay results.

## T17 Persist browser runs with IndexedDB

Phase C | Depends on T10, T04

Allowed scope: src/adapters/indexeddb, src/application/save, tests/persistence.

Work: Implement versioned current/backup envelopes in one transactional write. Save ordered snapshots after moves and settings changes; distinguish storageRevision from move revision. Compare stored revisions inside the same transaction to prevent stale tab writes.

Acceptance:
- Restore preserves board, tray, score and future random draws.
- Saved appears only after transaction completion; failures show Session only or unsaved status.
- Two-tab conflicts, quota failure, unsupported saves and blocked schema upgrades have explicit recovery.

Evidence: Real IndexedDB browser tests, aborted-write and concurrent-tab traces.

Boundary: No reliance on unload saving, no silent overwrite of another tab, and no promise of cloud durability.

## T18 Complete menu pause restart and game over

Phase C | Depends on T16, T17

Allowed scope: presentation/screens, application/lifecycle, tests/lifecycle.

Work: Connect New Game, Continue, restart confirmation, pause, results and Main Menu to browser saves. Display saved/pending/session-only state. Browser tab closure is the exit action.

Acceptance:
- Continue restores the last completed save transaction.
- Restart asks before replacing an active run and respects multi-tab conflicts.
- Blocked fresh trays reach results once; refresh cannot double-score.

Evidence: Browser lifecycle walkthrough and refresh/restore trace.

Boundary: A page reload may lose an unfinished save; never show it as already saved.

## T19 Add instructions settings credits and recovery screens

Phase C | Depends on T18

Allowed scope: presentation/menus, content/text, tests/settings.

Work: Add semantic HTML instructions, settings and credits plus loading, unsupported-renderer, content-error and save-recovery screens. Include volume, theme and reduced-motion settings. Explain browser-local storage briefly.

Acceptance:
- All menus have visible keyboard focus and labeled controls.
- Loading failures offer retry instead of an endless spinner.
- Unsupported WebGL and blocked audio leave a useful HTML interface.

Evidence: DOM accessibility and first-load walkthrough.

Boundary: Do not add account or cloud-sync flows.

## T20 Validate browser input and lifecycle integration

Phase C | Depends on T19, T12

Allowed scope: tests/integration, docs/evidence, direct scoped fixes.

Work: Exercise pointer capture, multi-touch, CSS scaling, DPR, orientation, visibility, rapid commits, refresh during clears and save failure. Compare identical command results across rendering rates.

Acceptance:
- 30, 60 and 144 fps traces have identical logical state hashes.
- Real-device previews match placed cells after touch lift and orientation changes.
- No stuck pointer, resolving lock, default-scroll regression or duplicate move remains.

Evidence: Browser test logs, device recordings and lifecycle checklist.

Boundary: Emulated touch and headless WebKit do not establish real iPhone behavior.

## T21 Finalize original graphics and themes

Phase D | Depends on T20

Allowed scope: public/content/themes, public/content/icons, styles, src/presentation, docs/assets.

Work: Finalize original graphics, DOM typography, licensed hosted font, high-contrast theme and app icon. Wait for font readiness before canvas measurements. Verify controls at mobile CSS sizes.

Acceptance:
- All shapes and validity cues remain readable without color alone.
- The smallest supported view and high DPR have no clipped labels.
- Bundled assets have recorded sources and licenses.

Evidence: Approved screenshots and asset manifest.

Boundary: Do not ship the reference screenshot, logo or extracted game art.

## T22 Implement gesture gated browser audio

Phase D | Depends on T19

Allowed scope: src/adapters/audio, public/content/audio, tests/audio.

Work: Build a Web Audio adapter with a streamed media element for music, short effect buffers, gain controls and shuffled playlist. Unlock or resume only from gestures, lazy-load long audio and guard stale callbacks.

Acceptance:
- Autoplay rejection or absent tracks never block gameplay.
- Pause, tab return and rapid restart cannot advance the playlist incorrectly.
- MP3 music and WAV effects are verified on the browser matrix when supplied.

Evidence: Audio-policy fixtures plus actual device playback results.

Boundary: Optional final music may remain absent; test fixtures are not final assets.

## T23 Polish feedback and accessibility

Phase D | Depends on T21, T22

Allowed scope: presentation/feedback, presentation/focus, tests/accessibility.

Work: Tune clear, placement and invalid-return feedback. Respect prefers-reduced-motion with a stored override. Check focus visibility, DOM target sizes, touch comfort and contrast.

Acceptance:
- Reduced motion preserves every state transition.
- Feedback never obscures the next placement or suggests color matching.
- A complete game is usable by keyboard, by touch and in silence.

Evidence: Comparison recordings and accessibility checklist.

Boundary: Timing changes are presentation-only; do not introduce score streaks.

## T24 Prove versioned web content updates

Phase D | Depends on T23, T17

Allowed scope: docs/configuration, public/content, tests/content_deploy.

Work: Add/remove a piece, change board/tray dimensions, alter scoring, recolor tiles and add audio through a new content version. Publish files to a local HTTP fixture before switching the index. Verify old tabs and rollback.

Acceptance:
- Supported content changes require no application-code rebuild.
- Gameplay hashes and record separation behave correctly.
- Old tabs keep a consistent content version; cosmetic updates preserve resume.

Evidence: Content diffs, two-version HTTP test and rollback trace.

Boundary: Changing hosted content is an operator deployment, not local player file editing.

## T25 Validate graphics and browser failure recovery

Phase D | Depends on T24

Allowed scope: src/adapters/rendering, tests/failures, docs/evidence, direct scoped fixes.

Work: Implement context-loss overlay, input suspension and restoration from the committed state. Inject missing files, failed fetches, malformed JSON, wrong MIME types, audio rejection, storage denial and blocked upgrades.

Acceptance:
- WEBGL_lose_context recovery preserves board, score and tray without replaying a move.
- No-context startup and failed restoration show usable DOM recovery actions.
- Failed content or save operations preserve valid state and expose clear errors.

Evidence: Context-loss recordings, network/storage fault matrix and recovery logs.

Boundary: If the test extension is unavailable, record the gap and use an actual supported device test; never invent a recovery pass.

## T26 Run regression and performance checks

Phase E | Depends on T25

Allowed scope: tests/regression, tools/profiling, docs/evidence.

Work: Run unit, browser and production-build regressions. Measure download size, cold load, command time, active-animation frame intervals and retained resources across 100 restarts on the recorded desktop and phone.

Acceptance:
- Rule, input, save, context and content-version checks pass.
- Recorded measurements meet Section 10 budgets or remain explicit release issues.
- Restart loops retain no stale listeners, sessions or GPU objects.

Evidence: Exact browser/device/build, profiler captures, transfer sizes and test output.

Boundary: Software-rendered CI is not evidence of real mobile GPU performance.

## T27 Review play feel with Amit

Phase E | Depends on T26

Allowed scope: docs/review, approved scoped tuning.

Work: Provide a concrete browser release candidate and review placement accuracy, touch comfort, readability, difficulty and retry pace with Amit. Record feedback and apply authorized tuning.

Acceptance:
- Amit’s actual feedback and decision are recorded.
- Any rule changes update hashes, documentation and regression fixtures.
- The final review is accepted or explicitly remains pending.

Evidence: Candidate build/URL, actual review decision and affected retest results.

Boundary: Never fabricate user approval; independent packaging work can continue while review is pending.

## T28 Assemble the static web release candidate

Phase E | Depends on T26

Allowed scope: build scripts, deployment templates, release docs, dist artifact.

Work: Produce a clean locked production build with versioned content and base-aware paths. Include source, licenses, manifest, cache/MIME guidance, rollback steps and a local preview command. Prepare the host deployment without assuming permission to publish.

Acceptance:
- npm ci, typecheck, tests and production build are reproducible.
- Built output works at root and a nested path without file://.
- Release package includes complete static files and verified content-version pointers.

Evidence: Build log, dist manifest, artifact hashes and deployment runbook.

Boundary: Vite preview is not production hosting. T27 can be pending during preparation; publishing needs authorization.

## T29 Verify browsers devices and hosted delivery

Phase E | Depends on T28

Allowed scope: docs/browser_validation, deployment verification, direct release fixes.

Work: Run the required desktop and real mobile matrix against the production candidate. After hosting is authorized, verify HTTPS, caching, compression, MIME types, refresh, nested paths, update consistency and rollback on the selected host.

Acceptance:
- Actual Chrome, Edge, Firefox, Safari, iPhone Safari and Android Chrome results are recorded.
- Touch, audio unlock, storage, context recovery and refresh pass on required targets.
- Hosted root/base-path delivery and rollback are verified with the release artifact.

Evidence: Versions, device models, actual URLs, network traces, screenshots and retest results.

Boundary: Unprovided hosting access or devices leave affected checks NOT RUN; neither a local server nor automated WebKit substitutes for all targets.

## T30 Hand over the verified game

Phase E | Depends on T27, T29

Allowed scope: release, docs/handoff, task ledger.

Work: Confirm all required gates and hand over the verified web release: source, static artifact, content guide, deployment/rollback runbook, controls and actual browser evidence. Record commit, content version and artifact hashes.

Acceptance:
- User review and required browser/hosting gates have actual evidence.
- Source, static artifact and deployed content match the recorded release.
- A new agent can build, deploy and extend the game from the handoff.

Evidence: Final release manifest, deployment identity and handoff checklist.

Boundary: Do not claim offline installation, native executables, universal browser support or unsupplied music as delivered.

## Requirement coverage

| Requirement | Primary tasks |
|---|---|
| Classic grid placement and simultaneous clears | T04 to T07 and T10 |
| Reproducible deals and correct game over | T08 to T12 |
| Accurate drag and accessible alternatives | T13 to T16 and T20 |
| Resume settings and scores | T17 to T19 |
| Original graphics and optional audio | T21 to T23 |
| Easy configuration changes | T04 and T24 to T25 |
| Verified WebGL build and hosted handoff | T03 and T26 to T30 |

## Final handoff checklist

Deliver the static production build, source at a recorded commit, locked dependencies, build command, content guide, deployment and rollback instructions, controls, credits, actual browser evidence, user review and known issues. Distinguish optional unsupplied audio from required unfinished behavior. Do not call the planning archive a playable game.
