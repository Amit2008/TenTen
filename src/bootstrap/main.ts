import type { Application } from 'pixi.js';
import { loadContent } from '../adapters/content/load-content';
import { Hud } from '../adapters/dom/hud';
import { GameView } from '../adapters/pixi/game-view';
import { cryptoSeed } from '../adapters/random/crypto-seed';
import { createWebGL2App, fitToHost } from '../adapters/rendering/webgl-app';
import { createGenerator, weightedPieceSource } from '../application/piece-source/piece-source';
import { startSession, type SessionRules } from '../application/session/session';
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
let loadGeneration = 0;
let loadAbort: AbortController | undefined;

/** `?seed=<1..4294967295>` gives a reproducible first deal for tests; otherwise the CSPRNG seeds it. */
function initialSeed(): number {
  const param = new URLSearchParams(location.search).get('seed');
  const seed = param && /^\d{1,10}$/.test(param) ? Number(param) : 0;
  return seed >= 1 && seed <= 0xffffffff ? seed : cryptoSeed();
}

function teardown(): void {
  disposeFit?.();
  app?.destroy(true);
  hud?.destroy();
  hudPanel.hidden = true;
  app = hud = disposeFit = undefined;
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
    const state = startSession(rules, crypto.randomUUID(), createGenerator(initialSeed()));

    app.renderer.background.color = theme.background;
    const view = new GameView(
      gameplay,
      theme,
      content.colorKeys,
      boardLayout(runtime.boardRect, gameplay.columns, gameplay.rows),
      trayLayout(runtime.trayRect, gameplay.traySize, gameplay.catalog),
    );
    app.stage.addChild(view.container);
    view.update(state);
    hud = new Hud(gameplay, scoreOutput, slotGroup);
    hud.update(state);
    hudPanel.hidden = false;

    slotGroup.before(app.canvas);
    disposeFit = fitToHost(app, host, viewportRect(runtime.logicalSize, runtime.boardRect), runtime.resolutionCap);
    status.textContent = `Renderer ready (WebGL2). Content ${content.contentVersion} loaded.`;
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
