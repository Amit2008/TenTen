import type { Application } from 'pixi.js';
import { loadContent } from '../adapters/content/load-content';
import { Hud } from '../adapters/dom/hud';
import { attachKeyboard } from '../adapters/dom/keyboard';
import { Screens } from '../adapters/dom/screens';
import { GameView } from '../adapters/pixi/game-view';
import { cryptoSeed } from '../adapters/random/crypto-seed';
import { attachPointer } from '../adapters/pointer/pointer-adapter';
import { createWebGL2App, fitToHost, setRendering } from '../adapters/rendering/webgl-app';
import { Lifecycle } from '../application/lifecycle/lifecycle';
import { createGenerator, weightedPieceSource } from '../application/piece-source/piece-source';
import { checkRun } from '../application/save/envelope';
import { GameSession, startSession, type SessionRules } from '../application/session/session';
import type { PlacePiece, SessionState } from '../domain/models/types';
import { DragController } from '../presentation/drag/drag';
import { MoveFeedback } from '../presentation/feedback/feedback';
import { SelectionController } from '../presentation/input_modes/selection';
import { PresentationStates } from '../presentation/states/states';
import { boardLayout, trayLayout, viewportRect } from '../presentation/views/layout';
import { appUrl } from './app-url';
import { prepareSaves, type Saves } from './saves';
import './shell.css';

const host = document.getElementById('game')!;
const status = document.getElementById('status')!;
const errorPanel = document.getElementById('error')!;
const errorMessage = document.getElementById('error-message')!;
const webglHelp = document.getElementById('webgl-help')!;
const retry = document.getElementById('retry') as HTMLButtonElement;
const hudPanel = document.getElementById('hud')!;
const scoreOutput = document.getElementById('score')!;
const slotGroup = document.getElementById('slots')!;
const pausePanel = document.getElementById('paused')!;
const resumeButton = document.getElementById('resume') as HTMLButtonElement;

let app: Application | undefined;
let hud: Hud | undefined;
let disposeFit: (() => void) | undefined;
let disposeInput: (() => void) | undefined;
let saves: Saves | undefined;
/** Aborted on teardown: removes every listener the running session added to window, document and the shell. */
let sessionListeners: AbortController | undefined;
let loadGeneration = 0;
let loadAbort: AbortController | undefined;

/** `?seed=<1..4294967295>` (tests) starts a new run at once with a reproducible first deal. */
const seedParam = new URLSearchParams(location.search).get('seed');
const fixedSeed = seedParam && /^\d{1,10}$/.test(seedParam) && Number(seedParam) >= 1 && Number(seedParam) <= 0xffffffff ? Number(seedParam) : null;

function teardown(): void {
  sessionListeners?.abort();
  disposeInput?.();
  disposeFit?.();
  app?.destroy(true);
  hud?.destroy();
  saves?.close();
  hudPanel.hidden = true;
  pausePanel.hidden = true;
  slotGroup.inert = false;
  delete host.dataset.state;
  app = hud = disposeFit = disposeInput = sessionListeners = saves = undefined;
}

