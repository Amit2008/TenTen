import { Application, RendererType, type WebGLRenderer } from 'pixi.js';
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
  return app;
}

/**
 * Contain-fit the logical `viewport` rect inside `host`: square scaling, letterboxed, DPR-capped backing buffer.
 * Other children of `host` (score, slot buttons) keep their height; the canvas gets the rest.
 */
export function fitToHost(app: Application, host: HTMLElement, [x, y, width, height]: Rect, resolutionCap: number): () => void {
  const fit = (): void => {
    let reserved = 0;
    for (const child of host.children) if (child !== app.canvas) reserved += (child as HTMLElement).offsetHeight;
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
