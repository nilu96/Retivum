import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MicronPage from './MicronPage.svelte';

describe('MicronPage', () => {
  afterEach(() => {
    document.documentElement.dataset.theme = 'system';
    vi.unstubAllGlobals();
  });

  it('renders Micron markup and delegates page links without browser navigation', async () => {
    const onlink = vi.fn();
    render(MicronPage, {
      markup: '> Welcome to the node\n`[Open next page`:/page/next.mu]',
      onlink,
    });

    expect(screen.getByText('Welcome to the node')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open next page' });
    expect(link).toHaveAttribute('href', '#');
    await fireEvent.click(link);
    expect(onlink).toHaveBeenCalledWith(':/page/next.mu', {});
  });

  it('submits selected Micron fields alongside preset request variables', async () => {
    const onlink = vi.fn();
    render(MicronPage, {
      markup: '`<query`initial>`\n`[Inspect heap`:/page/stack.mu`query|c=heap]',
      onlink,
    });

    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'updated' } });
    await fireEvent.click(screen.getByRole('link', { name: 'Inspect heap' }));

    expect(onlink).toHaveBeenCalledWith(':/page/stack.mu`c=heap', {
      field_query: 'updated',
    });
  });

  it('scrolls same-page fragment links without requesting another page', async () => {
    const onlink = vi.fn();
    const scrollIntoView = vi.fn();
    render(MicronPage, {
      markup: '`[A few demo outputs`:#a-few-demo-outputs]\nSome content before the destination\n> A few demo outputs',
      onlink,
    });

    const link = screen.getByRole('link', { name: 'A few demo outputs' });
    const anchor = document.getElementById('a-few-demo-outputs');
    expect(anchor).not.toBeNull();
    expect(anchor).not.toContainElement(link);
    if (anchor) anchor.scrollIntoView = scrollIntoView;

    await fireEvent.click(link);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(onlink).not.toHaveBeenCalled();
  });

  it('rerenders loaded Micron colors when the selected theme changes', async () => {
    document.documentElement.dataset.theme = 'dark';
    const { container } = render(MicronPage, {
      markup: 'Theme-aware text',
      onlink: vi.fn(),
    });
    const pageContainer = container.querySelector<HTMLElement>('.micron-page > div');

    expect(pageContainer).toHaveStyle({ color: '#ddd' });

    document.documentElement.dataset.theme = 'light';

    await waitFor(() => {
      expect(container.querySelector('.micron-page > div')).toHaveStyle({ color: '#222' });
    });
  });

  it('rerenders loaded Micron colors when the system appearance changes', async () => {
    let systemDark = true;
    let changeListener: (() => void) | undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return systemDark; },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => { changeListener = listener; },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    document.documentElement.dataset.theme = 'system';
    const { container } = render(MicronPage, {
      markup: 'System theme-aware text',
      onlink: vi.fn(),
    });
    const pageContainer = container.querySelector<HTMLElement>('.micron-page > div');

    expect(pageContainer).toHaveStyle({ color: '#ddd' });

    systemDark = false;
    changeListener?.();

    await waitFor(() => {
      expect(container.querySelector('.micron-page > div')).toHaveStyle({ color: '#222' });
    });
  });
});
