import { fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextMenuTrigger } from './contextMenuTrigger';

describe('contextMenuTrigger', () => {
  afterEach(() => vi.useRealTimers());

  it('opens from pointer and keyboard context-menu gestures', async () => {
    const node = document.createElement('button');
    node.getBoundingClientRect = () => ({
      x: 20,
      y: 30,
      left: 20,
      top: 30,
      right: 120,
      bottom: 70,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });
    const onopen = vi.fn();
    const action = contextMenuTrigger(node, { onopen });

    const contextEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 80,
      clientY: 90,
    });
    node.dispatchEvent(contextEvent);
    expect(contextEvent.defaultPrevented).toBe(true);
    expect(onopen).toHaveBeenLastCalledWith(80, 90);

    await fireEvent.keyDown(node, { key: 'F10', shiftKey: true });
    expect(onopen).toHaveBeenLastCalledWith(70, 50);
    action.destroy();
  });

  it('can use Enter and Space for non-button menu triggers', async () => {
    const node = document.createElement('div');
    const onopen = vi.fn();
    const action = contextMenuTrigger(node, { onopen, openOnActivate: true });

    await fireEvent.keyDown(node, { key: 'Enter' });
    await fireEvent.keyDown(node, { key: ' ' });

    expect(onopen).toHaveBeenCalledTimes(2);
    action.destroy();
  });

  it('opens on touch long press, provides feedback, and suppresses its generated click', async () => {
    vi.useFakeTimers();
    const node = document.createElement('button');
    const onopen = vi.fn();
    const click = vi.fn();
    const action = contextMenuTrigger(node, { onopen });
    node.addEventListener('click', click);

    await fireEvent.pointerDown(node, {
      pointerType: 'touch',
      pointerId: 4,
      button: 0,
      clientX: 40,
      clientY: 50,
    });
    expect(node).toHaveClass('touch-active');
    await vi.advanceTimersByTimeAsync(550);
    expect(onopen).toHaveBeenCalledWith(40, 50);

    const pointerUp = new Event('pointerup', { bubbles: true });
    Object.defineProperties(pointerUp, {
      pointerId: { value: 4 },
      pointerType: { value: 'touch' },
    });
    node.dispatchEvent(pointerUp);
    const generatedClick = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    node.dispatchEvent(generatedClick);

    expect(node).not.toHaveClass('touch-active');
    expect(generatedClick.defaultPrevented).toBe(true);
    expect(click).not.toHaveBeenCalled();
    action.destroy();
  });

  it('cancels a long press after the pointer moves beyond the tolerance', async () => {
    vi.useFakeTimers();
    const node = document.createElement('button');
    const onopen = vi.fn();
    const action = contextMenuTrigger(node, { onopen });

    await fireEvent.pointerDown(node, {
      pointerType: 'touch',
      pointerId: 5,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(node, {
      pointerType: 'touch',
      pointerId: 5,
      clientX: 30,
      clientY: 10,
    });
    await vi.advanceTimersByTimeAsync(550);

    expect(onopen).not.toHaveBeenCalled();
    expect(node).not.toHaveClass('touch-active');
    action.destroy();
  });
});
