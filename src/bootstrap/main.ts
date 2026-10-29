import { Assets, Graphics, Sprite, type Application } from 'pixi.js';
import { loadContent } from '../adapters/content/load-content';
import { createWebGL2App, fitToHost } from '../adapters/rendering/webgl-app';
import { appUrl } from './app-url';
import './shell.css';

const host = document.getElementById('game')!;
const status = document.getElementById('status')!;
const errorPanel = document.getElementById('error')!;
const errorMessage = document.getElementById('error-message')!;
const webglHelp = document.getElementById('webgl-help')!;
const retry = document.getElementById('retry') as HTMLButtonElement;

let app: Application | undefined;
let disposeFit: (() => void) | undefined;
let loadGeneration = 0;
let loadAbort: AbortController | undefined;

function teardown(): void {
  disposeFit?.();
  app?.destroy(true);
  app = disposeFit = undefined;
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
    const [width, height] = content.runtime.logicalSize;
    // Shell content: logical area background plus a base-resolved asset, proving base-aware loading.
    const icon = await Assets.load(appUrl('icon.svg'));
    if (generation !== loadGeneration) return;
    app.stage.addChild(new Graphics().rect(0, 0, width, height).fill(content.theme.background));
    const sprite = new Sprite(icon);
    sprite.anchor.set(0.5);
    sprite.position.set(width / 2, height / 2);
    app.stage.addChild(sprite);
    host.appendChild(app.canvas);
    disposeFit = fitToHost(app, host, content.runtime);
    status.textContent = `Renderer ready (WebGL2). Content ${content.contentVersion} loaded. The game is not implemented yet.`;
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