/** `loadLatest`: continue the stored run (after a conflict) even when `?seed=` would start a new one. */
async function start({ loadLatest = false } = {}): Promise<void> {
  const generation = ++loadGeneration;
  loadAbort?.abort();
  const abort = (loadAbort = new AbortController());
  teardown();
  errorPanel.hidden = true;
  status.textContent = 'Loading…';
  try {
    const content = await loadContent(appUrl(''), (url, init) => fetch(url, init), abort.signal);
    if (generation !== loadGeneration) return;
    const created = await createWebGL2App(content.runtime);
    if (generation !== loadGeneration) return void created.destroy(true);
    app = created;
    const { gameplay, runtime, theme } = content;
    const rules: SessionRules = { config: gameplay, gameplayHash: content.gameplayHash, source: weightedPieceSource };
    // Only the first run of a seeded load uses the fixed seed; Play Again deals fresh pieces.
    let seed = loadLatest ? null : fixedSeed;
    const newRun = (): SessionState => {
      const run = startSession(rules, crypto.randomUUID(), createGenerator(seed ?? cryptoSeed()));
      seed = null;
      return run;
    };
    // A conflict can be reported before the game is wired up; it is applied as soon as it is.
    let conflicted = false;
    let lockGame = (): void => {};
    const opened = (saves = await prepareSaves({
      contentVersion: content.contentVersion,
      gameplayHash: content.gameplayHash,
      checkRun: (run) => checkRun(run, gameplay, content.gameplayHash),
      forceNew: seed !== null,
      isCurrent: () => generation === loadGeneration,
      onConflict: () => {
        conflicted = true;
        lockGame();
      },
      reload: () => void start({ loadLatest: true }),
    }));
    const board = boardLayout(runtime.boardRect, gameplay.columns, gameplay.rows);
    const tray = trayLayout(runtime.trayRect, gameplay.traySize, gameplay.catalog);
    const viewport = viewportRect(runtime.logicalSize, runtime.boardRect);

    // The run on screen; null until New Game, Continue or a seeded start. An empty board stands in for it.
    let session: GameSession | null = null;
    const empty: SessionState = { ...startSession(rules, 'none', createGenerator(1)), tray: Array<null>(gameplay.traySize).fill(null) };
    const current = (): SessionState => session?.state ?? empty;

    app.renderer.background.color = theme.background;
    const view = new GameView(gameplay, theme, content.colorKeys, board, tray);
    app.stage.addChild(view.container);
    const canvas = app.canvas;
    const shownHud = (hud = new Hud(gameplay, scoreOutput, slotGroup, (slot) => {
      selection.selectSlot(slot);
      canvas.focus(); // arrows and Enter act on the board next
    }));
    const show = (state: SessionState): void => {
      view.update(state);
      shownHud.update(state);
    };
    show(empty);
    hudPanel.hidden = false;

    const reducedMotion = theme.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    let resultsPending = false;
    const states = new PresentationStates(runtime.animationDtCapSeconds, (frame) => {
      view.showFeedback(frame);
      if (frame) return;
      // Results wait for the last move's feedback, then appear once per run.
      if (resultsPending && session) {
        resultsPending = false;
        lifecycle.finished(session.state);
      }
      sync();
    });
    /** The board takes input only while a run is played: not paused, not behind a screen, not stale. */
    const sync = (): void => {
      canvas.inert = slotGroup.inert = conflicted || states.paused || !lifecycle.playing;
      host.dataset.state = lifecycle.playing ? states.label(drag.dragging, selection.selected) : lifecycle.screen;
    };

    // Every input mode submits the same PlacePiece command through here. The move is committed and shown first;
    // feedback only decorates it, and no command is accepted while it resolves, while paused or off the board.
    const commit = (command: PlacePiece): void => {
      if (!session || !lifecycle.playing || !states.acceptsCommands) return;
      const before = session.state;
      const result = session.place(command);
      if (result.accepted) {
        show(result.state);
        opened.save(result.state); // queued right away; Saved shows only once the transaction completes
        resultsPending = result.state.status === 'game_over';
        states.play(new MoveFeedback(before, result, theme.feedbackMs, reducedMotion));
      }
      selection.refresh();
      sync();
    };
    const selection = new SelectionController(
      { config: gameplay, board, tray },
      current,
      (preview) => {
        view.showSelection(preview);
        shownHud.setSelected(preview?.slot ?? null);
        sync();
      },
      commit,
    );
    const drag = new DragController(
      { config: gameplay, viewport, board, tray, dragThresholdCssPx: runtime.dragThresholdCssPx, touchLiftCssPx: runtime.touchLiftCssPx },
      current,
      (preview) => {
        if (preview) selection.clear(); // a direct drag replaces any tap/keyboard selection
        view.showDrag(preview);
        sync();
      },
      commit,
      (point) => selection.tap(point),
    );
    const shownApp = app;
    shownApp.ticker.maxFPS = runtime.renderFpsCap;
    shownApp.ticker.add((t) => states.tick(t.deltaMS / 1000));

    // Pause stops the render loop entirely; only Resume (or leaving the run) starts it again (GDD 6.3).
    const pause = (): void => {
      if (!lifecycle.playing || states.paused || conflicted) return;
      drag.cancel();
      states.pause();
      setRendering(shownApp, false);
      pausePanel.hidden = false;
      resumeButton.focus();
      sync();
    };
    const leavePause = (): void => {
      if (conflicted) return;
      pausePanel.hidden = true;
      if (states.paused) states.resume();
      setRendering(shownApp, true);
      sync();
    };
    const resume = (): void => {
      if (!states.paused || conflicted) return;
      leavePause();
      canvas.focus();
    };

    let canContinue = false;
    const lifecycle = new Lifecycle((screen) => {
      if (screen !== 'playing') {
        drag.cancel();
        selection.clear();
      }
      const shown = current();
      screens.show(screen, { canContinue, score: shown.score, best: Math.max(opened.best(), shown.score) });
      sync(); // first: an inert canvas cannot take focus
      if (screen === 'playing') canvas.focus();
    });
    /** Shows `run` and plays it. A new run is saved at once; a fresh deal with no legal move goes straight to results. */
    const beginRun = (run: SessionState, isNew: boolean): void => {
      session = new GameSession(rules, run);
      states.reset();
      resultsPending = false;
      view.showFeedback(null);
      leavePause();
      show(run);
      if (isNew) opened.save(run);
      lifecycle.play();
      lifecycle.finished(run);
    };
    const openMenu = async (): Promise<void> => {
      leavePause();
      canContinue = (await opened.continuable()) !== null;
      if (generation === loadGeneration && !conflicted) lifecycle.menu();
    };
    /** Continue restores the last completed save transaction (or, while saving is off, the run in memory). */
    const continueGame = async (): Promise<void> => {
      const run = await opened.continuable();
      if (generation !== loadGeneration || conflicted) return;
      if (run) beginRun(run, false);
      else await openMenu();
    };
    /** New Game, Restart and Play Again: replacing an unfinished run (here or in storage) asks first. */
    const newGame = async (): Promise<void> => {
      leavePause();
      const replacing = session?.state.status === 'active' ? session.state : await opened.continuable();
      if (generation === loadGeneration && lifecycle.requestNewGame(replacing) === 'start') beginRun(newRun(), true);
    };
    const screens = new Screens({
      continueGame: () => void continueGame(),
      newGame: () => void newGame(),
      confirmNewGame: () => beginRun(newRun(), true),
      cancelNewGame: () => lifecycle.cancelNewGame(),
      mainMenu: () => void openMenu(),
    });

    const { signal } = (sessionListeners = new AbortController());
    resumeButton.addEventListener('click', resume, { signal });
    if (runtime.pauseOnHidden) {
      window.addEventListener('blur', pause, { signal });
      document.addEventListener('visibilitychange', () => document.hidden && pause(), { signal });
    }

    slotGroup.before(canvas);
    disposeFit = fitToHost(app, host, viewport, runtime.resolutionCap);
    const disposePointer = attachPointer(canvas, drag);
    const disposeKeyboard = attachKeyboard(canvas, selection, gameplay.traySize, pause);
    disposeInput = () => (disposePointer(), disposeKeyboard(), screens.destroy());
    // Another tab saved first: stop play until the player loads the latest save (GDD 9.2).
    // Rendering keeps running so the board stays visible under the notice; only input is blocked.
    lockGame = () => {
      drag.cancel();
      states.pause();
      setRendering(shownApp, true); // also when a blur pause had stopped it
      pausePanel.hidden = true;
      sync();
    };
    if (conflicted) lockGame();

    status.textContent = `Renderer ready (WebGL2). Content ${content.contentVersion} loaded.`;
    // A seeded load and a set-aside damaged save start playing at once; Load latest continues the stored run.
    if (opened.startNew || seed !== null) beginRun(newRun(), true);
    else if (loadLatest) await continueGame();
    else await openMenu();
  } catch (error) {
    if (generation !== loadGeneration) return;
    teardown();
    console.error(error);
    status.textContent = '';
    const rendererError = error instanceof Error && error.name === 'RendererUnavailableError';
    webglHelp.hidden = !rendererError;
    errorMessage.textContent = rendererError
      ? error.message
      : error instanceof Error && error.name === 'ContentError'
          ? `The game content could not be loaded. ${error.message}`
          : 'The game could not load. Check your connection and try again.';
    errorPanel.hidden = false;
    retry.focus();
  }
}

retry.addEventListener('click', () => void start());
void start();
