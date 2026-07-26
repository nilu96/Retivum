import {
  setOverlayBackdropVisible,
  type OverlayBackdropKind,
} from '../../infrastructure/appearance/theme';

interface SavedScrollState {
  x: number;
  y: number;
  bodyPosition: string;
  bodyInset: string;
  bodyWidth: string;
  bodyOverflow: string;
  rootOverflow: string;
}

let lockCount = 0;
let savedState: SavedScrollState | undefined;

function isMobileViewport(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 699px)').matches;
}

function acquireBodyScrollLock(backdrop: OverlayBackdropKind): void {
  setOverlayBackdropVisible(true, backdrop);
  if (lockCount++ > 0) return;
  const body = document.body;
  const root = document.documentElement;
  savedState = {
    x: window.scrollX,
    y: window.scrollY,
    bodyPosition: body.style.position,
    bodyInset: body.style.inset,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    rootOverflow: root.style.overflow,
  };
  root.classList.add('overlay-open');
  root.style.overflow = 'hidden';
  body.style.position = 'fixed';
  body.style.inset = `${-savedState.y}px 0 auto`;
  body.style.width = '100%';
  body.style.overflow = 'hidden';
}

function releaseBodyScrollLock(backdrop: OverlayBackdropKind): void {
  if (lockCount === 0) return;
  setOverlayBackdropVisible(false, backdrop);
  if (--lockCount > 0) return;
  const state = savedState;
  savedState = undefined;
  if (!state) return;
  const body = document.body;
  const root = document.documentElement;
  root.classList.remove('overlay-open');
  root.style.overflow = state.rootOverflow;
  body.style.position = state.bodyPosition;
  body.style.inset = state.bodyInset;
  body.style.width = state.bodyWidth;
  body.style.overflow = state.bodyOverflow;
  if (window.scrollX !== state.x || window.scrollY !== state.y) window.scrollTo(state.x, state.y);
}

export function lockBodyScroll(
  _node: HTMLElement,
  backdrop: OverlayBackdropKind = 'modal',
): { destroy: () => void } {
  const locked = isMobileViewport();
  if (locked) acquireBodyScrollLock(backdrop);
  return {
    destroy: () => {
      if (locked) releaseBodyScrollLock(backdrop);
    },
  };
}
