import type { Application } from 'pixi.js';
import { loadContent } from '../adapters/content/load-content';
import { Hud } from '../adapters/dom/hud';
import { attachKeyboard } from '../adapters/dom/keyboard';
import { GameView } from '../adapters/pixi/game-view';
import { cryptoSeed } from '../adapters/random/crypto-seed';
import { attachPointer } from '../adapters/pointer/pointer-adapter';
import { createWebGL2App, fitToHost } from '../adapters/rendering/webgl-app';
import { createGenerator, weightedPieceSource } from '../application/piece-source/piece-source';
import { GameSession, startSession, type SessionRules } from '../application/session/session';
import type { PlacePiece, SessionState } from '../domain/models/types';
import { DragController } from '../presentation/drag/drag';
import { SelectionController } from '../presentation/input_modes/selection';
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

let app: Application | undefined;
let hud: Hud | undefined;
let disposeFit: (() => void) | undefined;
let disposeInput: (() => void) | undefined;
let loadGeneration = 0;
let loadAbort: AbortController | undefined;

/** `?seed=<1..4294967295>` gives a reproducible first deal for tests; otherwise the CSPRNG seeds it. */
function initialSeed(): number {
  const param = new URLSearchParams(location.search).get('seed');
  const seed = param && /^\d{1,10}$/.test(param) ? Number(param) : 0;
  return seed >= 1 && seed <= 0xffffffff ? seed : cryptoSeed();
}

function teardown(): void {
  disposeInput?.();
  disposeFit?.();
  app?.destroy(true);
  hud?.destroy();
  hudPanel.hidden = true;
  app = hud = disposeFit = disposeInput = undefined;
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

    // Every input mode submits the same PlacePiece command through here.
    const commit = (command: PlacePiece): void => {
      const result = session.place(command);
      if (result.accepted) show(result.state);
      selection.refresh();
    };
    const selection = new SelectionController(
      { config: gameplay, board, tray },
      () => session.state,
      (preview) => {
        view.showSelection(preview);
        shownHud.setSelected(preview?.slot ?? null);
      },
      commit,
    );
    const drag = new DragController(
      { config: gameplay, viewport, board, tray, dragThresholdCssPx: runtime.dragThresholdCssPx, touchLiftCssPx: runtime.touchLiftCssPx },
      () => session.state,
      (preview) => {
        if (preview) selection.clear(); // a direct drag replaces any tap/keyboard selection
        view.showDrag(preview);
      },
      commit,
      (point) => selection.tap(point),
    );
    slotGroup.before(canvas);
    disposeFit = fitToHost(app, host, viewport, runtime.resolutionCap);
    const disposePointer = attachPointer(canvas, drag);
    const disposeKeyboard = attachKeyboard(canvas, selection, gameplay.traySize);
    disposeInput = () => (disposePointer(), disposeKeyboard());
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
