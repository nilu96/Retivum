import { createRawSnippet } from 'svelte';
import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu.svelte';

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
const children = createRawSnippet(() => ({
  render: () => '<button role="menuitem">Action</button>',
}));

class TestVisualViewport extends EventTarget {
  offsetLeft = 0;
  offsetTop = 0;
  width = 0;
  height = 0;
  pageLeft = 0;
  pageTop = 0;
  scale = 1;
}

function setVisualViewport(viewport: TestVisualViewport): void {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport as unknown as VisualViewport,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport);
  else Reflect.deleteProperty(window, 'visualViewport');
});

describe('ContextMenu', () => {
  it('closes on a right-click outside without opening the native context menu', () => {
    const onclose = vi.fn();
    render(ContextMenu, {
      x: 100,
      y: 100,
      autofocus: false,
      guardOpeningRelease: false,
      label: 'Actions',
      closeLabel: 'Close actions',
      onclose,
      children,
    });
    const contextEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
    });

    screen.getByRole('button', { name: 'Close actions' }).dispatchEvent(contextEvent);

    expect(contextEvent.defaultPrevented).toBe(true);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('does not close when right-clicking inside the menu', () => {
    const onclose = vi.fn();
    render(ContextMenu, {
      x: 100,
      y: 100,
      autofocus: false,
      guardOpeningRelease: false,
      label: 'Actions',
      closeLabel: 'Close actions',
      onclose,
      children,
    });

    screen.getByRole('menuitem', { name: 'Action' }).dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
    }));

    expect(onclose).not.toHaveBeenCalled();
  });

  it('keeps the menu inside the visual viewport while the software keyboard is open', async () => {
    const viewport = new TestVisualViewport();
    viewport.offsetLeft = 0;
    viewport.offsetTop = 240;
    viewport.width = 390;
    viewport.height = 360;
    setVisualViewport(viewport);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(190);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(140);

    render(ContextMenu, {
      x: 100,
      y: 560,
      autofocus: false,
      guardOpeningRelease: false,
      label: 'Actions',
      closeLabel: 'Close actions',
      onclose: vi.fn(),
      children,
    });

    await waitFor(() => {
      expect(screen.getByRole('menu', { name: 'Actions' })).toHaveStyle({
        left: '100px',
        top: '448px',
      });
    });
  });

  it('repositions when the visual viewport pans above the keyboard', async () => {
    const viewport = new TestVisualViewport();
    viewport.offsetLeft = 0;
    viewport.offsetTop = 100;
    viewport.width = 390;
    viewport.height = 500;
    setVisualViewport(viewport);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(190);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(140);

    render(ContextMenu, {
      x: 100,
      y: 150,
      autofocus: false,
      guardOpeningRelease: false,
      label: 'Actions',
      closeLabel: 'Close actions',
      onclose: vi.fn(),
      children,
    });

    const menu = screen.getByRole('menu', { name: 'Actions' });
    await waitFor(() => expect(menu).toHaveStyle({ top: '150px' }));

    viewport.offsetTop = 220;
    viewport.dispatchEvent(new Event('scroll'));

    await waitFor(() => expect(menu).toHaveStyle({ top: '232px' }));
  });
});
