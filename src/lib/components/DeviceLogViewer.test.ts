import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeviceLogViewer from './DeviceLogViewer.svelte';

afterEach(cleanup);

function deviceLine(id: number, text: string): { id: number; text: string } {
  return { id, text };
}

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 100,
    bottom: top + height,
    left: 0,
    width: 100,
    height,
    toJSON: () => ({}),
  };
}

describe('DeviceLogViewer', () => {
  it('filters plain device log lines by severity and text', async () => {
    render(DeviceLogViewer, {
      lines: [
        '[!!!] halted',
        '[ERR] radio failed',
        '[WRN] battery low',
        '[NOT] link changed',
        '[INF] radio ready',
        '[VRB] packet details',
        '[DBG] state details',
        '[---] trace point',
        '[...] memory sample',
        'unprefixed information',
      ].map((text, index) => deviceLine(index + 1, text)),
      onclear: vi.fn(),
    });

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'unprefixed information',
      '[...] memory sample',
      '[---] trace point',
      '[DBG] state details',
      '[VRB] packet details',
      '[INF] radio ready',
      '[NOT] link changed',
      '[WRN] battery low',
      '[ERR] radio failed',
      '[!!!] halted',
    ]);

    const level = screen.getByLabelText('Minimum log level') as HTMLSelectElement;
    expect(Array.from(level.options, (option) => option.textContent)).toEqual([
      'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Verbose', 'Debug', 'Trace', 'All',
    ]);
    await fireEvent.change(level, { target: { value: '3' } });
    expect(screen.getByText('[!!!] halted')).toBeInTheDocument();
    expect(screen.getByText('[ERR] radio failed')).toBeInTheDocument();
    expect(screen.getByText('[WRN] battery low')).toBeInTheDocument();
    expect(screen.queryByText('[INF] radio ready')).not.toBeInTheDocument();
    expect(screen.queryByText('unprefixed information')).not.toBeInTheDocument();

    await fireEvent.change(level, { target: { value: '9' } });
    await fireEvent.input(screen.getByLabelText('Filter text'), { target: { value: 'RADIO' } });
    expect(screen.getByText('[ERR] radio failed')).toBeInTheDocument();
    expect(screen.getByText('[INF] radio ready')).toBeInTheDocument();
    expect(screen.queryByText('[WRN] battery low')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((screen.getByLabelText('Filter text') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('[WRN] battery low')).toBeInTheDocument();
  });

  it('keeps the visible log position when new lines are inserted above it', async () => {
    const main = document.createElement('main');
    main.scrollTop = 100;
    document.body.append(main);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === main) return rect(0, 600);
      if (this instanceof HTMLLIElement && this.parentElement) {
        const index = Array.from(this.parentElement.children).indexOf(this);
        return rect(-30 + (index * 20), 20);
      }
      return rect(0, 0);
    });
    const { rerender } = render(DeviceLogViewer, {
      target: main,
      props: {
        lines: [deviceLine(1, 'older'), deviceLine(2, 'newer')],
        onclear: vi.fn(),
      },
    });

    await rerender({
      lines: [deviceLine(1, 'older'), deviceLine(2, 'newer'), deviceLine(3, 'newest')],
      onclear: vi.fn(),
    });

    await waitFor(() => expect(main.scrollTop).toBe(120));
    bounds.mockRestore();
  });

  it('offers to scroll the complete log view back to the top', async () => {
    const main = document.createElement('main');
    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      if (typeof options?.top === 'number') main.scrollTop = options.top;
    });
    Object.defineProperty(main, 'scrollTo', { configurable: true, value: scrollTo });
    document.body.append(main);
    render(DeviceLogViewer, {
      target: main,
      props: { lines: [deviceLine(1, 'device ready')], onclear: vi.fn() },
    });

    main.scrollTop = 120;
    await fireEvent.scroll(main);
    const scrollButton = await screen.findByRole('button', { name: 'Scroll to top' });
    expect(scrollButton).toHaveClass('message-scroll-latest');
    await fireEvent.click(scrollButton);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();
  });
});
