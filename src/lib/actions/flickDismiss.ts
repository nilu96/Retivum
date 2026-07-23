export interface FlickDismissOptions {
  disabled?: boolean;
  dismiss?: boolean;
  ondismiss: () => void;
}

const dragActivationDistance = 6;
const dismissalDistance = 44;
const returnDurationMs = 160;
const dismissalDurationMs = 180;
const reflowDurationMs = 140;

export function flickDismiss(
  node: HTMLElement,
  initialOptions: FlickDismissOptions,
): { update: (options: FlickDismissOptions) => void; destroy: () => void } {
  let options = initialOptions;
  let pointerId: number | undefined;
  let originY = 0;
  let dragging = false;
  let pendingOffset = 0;
  let dragFrame: number | undefined;
  let reflowFrame: number | undefined;
  let returnTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissalTimer: ReturnType<typeof setTimeout> | undefined;
  let reflowTimer: ReturnType<typeof setTimeout> | undefined;
  let reflowNodes: HTMLElement[] = [];
  let programmaticDismissFrame: number | undefined;

  function clearTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
    if (timer !== undefined) clearTimeout(timer);
  }

  function releasePointerCapture(): void {
    if (pointerId === undefined) return;
    try {
      if (node.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId);
    } catch {
      // Pointer cancellation can release capture before the cleanup handler runs.
    }
  }

  function clearPointer(): void {
    releasePointerCapture();
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerCancel);
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
    pointerId = undefined;
    dragging = false;
    node.classList.remove('flick-dragging');
  }

  function clearDragStyles(): void {
    node.style.removeProperty('--toast-flick-offset');
    node.style.removeProperty('--toast-flick-dismiss-top');
    node.style.removeProperty('--toast-flick-dismiss-left');
    node.style.removeProperty('--toast-flick-dismiss-width');
    node.style.removeProperty('--toast-flick-dismiss-offset');
  }

  function renderDragPosition(): void {
    dragFrame = undefined;
    node.style.setProperty('--toast-flick-offset', `${pendingOffset}px`);
  }

  function scheduleDragPosition(offset: number): void {
    pendingOffset = offset;
    if (dragFrame !== undefined) return;
    dragFrame = requestAnimationFrame(renderDragPosition);
  }

  function clearReflowAnimation(): void {
    if (reflowFrame !== undefined) cancelAnimationFrame(reflowFrame);
    reflowFrame = undefined;
    clearTimer(reflowTimer);
    reflowTimer = undefined;
    for (const sibling of reflowNodes) {
      sibling.classList.remove('toast-reflow-preparing', 'toast-reflowing');
      sibling.style.removeProperty('--toast-reflow-offset');
    }
    reflowNodes = [];
  }

  function remainingToastPositions(): Map<HTMLElement, number> {
    const positions = new Map<HTMLElement, number>();
    for (const sibling of node.parentElement?.children ?? []) {
      if (
        sibling instanceof HTMLElement
        && sibling !== node
        && sibling.classList.contains('toast-notification')
        && !sibling.classList.contains('flick-dismissing')
      ) positions.set(sibling, sibling.getBoundingClientRect().top);
    }
    return positions;
  }

  function animateRemainingToasts(previousPositions: Map<HTMLElement, number>): void {
    clearReflowAnimation();
    for (const [sibling, previousTop] of previousPositions) {
      if (!sibling.isConnected) continue;
      const offset = previousTop - sibling.getBoundingClientRect().top;
      if (Math.abs(offset) < 0.5) continue;
      sibling.classList.add('toast-reflow-preparing');
      sibling.style.setProperty('--toast-reflow-offset', `${offset}px`);
      reflowNodes.push(sibling);
    }
    if (!reflowNodes.length) return;
    void node.parentElement?.getBoundingClientRect();
    reflowFrame = requestAnimationFrame(() => {
      reflowFrame = undefined;
      for (const sibling of reflowNodes) {
        sibling.classList.remove('toast-reflow-preparing');
        sibling.classList.add('toast-reflowing');
        sibling.style.setProperty('--toast-reflow-offset', '0px');
      }
      reflowTimer = setTimeout(clearReflowAnimation, reflowDurationMs);
    });
  }

  function resetPosition(): void {
    clearPointer();
    node.classList.add('flick-returning');
    clearDragStyles();
    clearTimer(returnTimer);
    returnTimer = setTimeout(() => {
      node.classList.remove('flick-returning');
      returnTimer = undefined;
    }, returnDurationMs);
  }

  function dismiss(): void {
    if (node.classList.contains('flick-dismissing')) return;
    const previousPositions = remainingToastPositions();
    const currentOffset = Number.parseFloat(node.style.getPropertyValue('--toast-flick-offset')) || 0;
    const bounds = node.getBoundingClientRect();
    const layoutTop = bounds.top - currentOffset;
    node.style.setProperty('--toast-flick-dismiss-top', `${layoutTop}px`);
    node.style.setProperty('--toast-flick-dismiss-left', `${bounds.left}px`);
    node.style.setProperty('--toast-flick-dismiss-width', `${bounds.width}px`);
    node.style.setProperty('--toast-flick-dismiss-offset', `${-(layoutTop + bounds.height + 32)}px`);
    clearPointer();
    node.classList.remove('flick-returning');
    node.classList.add('flick-dismissing');
    animateRemainingToasts(previousPositions);
    clearTimer(dismissalTimer);
    dismissalTimer = setTimeout(() => {
      dismissalTimer = undefined;
      options.ondismiss();
    }, dismissalDurationMs);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (
      options.disabled
      || (event.pointerType !== 'touch' && event.pointerType !== 'pen')
      || event.button !== 0
      || pointerId !== undefined
    ) return;
    clearTimer(returnTimer);
    returnTimer = undefined;
    node.classList.remove('flick-returning');
    pointerId = event.pointerId;
    originY = event.clientY;
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    const offset = Math.min(0, event.clientY - originY);
    if (!dragging && -offset < dragActivationDistance) return;
    if (!dragging) {
      dragging = true;
      node.classList.add('flick-dragging');
      try {
        node.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic events and older WebViews may not expose pointer capture.
      }
    }
    event.preventDefault();
    scheduleDragPosition(offset);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    const upwardDistance = originY - event.clientY;
    if (dragging && upwardDistance >= dismissalDistance) {
      event.preventDefault();
      dismiss();
      return;
    }
    resetPosition();
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    resetPosition();
  }

  node.addEventListener('pointerdown', handlePointerDown);
  if (initialOptions.dismiss) {
    programmaticDismissFrame = requestAnimationFrame(() => {
      programmaticDismissFrame = undefined;
      dismiss();
    });
  }

  return {
    update(nextOptions) {
      const shouldDismiss = nextOptions.dismiss && !options.dismiss;
      options = nextOptions;
      if (options.disabled && pointerId !== undefined) resetPosition();
      if (shouldDismiss) dismiss();
    },
    destroy() {
      if (programmaticDismissFrame !== undefined) cancelAnimationFrame(programmaticDismissFrame);
      clearPointer();
      clearTimer(returnTimer);
      clearTimer(dismissalTimer);
      clearReflowAnimation();
      clearDragStyles();
      node.removeEventListener('pointerdown', handlePointerDown);
    },
  };
}
