export type ContextMenuOpenMethod = 'keyboard' | 'longpress' | 'pointer';

export interface ContextMenuTriggerOptions {
  onopen: (clientX: number, clientY: number, method: ContextMenuOpenMethod) => void;
  openOnActivate?: boolean;
  disabled?: boolean;
}

const longPressDelayMs = 550;
const longPressMovementTolerance = 10;
const nativeContextMenuSuppressionMs = 1_000;

export function contextMenuTrigger(
  node: HTMLElement,
  initialOptions: ContextMenuTriggerOptions,
): { update: (options: ContextMenuTriggerOptions) => void; destroy: () => void } {
  let options = initialOptions;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerId: number | undefined;
  let pointerOrigin: { x: number; y: number } | undefined;
  let suppressNextClick = false;
  let suppressNativeContextMenuUntil = 0;
  let suppressionResetTimer: ReturnType<typeof setTimeout> | undefined;

  function resetClickSuppressionAfterPointerEnd(): void {
    window.removeEventListener('pointerup', resetClickSuppressionAfterPointerEnd, true);
    window.removeEventListener('pointercancel', resetClickSuppressionAfterPointerEnd, true);
    suppressionResetTimer = setTimeout(() => {
      suppressNextClick = false;
      suppressionResetTimer = undefined;
    }, 0);
  }

  function cancelLongPress(event?: PointerEvent): void {
    if (event && pointerId !== undefined && event.pointerId !== pointerId) return;
    if (longPressTimer !== undefined) clearTimeout(longPressTimer);
    longPressTimer = undefined;
    pointerId = undefined;
    pointerOrigin = undefined;
    node.classList.remove('touch-active');
  }

  function openFromElement(): void {
    const bounds = node.getBoundingClientRect();
    options.onopen(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, 'keyboard');
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (options.disabled || Date.now() < suppressNativeContextMenuUntil) return;
    cancelLongPress();
    options.onopen(event.clientX, event.clientY, 'pointer');
  }

  function handleKeydown(event: KeyboardEvent): void {
    const contextMenuKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    const activationKey = options.openOnActivate && (event.key === 'Enter' || event.key === ' ');
    if (options.disabled || (!contextMenuKey && !activationKey)) return;
    event.preventDefault();
    openFromElement();
  }

  function handlePointerDown(event: PointerEvent): void {
    suppressNextClick = false;
    if (options.disabled || event.pointerType !== 'touch' || event.button !== 0) return;
    cancelLongPress();
    node.classList.add('touch-active');
    pointerId = event.pointerId;
    pointerOrigin = { x: event.clientX, y: event.clientY };
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      cancelLongPress();
      suppressNextClick = true;
      suppressNativeContextMenuUntil = Date.now() + nativeContextMenuSuppressionMs;
      window.addEventListener('pointerup', resetClickSuppressionAfterPointerEnd, true);
      window.addEventListener('pointercancel', resetClickSuppressionAfterPointerEnd, true);
      options.onopen(event.clientX, event.clientY, 'longpress');
    }, longPressDelayMs);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId || !pointerOrigin) return;
    if (Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y)
      > longPressMovementTolerance) cancelLongPress();
  }

  function handleClick(event: MouseEvent): void {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  node.addEventListener('contextmenu', handleContextMenu);
  node.addEventListener('keydown', handleKeydown);
  node.addEventListener('pointerdown', handlePointerDown);
  node.addEventListener('pointermove', handlePointerMove);
  node.addEventListener('pointerup', cancelLongPress);
  node.addEventListener('pointercancel', cancelLongPress);
  node.addEventListener('pointerleave', cancelLongPress);
  node.addEventListener('click', handleClick, true);

  return {
    update(nextOptions) {
      options = nextOptions;
      if (options.disabled) cancelLongPress();
    },
    destroy() {
      cancelLongPress();
      node.removeEventListener('contextmenu', handleContextMenu);
      node.removeEventListener('keydown', handleKeydown);
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerup', cancelLongPress);
      node.removeEventListener('pointercancel', cancelLongPress);
      node.removeEventListener('pointerleave', cancelLongPress);
      node.removeEventListener('click', handleClick, true);
      window.removeEventListener('pointerup', resetClickSuppressionAfterPointerEnd, true);
      window.removeEventListener('pointercancel', resetClickSuppressionAfterPointerEnd, true);
      if (suppressionResetTimer !== undefined) clearTimeout(suppressionResetTimer);
    },
  };
}
