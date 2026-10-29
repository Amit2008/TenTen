import { Application, RendererType } from 'pixi.js';
const app = new Application();
try {
  await app.init({ preference: 'webgl', width: 720, height: 960, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
  document.body.appendChild(app.canvas);
  const gl = app.renderer.gl;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  window.__result = {
    rendererType: app.renderer.type === RendererType.WEBGL ? 'WEBGL' : app.renderer.type,
    webGLVersion: app.renderer.context.webGLVersion,
    isWebGL2Context: gl instanceof WebGL2RenderingContext,
    glVersion: gl.getParameter(gl.VERSION),
    unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
    canvasBacking: [app.canvas.width, app.canvas.height], canvasCss: [app.canvas.style.width, app.canvas.style.height], dpr: devicePixelRatio,
  };
} catch (e) { window.__result = { error: String(e) }; }
