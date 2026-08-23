import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepInputSelectionVisible } from './keepInputSelectionVisible';

describe('keepInputSelectionVisible', () => {
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrame: number;

  beforeEach(() => {
    animationFrames = new Map();
    nextAnimationFrame = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const frame = ++nextAnimationFrame;
      animationFrames.set(frame, callback);
      return frame;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => {
      animationFrames.delete(frame);
    }));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function flushAnimationFrame(): void {
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    for (const callback of callbacks) callback(performance.now());
  }

  function createInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.value = '0123456789abcdef';
    Object.defineProperty(input, 'scrollWidth', { configurable: true, value: 320 });
    document.body.append(input);
    return input;
  }

  it('reveals a caret at the end after WebKit settles the tapped selection', () => {
    const input = createInput();
    const setSelectionRange = vi.spyOn(input, 'setSelectionRange');
    keepInputSelectionVisible(input);

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new MouseEvent('click'));
    setSelectionRange.mockClear();

    flushAnimationFrame();
    expect(input.scrollLeft).toBe(0);
    flushAnimationFrame();

    expect(setSelectionRange).toHaveBeenCalledWith(
      input.value.length,
      input.value.length,
      'none',
    );
    expect(input.scrollLeft).toBe(320);
  });

  it('preserves a caret placed within the visible text', () => {
    const input = createInput();
    const setSelectionRange = vi.spyOn(input, 'setSelectionRange');
    const action = keepInputSelectionVisible(input);
    input.focus();
    input.setSelectionRange(6, 6);
    input.scrollLeft = 48;
    setSelectionRange.mockClear();

    input.dispatchEvent(new PointerEvent('pointerup'));
    flushAnimationFrame();
    flushAnimationFrame();

    expect(setSelectionRange).toHaveBeenCalledWith(6, 6, 'none');
    expect(input.scrollLeft).toBe(48);

    action.destroy();
  });
});
