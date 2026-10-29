import { Assets, Graphics, Sprite, type Application } from 'pixi.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, createWebGL2App, fitToHost } from '../adapters/rendering/webgl-app';
import { appUrl } from './app-url';
import './shell.css';

const host = document.getElementById('game')!;
const status = document.getElementById('status')!;
const errorPanel = document.getElementById('error')!;
const errorMessage = document.getElementById('error-message')!;
const retry = document.getElementById('retry') as HTMLButtonElement;

let app: Application | undefined;
let disposeFit: (() => void) | undefined;
let loadGeneration = 0;

function teardown(): void {
  disposeFit?.();
  app?.destroy(true);
  app = disposeFit = undefined;
}

async function start(): Promise<void> {
  const generation = ++loadGeneration;
  teardown();
  errorPanel.hidden = true;
  status.textContent = 'Loading…';
  try {
    const created = await createWebGL2App();
    if (generation !== loadGeneration) return void created.destroy(true);
    app = created;
    // Shell content (T03): logical area background plus a base-resolved asset, proving base-aware loading.
    const icon = await Assets.load(appUrl('icon.svg'));
    if (generation !== loadGeneration) return;
    app.stage.addChild(new Graphics().rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT).fill(0xf6f3ec));
    const sprite = new Sprite(icon);
    sprite.anchor.set(0.5);
    sprite.position.set(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
    app.stage.addChild(sprite);
    host.appendChild(app.canvas);
    disposeFit = fitToHost(app, host);
    status.textContent = 'Renderer ready (WebGL2). The game is not implemented yet.';
  } catch (error) {
    if (generation !== loadGeneration) return;
    teardown();
    console.error(error);
    status.textContent = '';
    errorMessage.textContent =
      error instanceof Error && error.name === 'RendererUnavailableError'
        ? error.message
        : 'The game could not load. Check your connection and try again.';
    errorPanel.hidden = false;
    retry.focus();
  }
}

retry.addEventListener('click', () => void start());
void start();
