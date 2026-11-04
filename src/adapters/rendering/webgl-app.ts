import { Application, RendererType, Ticker, type WebGLRenderer } from 'pixi.js';
// Only what the game draws with. Pixi's default browser extensions are skipped: its event system would add global
// pointer listeners and a second, always-running rAF loop (Ticker.system) next to our own Pointer Events adapter,
// and its accessibility layer would add a global keydown listener (GDD 6.1, 8.2).
import 'pixi.js/app';
import 'pixi.js/graphics';
import type { Rect } from '../../presentation/views/layout';
import type { RuntimeConfig } from '../content/presentation-config';

type Viewport = Pick<RuntimeConfig, 'logicalSize' | 'resolutionCap'>;

export class RendererUnavailableError extends Error {
  override name = 'RendererUnavailableError';
}

/** Creates a Pixi app on an actual WebGL2 context, or throws. No WebGPU, Canvas2D or WebGL1 fallback. */
export async function createWebGL2App({ logicalSize: [width, height], resolutionCap }: Viewport): Promise<Application> {
  const app = new Application();
  try {
    await app.init({
      preference: ['webgl'],
      preferWebGLVersion: 2,
      width,
      height,
      resolution: Math.min(devicePixelRatio, resolutionCap),
      autoDensity: true,
      antialias: true,
      skipExtensionImports: true,
    });
  } catch (cause) {
    throw new RendererUnavailableError('WebGL could not be started in this browser.', { cause });
  }
  const isWebGL2 =
    app.renderer.type === RendererType.WEBGL && (app.renderer as WebGLRenderer).context.webGLVersion === 2;
  if (!isWebGL2) {
    app.destroy(true);
    throw new RendererUnavailableError('This browser provides WebGL, but not WebGL2.');
  }
  setRendering(app, true); // a previous app may have been torn down while paused
  return app;
}

/**
 * Starts or stops every Pixi frame loop: the app's render ticker and Ticker.system, which drives the renderer's
 * scheduler. With both stopped no animation frame is requested at all (GDD 6.3: hidden tabs stop rendering).
 */
export function setRendering(app: Application, on: boolean): void {
  for (const ticker of [app.ticker, Ticker.system]) {
    if (on) ticker.start();
    else ticker.stop();
  }
}

/**
 * Contain-fit the logical `viewport` rect inside `host`: square scaling, letterboxed, DPR-capped backing buffer.
 * Other in-flow children of `host` (score, slot buttons) keep their height; the canvas gets the rest. Overlays
 * positioned absolutely (pause) take no space.
 */
export function fitToHost(app: Application, host: HTMLElement, [x, y, width, height]: Rect, resolutionCap: number): () => void {
  const fit = (): void => {
    let reserved = 0;
    for (const child of host.children)
      if (child !== app.canvas && getComputedStyle(child).position !== 'absolute') reserved += (child as HTMLElement).offsetHeight;
    const scale = Math.min(host.clientWidth / width, (host.clientHeight - reserved) / height);
    if (!(scale > 0)) return;
    const cssWidth = Math.floor(width * scale);
    const cssHeight = Math.floor(height * scale);
    app.renderer.resize(cssWidth, cssHeight, Math.min(devicePixelRatio, resolutionCap));
    // Scale from the floored CSS box so drawing matches clientToLogical exactly (the aspect error is under 1 px).
    app.stage.scale.set(cssWidth / width, cssHeight / height);
    app.stage.position.set((-x * cssWidth) / width, (-y * cssHeight) / height);
  };
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  // The rows above and below the canvas can change height too (late font, Retry saving): refit then as well.
  for (const child of host.children) if (child !== app.canvas) observer.observe(child);
  // A DPR change (zoom, moving monitors) does not always resize the host.
  let dprQuery: MediaQueryList | undefined;
  const watchDpr = (): void => {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  };
  const onDpr = (): void => {
    fit();
    watchDpr();
  };
  watchDpr();
  fit();
  return () => {
    observer.disconnect();
    dprQuery?.removeEventListener('change', onDpr);
  };
}
