import type { DragController, PointerSample } from '../../presentation/drag/drag';

/**
 * The one Pointer Events path for canvas gameplay (GDD 6.1). Captures the claiming pointer, ignores every other
 * pointer until it ends, and cancels on pointercancel, capture loss, blur, hidden tab, resize or orientation change.
 */
export function attachPointer(canvas: HTMLCanvasElement, drag: DragController): () => void {
  let activeId: number | null = null;
  let suppressClick = false;

  const sample = (e: PointerEvent): PointerSample => ({
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    client: [e.clientX, e.clientY],
    box: canvas.getBoundingClientRect(),
  });
  const release = (): void => {
    const id = activeId;
    activeId = null; // cleared first, so the lostpointercapture this triggers is ignored
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const cancel = (): void => {
    if (activeId === null) return;
    drag.cancel();
    release();
  };

  const onDown = (e: PointerEvent): void => {
    if (activeId !== null || e.button !== 0) return;
    suppressClick = false;
    if (!drag.down(sample(e))) return;
    activeId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerId === activeId) drag.move(sample(e));
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    const dragged = drag.up(sample(e));
    release();
    suppressClick = dragged;
  };
  const onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId === activeId) cancel();
  };
  // A drag must not also produce a click command; capture phase on the canvas runs before any other click handler.
  const onClick = (e: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const onVisibility = (): void => {
    if (document.hidden) cancel();
  };

  const canvasEvents: [string, EventListener, boolean][] = [
    ['pointerdown', onDown as EventListener, false],
    ['pointermove', onMove as EventListener, false],
    ['pointerup', onUp as EventListener, false],
    ['pointercancel', onPointerEnd as EventListener, false],
    ['lostpointercapture', onPointerEnd as EventListener, false],
    ['click', onClick as EventListener, true],
  ];
  for (const [type, fn, capture] of canvasEvents) canvas.addEventListener(type, fn, capture);
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
  screen.orientation?.addEventListener('change', cancel);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    cancel();
    for (const [type, fn, capture] of canvasEvents) canvas.removeEventListener(type, fn, capture);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('resize', cancel);
    screen.orientation?.removeEventListener('change', cancel);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
