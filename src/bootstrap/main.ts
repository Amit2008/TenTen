import type { Application } from 'pixi.js';
import { loadContent } from '../adapters/content/load-content';
import { Hud } from '../adapters/dom/hud';
import { attachKeyboard } from '../adapters/dom/keyboard';
import { GameView } from '../adapters/pixi/game-view';
import { cryptoSeed } from '../adapters/random/crypto-seed';
import { attachPointer } from '../adapters/pointer/pointer-adapter';
import { createWebGL2App, fitToHost, setRendering } from '../adapters/rendering/webgl-app';
import { createGenerator, weightedPieceSource } from '../application/piece-source/piece-source';
import { GameSession, startSession, type SessionRules } from '../application/session/session';
import type { PlacePiece, SessionState } from '../domain/models/types';
import { DragController } from '../presentation/drag/drag';
import { MoveFeedback } from '../presentation/feedback/feedback';
import { SelectionController } from '../presentation/input_modes/selection';
import { PresentationStates } from '../presentation/states/states';
import { boardLayout, trayLayout, viewportRect } from '../presentation/views/layout';
import { appUrl } from './app-url';
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
/** Aborted on teardown: removes every listener the running session added to window, document and the shell. */
let sessionListeners: AbortController | undefined;
let loadGeneration = 0;
let loadAbort: AbortController | undefined;

/** `?seed=<1..4294967295>` gives a reproducible first deal for tests; otherwise the CSPRNG seeds it. */
function initialSeed(): number {
  const param = new URLSearchParams(location.search).get('seed');
  const seed = param && /^\d{1,10}$/.test(param) ? Number(param) : 0;
  return seed >= 1 && seed <= 0xffffffff ? seed : cryptoSeed();
}

function teardown(): void {
  sessionListeners?.abort();
  disposeInput?.();
  disposeFit?.();
  app?.destroy(true);
  hud?.destroy();
  hudPanel.hidden = true;
  pausePanel.hidden = true;
  slotGroup.inert = false;
  delete host.dataset.state;
  app = hud = disposeFit = disposeInput = sessionListeners = undefined;
}

async function start(): Promise<void> {
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
    // shortcut: session id and seed are created per page load; T17/T18 add saves, Continue and restart.
    const rules: SessionRules = { config: gameplay, gameplayHash: content.gameplayHash, source: weightedPieceSource };
    const session = new GameSession(rules, startSession(rules, crypto.randomUUID(), createGenerator(initialSeed())));
    const board = boardLayout(runtime.boardRect, gameplay.columns, gameplay.rows);
    const tray = trayLayout(runtime.trayRect, gameplay.traySize, gameplay.catalog);
    const viewport = viewportRect(runtime.logicalSize, runtime.boardRect);

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
      // shortcut: plain status text until the results screen (T18).
      if (state.status === 'game_over') status.textContent = `No moves left. Final score ${state.score}.`;
    };
    show(session.state);
    hudPanel.hidden = false;

    const reducedMotion = theme.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const states = new PresentationStates(runtime.animationDtCapSeconds, (frame) => {
      view.showFeedback(frame);
      if (!frame) sync();
    });
    const sync = (): void => void (host.dataset.state = states.label(drag.dragging, selection.selected));

    // Every input mode submits the same PlacePiece command through here. The move is committed and shown first;
    // feedback only decorates it, and no command is accepted while it resolves or while paused.
    const commit = (command: PlacePiece): void => {
      if (!states.acceptsCommands) return;
      const before = session.state;
      const result = session.place(command);
      if (result.accepted) {
        show(result.state);
        states.play(new MoveFeedback(before, result, theme.feedbackMs, reducedMotion));
      }
      selection.refresh();
      sync();
    };
    const selection = new SelectionController(
      { config: gameplay, board, tray },
      () => session.state,
      (preview) => {
        view.showSelection(preview);
        shownHud.setSelected(preview?.slot ?? null);
        sync();
      },
      commit,
    );
    const drag = new DragController(
      { config: gameplay, viewport, board, tray, dragThresholdCssPx: runtime.dragThresholdCssPx, touchLiftCssPx: runtime.touchLiftCssPx },
      () => session.state,
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

    // Pause stops the render loop entirely; only Resume starts it again (GDD 6.3).
    const pause = (): void => {
      if (states.paused) return;
      drag.cancel();
      states.pause();
      setRendering(shownApp, false);
      canvas.inert = slotGroup.inert = true;
      pausePanel.hidden = false;
      resumeButton.focus();
      sync();
    };
    const resume = (): void => {
      if (!states.paused) return;
      pausePanel.hidden = true;
      canvas.inert = slotGroup.inert = false;
      states.resume();
      setRendering(shownApp, true);
      canvas.focus();
      sync();
    };
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
    disposeInput = () => (disposePointer(), disposeKeyboard());
    sync();
    if (session.state.status === 'active') status.textContent = `Renderer ready (WebGL2). Content ${content.contentVersion} loaded.`;
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
