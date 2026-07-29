import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NomadPage, NomadPageLoadUpdate } from '../../domain/nomadnet';
import {
  activeIdentity,
  destinationPathStatuses,
  interfaceStatuses,
  knownDestinations,
  nomadBookmarks,
  nomadDirectoryReady,
  reticulumRuntime,
} from '../../infrastructure/reticulum/runtime';
import NomadNetView from './NomadNetView.svelte';

function setNomadDestinations(records: Array<{
  [key: string]: unknown;
  destinationHash: string;
  displayName?: string;
  heardAt?: string;
}>): void {
  knownDestinations.set(records.map((record) => ({
    destinationHash: record.destinationHash,
    fullDestinationName: 'nomadnetwork.node',
    displayName: record.displayName,
    lastAnnouncedAt: record.heardAt,
    metadata: {},
  })));
}

function useMobileViewport(): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(max-width: 699px)' || query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
}

describe('NomadNetView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    activeIdentity.set(undefined);
    setNomadDestinations([]);
    nomadBookmarks.set([]);
    nomadDirectoryReady.set(true);
    destinationPathStatuses.set({});
    interfaceStatuses.set({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows bookmarks first but defaults to announces when no bookmarks exist', async () => {
    render(NomadNetView);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Bookmarks', 'Announces']);
    expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'No NomadNet announces yet' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    expect(screen.getByRole('heading', { name: 'No bookmarks yet' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search bookmarks')).toBeInTheDocument();
  });

  it('keeps the mobile page controls available while toggling the floating destination panel', async () => {
    useMobileViewport();
    const { container } = render(NomadNetView);

    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    const browser = container.querySelector('.nomad-mobile-browser');
    expect(screen.getByRole('heading', { name: 'NomadNet' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Back one page' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Open announced home page' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Reload page' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Share identity with this page' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Bookmark current address' })).toBeDisabled();
    expect(browser).toHaveClass('expanded');

    const collapse = within(toolbar).getByRole('button', { name: 'Hide destination list' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(browser).not.toHaveClass('stuck');

    const toolbarRect = vi.spyOn(browser!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 320,
      bottom: 52,
      left: 0,
      width: 320,
      height: 52,
      toJSON: () => ({}),
    });
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));
    expect(browser).toHaveClass('at-sticky-edge');
    expect(browser).not.toHaveClass('scroll-takeover');

    scrollY.mockReturnValue(160);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).not.toHaveClass('at-sticky-edge'));

    scrollY.mockReturnValue(0);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).not.toHaveClass('stuck'));
    toolbarRect.mockRestore();

    await fireEvent.click(collapse);
    expect(within(toolbar).getByRole('button', { name: 'Show announces (0)' }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(browser).not.toHaveClass('expanded');
  });

  it('compensates sticky toolbar height changes to preserve the page viewport', async () => {
    useMobileViewport();
    let browserResizeCallback: ResizeObserverCallback | undefined;
    class TestResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element): void {
        if (target.classList.contains('nomad-mobile-browser')) {
          browserResizeCallback = this.callback;
        }
      }

      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const { container } = render(NomadNetView);

    const browser = container.querySelector<HTMLElement>('.nomad-mobile-browser')!;
    const canvas = container.querySelector<HTMLElement>('.nomad-canvas')!;
    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    let browserHeight = 52;
    vi.spyOn(browser, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      top: 0,
      right: 320,
      bottom: browserHeight,
      left: 0,
      width: 320,
      height: browserHeight,
      toJSON: () => ({}),
    }));
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => {
      const viewportOffset = Number.parseFloat(
        canvas.style.getPropertyValue('--nomad-toolbar-viewport-offset'),
      ) || 0;
      return {
        x: 0,
        y: browserHeight + 200 + viewportOffset,
        top: browserHeight + 200 + viewportOffset,
        right: 320,
        bottom: browserHeight + 590 + viewportOffset,
        left: 0,
        width: 320,
        height: 390,
        toJSON: () => ({}),
      };
    });
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120);
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Hide destination list' }));
    browserResizeCallback?.([], {} as ResizeObserver);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Show announces (0)' }));
    expect(document.documentElement).toHaveClass('nomad-toolbar-preserving-viewport');
    browserHeight = 152;
    browserResizeCallback?.([], {} as ResizeObserver);
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 220));
    await waitFor(() => expect(document.documentElement)
      .not.toHaveClass('nomad-toolbar-preserving-viewport'));
  });

  it('does not collapse past the sticky boundary when the toolbar is taller than the scroll offset', async () => {
    useMobileViewport();
    let browserResizeCallback: ResizeObserverCallback | undefined;
    class BoundaryResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element): void {
        if (target.classList.contains('nomad-mobile-browser')) {
          browserResizeCallback = this.callback;
        }
      }

      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', BoundaryResizeObserver);
    const { container } = render(NomadNetView);

    const browser = container.querySelector<HTMLElement>('.nomad-mobile-browser')!;
    const canvas = container.querySelector<HTMLElement>('.nomad-canvas')!;
    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    let browserHeight = 300;
    let scrollY = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
    vi.spyOn(browser, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: Math.max(0, 100 - scrollY),
      top: Math.max(0, 100 - scrollY),
      right: 320,
      bottom: Math.max(0, 100 - scrollY) + browserHeight,
      left: 0,
      width: 320,
      height: browserHeight,
      toJSON: () => ({}),
    }));
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => {
      const viewportOffset = Number.parseFloat(
        canvas.style.getPropertyValue('--nomad-toolbar-viewport-offset'),
      ) || 0;
      const top = 200 + browserHeight - scrollY + viewportOffset;
      return {
        x: 0,
        y: top,
        top,
        right: 320,
        bottom: top + 390,
        left: 0,
        width: 320,
        height: 390,
        toJSON: () => ({}),
      };
    });

    scrollY = 90;
    await fireEvent.scroll(window);
    scrollY = 100;
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));
    vi.mocked(window.scrollTo).mockClear();

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Hide destination list' }));
    browserHeight = 52;
    browserResizeCallback?.([], {} as ResizeObserver);
    expect(canvas.style.getPropertyValue('--nomad-toolbar-viewport-offset')).toBe('0px');
    await waitFor(() => expect(document.documentElement)
      .not.toHaveClass('nomad-toolbar-preserving-viewport'));
    expect(window.scrollTo).toHaveBeenCalledWith(0, 100);
    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 0);
  });

  it('preserves the page viewport while switching scopes in a sticky expanded toolbar', async () => {
    useMobileViewport();
    const { container } = render(NomadNetView);

    const browser = container.querySelector<HTMLElement>('.nomad-mobile-browser')!;
    vi.spyOn(browser, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 320,
      bottom: 300,
      left: 0,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));

    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    expect(document.documentElement).toHaveClass('nomad-toolbar-preserving-viewport');
    await waitFor(() => expect(document.documentElement)
      .not.toHaveClass('nomad-toolbar-preserving-viewport'));
  });

  it('collapses on title and page-margin clicks outside the expanded mobile toolbar', async () => {
    useMobileViewport();
    const { container } = render(NomadNetView);

    const browser = container.querySelector('.nomad-mobile-browser');
    const heading = screen.getByRole('heading', { name: 'NomadNet' });
    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    await fireEvent.click(heading);
    expect(within(toolbar).getByRole('button', { name: 'Show announces (0)' }))
      .toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Show announces (0)' }));
    vi.spyOn(browser!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 320,
      bottom: 52,
      left: 0,
      width: 320,
      height: 52,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));

    await fireEvent.click(container.querySelector('.nomad-page')!);
    expect(within(toolbar).getByRole('button', { name: 'Show announces (0)' }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses an open destination context menu without collapsing the mobile toolbar', async () => {
    useMobileViewport();
    const destinationHash = 'f'.repeat(32);
    setNomadDestinations([{
      destinationHash,
      displayName: 'Context menu node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(NomadNetView);

    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    const row = screen.getByRole('button', { name: /Context menu node/ });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menu', { name: 'NomadNet destination actions' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Close destination actions' }));

    expect(screen.queryByRole('menu', { name: 'NomadNet destination actions' }))
      .not.toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('detects destination overflow before sticky lock and disables it again when content fits', async () => {
    useMobileViewport();
    setNomadDestinations([{
      destinationHash: 'a'.repeat(32),
      displayName: 'Overflow node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const { container } = render(NomadNetView);

    const browser = container.querySelector('.nomad-mobile-browser');
    const panel = container.querySelector<HTMLElement>('.nomad-browser-panel')!;
    let panelScrollHeight = 500;
    Object.defineProperty(panel, 'scrollHeight', {
      configurable: true,
      get: () => panelScrollHeight,
    });
    Object.defineProperty(panel, 'clientHeight', {
      configurable: true,
      get: () => 300,
    });

    await fireEvent.input(screen.getByPlaceholderText('Search announces'), {
      target: { value: 'missing' },
    });
    await waitFor(() => expect(panel).toHaveClass('scrollable'));
    expect(browser).not.toHaveClass('stuck');

    vi.spyOn(browser!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 320,
      bottom: 300,
      left: 0,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));
    expect(panel).toHaveClass('scrollable');

    panelScrollHeight = 300;
    await fireEvent.input(screen.getByPlaceholderText('Search announces'), {
      target: { value: '' },
    });
    await waitFor(() => expect(panel).not.toHaveClass('scrollable'));
  });

  it('hands continued page scrolling to an overflowing panel when the toolbar locks', async () => {
    useMobileViewport();
    setNomadDestinations([{
      destinationHash: 'a'.repeat(32),
      displayName: 'Overflow node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const { container } = render(NomadNetView);

    const browser = container.querySelector<HTMLElement>('.nomad-mobile-browser')!;
    const panel = container.querySelector<HTMLElement>('.nomad-browser-panel')!;
    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    let scrollY = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
    const scrollTo = vi.mocked(window.scrollTo);
    vi.spyOn(browser, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: Math.max(0, 100 - scrollY),
      top: Math.max(0, 100 - scrollY),
      right: 320,
      bottom: Math.max(0, 100 - scrollY) + 300,
      left: 0,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    }));
    Object.defineProperty(panel, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(panel, 'clientHeight', {
      configurable: true,
      get: () => 300,
    });

    await fireEvent.input(screen.getByPlaceholderText('Search announces'), {
      target: { value: 'missing' },
    });
    await waitFor(() => expect(panel).toHaveClass('scrollable'));

    scrollY = 90;
    await fireEvent.scroll(window);
    expect(browser).not.toHaveClass('stuck');

    scrollY = 120;
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));
    expect(browser).toHaveClass('at-sticky-edge');
    expect(browser).toHaveClass('scroll-takeover');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 100);
    expect(panel.scrollTop).toBe(20);

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Hide destination list' }));
    scrollY = 140;
    await fireEvent.scroll(window);
    expect(browser).toHaveClass('stuck');
    expect(browser).not.toHaveClass('at-sticky-edge');
    expect(browser).toHaveClass('scroll-takeover');

    scrollY = 90;
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).not.toHaveClass('stuck'));
    expect(browser).not.toHaveClass('at-sticky-edge');
    expect(browser).not.toHaveClass('scroll-takeover');
  });

  it('does not redefine the sticky edge when a compact pill expands', async () => {
    useMobileViewport();
    const { container } = render(NomadNetView);

    const browser = container.querySelector<HTMLElement>('.nomad-mobile-browser')!;
    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    let scrollY = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    vi.spyOn(browser, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: Math.max(0, 100 - scrollY),
      top: Math.max(0, 100 - scrollY),
      right: 320,
      bottom: Math.max(0, 100 - scrollY) + 300,
      left: 0,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    }));

    scrollY = 120;
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));
    scrollY = 160;
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).not.toHaveClass('at-sticky-edge'));

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Hide destination list' }));
    await fireEvent.click(within(toolbar).getByRole('button', { name: /^Show / }));
    const panel = container.querySelector<HTMLElement>('.nomad-browser-panel')!;
    Object.defineProperty(panel, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(panel, 'clientHeight', {
      configurable: true,
      get: () => 300,
    });
    setNomadDestinations([{
      destinationHash: 'a'.repeat(32),
      displayName: 'Overflow node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    await waitFor(() => expect(panel).toHaveClass('scrollable'));
    expect(browser).toHaveClass('scroll-takeover');
    expect(browser).not.toHaveClass('at-sticky-edge');

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Hide destination list' }));
    expect(browser).not.toHaveClass('expanded');
    expect(browser).not.toHaveClass('at-sticky-edge');
  });

  it('turns the mobile Back action into Cancel while loading', async () => {
    useMobileViewport();
    const destinationHash = '9'.repeat(32);
    vi.spyOn(reticulumRuntime, 'requestNomadPage').mockImplementation(() => new Promise(() => {}));
    const cancelPage = vi.spyOn(reticulumRuntime, 'cancelNomadPage');
    render(NomadNetView);

    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    await fireEvent.input(screen.getByPlaceholderText('destination:/page/path'), {
      target: { value: `${destinationHash}:/page/slow.mu` },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open page' }));

    expect(within(toolbar).queryByRole('button', { name: 'Back one page' })).not.toBeInTheDocument();
    const [cancel, home] = within(toolbar).getAllByRole('button');
    expect(cancel).toHaveAccessibleName('Cancel page loading');
    expect(home).toHaveAccessibleName('Open announced home page');
    expect(home).toBeEnabled();
    expect(cancel).toBeEnabled();
    await fireEvent.click(cancel);
    expect(cancelPage).toHaveBeenCalledWith(destinationHash);
    expect(within(toolbar).getByRole('button', { name: 'Open announced home page' })).toBeDisabled();
  });

  it('selects bookmarks when they finish loading after the view opens', async () => {
    nomadDirectoryReady.set(false);
    render(NomadNetView);
    expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');

    nomadBookmarks.set([{
      id: 'identity:late-bookmark',
      identityId: 'identity',
      destinationHash: '1'.repeat(32),
      path: '/page/index.mu',
      label: 'Loaded bookmark',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    nomadDirectoryReady.set(true);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByPlaceholderText('Search bookmarks')).toBeInTheDocument();
  });

  it('keeps an explicit scope choice made while bookmarks are loading', async () => {
    nomadDirectoryReady.set(false);
    render(NomadNetView);
    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));

    nomadBookmarks.set([{
      id: 'identity:late-bookmark',
      identityId: 'identity',
      destinationHash: '1'.repeat(32),
      path: '/page/index.mu',
      label: 'Loaded bookmark',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    nomadDirectoryReady.set(true);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('shows the interface-required hint only while every interface is disconnected', async () => {
    render(NomadNetView);

    expect(screen.getAllByText('A connected interface is required to request pages.')).toHaveLength(2);

    interfaceStatuses.set({ websocket: 'online' });
    await waitFor(() => {
      expect(screen.queryByText('A connected interface is required to request pages.')).not.toBeInTheDocument();
    });

    interfaceStatuses.set({ websocket: 'reconnecting' });
    await waitFor(() => {
      expect(screen.getAllByText('A connected interface is required to request pages.')).toHaveLength(2);
    });
  });

  it('collapses the mobile directory immediately after choosing an announce or bookmark', async () => {
    useMobileViewport();
    const announcedHash = '1'.repeat(32);
    const bookmarkedHash = '2'.repeat(32);
    setNomadDestinations([{
      id: announcedHash,
      destinationHash: announcedHash,
      displayName: 'Announced node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    nomadBookmarks.set([{
      id: 'identity:bookmark',
      identityId: 'identity',
      destinationHash: bookmarkedHash,
      path: '/page/stack.mu',
      requestData: { var_c: 'heap' },
      identifyBeforeLoad: true,
      label: 'Saved node',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage').mockImplementation(() => new Promise(() => {}));
    render(NomadNetView);
    await screen.findByRole('navigation', { name: 'NomadNet page controls' });

    expect(screen.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'true');
    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    const announcedPage = screen.getByRole('button', { name: /Announced node/ });
    await fireEvent.click(announcedPage);
    expect(screen.getByRole('button', { name: 'Show announces (1)' })).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(screen.getByRole('button', { name: 'Show announces (1)' }));
    const reopenedAnnouncedPage = screen.getByRole('button', { name: /Announced node/ });
    expect(reopenedAnnouncedPage).toHaveClass('active');
    expect(reopenedAnnouncedPage).toHaveAttribute('aria-current', 'page');
    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    const bookmarkedPage = screen.getByRole('button', { name: /Saved node/ });
    await fireEvent.click(bookmarkedPage);
    expect(requestPage).toHaveBeenLastCalledWith(
      bookmarkedHash,
      '/page/stack.mu',
      { var_c: 'heap' },
      expect.any(Function),
      false,
      true,
    );
    expect(screen.getByRole('button', { name: 'Show bookmarks (1)' })).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(screen.getByRole('button', { name: 'Show bookmarks (1)' }));
    const reopenedBookmarkedPage = screen.getByRole('button', { name: /Saved node/ });
    expect(reopenedBookmarkedPage.closest('.nomad-bookmark-row')).toHaveClass('active');
    expect(reopenedBookmarkedPage).toHaveAttribute('aria-current', 'page');
    expect(reopenedBookmarkedPage).toHaveTextContent('/page/stack.mu`c=heap');
  });

  it('collapses the mobile directory immediately after opening an address', async () => {
    useMobileViewport();
    const destinationHash = '3'.repeat(32);
    vi.spyOn(reticulumRuntime, 'requestNomadPage').mockImplementation(() => new Promise(() => {}));
    render(NomadNetView);
    await screen.findByRole('navigation', { name: 'NomadNet page controls' });

    await fireEvent.input(screen.getByPlaceholderText('destination:/page/path'), {
      target: { value: `${destinationHash}:/page/index.mu` },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open page' }));

    expect(screen.getByRole('button', { name: 'Show announces (0)' }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('marks a successful identify-on-load bookmark navigation as identified', async () => {
    const destinationHash = '3'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Identified node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    nomadBookmarks.set([{
      id: 'identity:identified-home',
      identityId: 'identity',
      destinationHash,
      path: '/page/index.mu',
      requestData: {},
      identifyBeforeLoad: true,
      label: 'Identified bookmark',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Identified bookmark page',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Identified hard reload',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: /Identified bookmark/ }));

    expect(await screen.findByText('Identified bookmark page')).toBeInTheDocument();
    expect(requestPage).toHaveBeenCalledWith(
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
      false,
      true,
    );
    const identifiedButton = screen.getByRole('button', {
      name: 'Identity shared with this destination',
    });
    expect(identifiedButton).toBeDisabled();
    expect(identifiedButton).toHaveClass('identified');

    await fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(await screen.findByText('Identified hard reload')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(
      2,
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
      true,
      true,
    );
    expect(screen.getByRole('button', {
      name: 'Identity shared with this destination',
    })).toBeDisabled();
  });

  it('keeps an announced destination active on its subpages while bookmarks remain path-specific', async () => {
    const destinationHash = '4'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Subpage node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    nomadBookmarks.set([{
      id: 'identity:home',
      identityId: 'identity',
      destinationHash,
      path: '/page/index.mu',
      label: 'Home bookmark',
      createdAt: '2026-07-16T10:00:00.000Z',
    }, {
      id: 'identity:details',
      identityId: 'identity',
      destinationHash,
      path: '/page/details.mu',
      label: 'Details bookmark',
      createdAt: '2026-07-16T10:01:00.000Z',
    }]);
    vi.spyOn(reticulumRuntime, 'requestNomadPage').mockImplementation(() => new Promise(() => {}));
    render(NomadNetView);

    await fireEvent.input(screen.getByPlaceholderText('destination:/page/path'), {
      target: { value: `${destinationHash}:/page/details.mu` },
    });
    await fireEvent.submit(screen.getByPlaceholderText('destination:/page/path').closest('form')!);

    expect(screen.getByRole('button', { name: /Home bookmark/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /Details bookmark/ })).toHaveAttribute('aria-current', 'page');
    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    expect(screen.getByRole('button', { name: /Subpage node/ })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the editor when adding the current address and removes it without a dialog', async () => {
    const destinationHash = 'a'.repeat(32);
    const bookmarkId = 'identity:current-page';
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Forest Node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    knownDestinations.update((records) => records.map((record) => (
      record.destinationHash === destinationHash ? { ...record, displayName: 'Forest Node' } : record
    )));
    destinationPathStatuses.set({
      [destinationHash]: { destinationHash, hasPath: true, hops: 1 },
    });
    const addBookmark = vi.spyOn(reticulumRuntime, 'addNomadBookmark').mockImplementation(async () => {
      nomadBookmarks.set([{
        id: bookmarkId,
        identityId: 'identity',
        destinationHash,
        path: '/start',
        requestData: { var_c: 'heap' },
        label: 'Forest Node',
        createdAt: '2026-07-16T10:00:00.000Z',
      }]);
      return true;
    });
    const deleteBookmark = vi.spyOn(reticulumRuntime, 'deleteNomadBookmark').mockImplementation(async () => {
      nomadBookmarks.set([]);
    });
    render(NomadNetView);

    await fireEvent.input(screen.getByPlaceholderText('destination:/page/path'), {
      target: { value: `${destinationHash}:/start\`c=heap` },
    });
    const addCurrent = screen.getByRole('button', { name: 'Bookmark current address' });
    expect(addCurrent).not.toHaveClass('primary', 'bookmarked');
    expect(addCurrent.querySelector('path[fill="currentColor"]')).not.toBeInTheDocument();
    await fireEvent.click(addCurrent);

    expect(screen.getByRole('heading', { name: 'Add bookmark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy bookmark address' }))
      .toHaveTextContent(`${destinationHash}:/start\`c=heap`);
    expect(screen.queryByRole('textbox', { name: 'NomadNet address' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Bookmark name' })).toHaveValue('Forest Node');
    expect(addBookmark).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addBookmark).toHaveBeenCalledWith(
      `${destinationHash}:/start\`c=heap`,
      'Forest Node',
      false,
    ));
    expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('heading', { name: 'Add bookmark' })).not.toBeInTheDocument();

    const removeCurrent = await screen.findByRole('button', { name: 'Remove current bookmark' });
    expect(removeCurrent).toHaveClass('bookmarked');
    expect(removeCurrent.querySelector('path[fill="currentColor"]')).toBeInTheDocument();
    await fireEvent.click(removeCurrent);

    await waitFor(() => expect(deleteBookmark).toHaveBeenCalledWith(bookmarkId));
    expect(screen.queryByRole('heading', { name: 'Edit bookmark' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Bookmark current address' }))
      .not.toHaveClass('bookmarked');
  });

  it('keeps the mobile directory expanded and preserves its sticky viewport when toggling', async () => {
    useMobileViewport();
    const destinationHash = 'a'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    const addBookmark = vi.spyOn(reticulumRuntime, 'addNomadBookmark').mockImplementation(async () => {
      nomadBookmarks.set([{
        id: 'identity:mobile-toggle',
        identityId: 'identity',
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        createdAt: '2026-07-16T10:00:00.000Z',
      }]);
      return true;
    });
    const { container } = render(NomadNetView);

    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    const browser = container.querySelector<HTMLElement>('.nomad-mobile-browser')!;
    await fireEvent.input(screen.getByPlaceholderText('destination:/page/path'), {
      target: { value: `${destinationHash}:/page/index.mu` },
    });
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');
    vi.spyOn(browser, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 320,
      bottom: 300,
      left: 0,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120);
    await fireEvent.scroll(window);
    await waitFor(() => expect(browser).toHaveClass('stuck'));

    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Bookmark current address' }));

    expect(screen.getByRole('heading', { name: 'Add bookmark' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(document.documentElement).not.toHaveClass('nomad-toolbar-preserving-viewport');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Bookmark name' }), {
      target: { value: 'Mobile page' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addBookmark).toHaveBeenCalledWith(
      `${destinationHash}:/page/index.mu`,
      'Mobile page',
      false,
    ));
    expect(document.documentElement).toHaveClass('nomad-toolbar-preserving-viewport');
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('heading', { name: 'Add bookmark' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.documentElement)
      .not.toHaveClass('nomad-toolbar-preserving-viewport'));
  });

  it('copies an announced destination hash and offers to add it as a bookmark', async () => {
    const destinationHash = 'b'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'c'.repeat(32),
      publicKeyHex: 'd'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Fresh node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const addBookmark = vi.spyOn(reticulumRuntime, 'addNomadBookmark').mockResolvedValue(true);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(NomadNetView);
      const row = screen.getByRole('button', { name: /Fresh node/ });

      await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
      expect(screen.getByRole('menu', { name: 'NomadNet destination actions' })).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy destination hash' }));
      expect(writeText).toHaveBeenCalledWith(destinationHash);

      await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Add bookmark' }));
      expect(screen.getByRole('heading', { name: 'Add bookmark' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Bookmark name' })).toHaveValue('Fresh node');
      await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(addBookmark).toHaveBeenCalledWith(
        `${destinationHash}:/page/index.mu`,
        'Fresh node',
        false,
      ));
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps a long-press destination menu open when the opening touch is released', async () => {
    vi.useFakeTimers();
    const destinationHash = 'e'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Touch node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(NomadNetView);

    const row = screen.getByRole('button', { name: /Touch node/ });
    await fireEvent.pointerDown(row, {
      pointerType: 'touch',
      pointerId: 7,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    await vi.advanceTimersByTimeAsync(550);

    const menu = screen.getByRole('menu', { name: 'NomadNet destination actions' });
    const dismiss = screen.getByRole('button', { name: 'Close destination actions' });
    expect(screen.getByRole('menuitem', { name: 'Copy destination hash' })).not.toHaveFocus();
    expect(row).not.toHaveClass('touch-active');
    await fireEvent.pointerUp(dismiss, {
      pointerType: 'touch',
      pointerId: 7,
      clientX: 100,
      clientY: 100,
    });
    await fireEvent.click(dismiss, { detail: 1 });

    expect(menu).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(0);
    await fireEvent.pointerDown(dismiss, {
      pointerType: 'touch',
      pointerId: 8,
      button: 0,
    });
    expect(menu).toBeInTheDocument();
    await fireEvent.pointerUp(dismiss, {
      pointerType: 'touch',
      pointerId: 8,
    });
    expect(menu).toBeInTheDocument();
    await fireEvent.click(dismiss, { detail: 1 });

    expect(screen.queryByRole('menu', { name: 'NomadNet destination actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'false');
    expect(row).not.toHaveClass('touch-active');
  });

  it('focuses the first destination action when the menu is opened from the keyboard', async () => {
    const destinationHash = 'f'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Keyboard node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(NomadNetView);

    const row = screen.getByRole('button', { name: /Keyboard node/ });
    row.focus();
    await fireEvent.keyDown(row, { key: 'F10', shiftKey: true });

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Copy destination hash' })).toHaveFocus();
    });
  });

  it('offers edit and remove actions for a bookmarked destination', async () => {
    const destinationHash = 'c'.repeat(32);
    nomadBookmarks.set([{
      id: 'identity:context-menu-bookmark',
      identityId: 'identity',
      destinationHash,
      path: '/page/community.mu',
      label: 'Community page',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const removeBookmark = vi.spyOn(reticulumRuntime, 'deleteNomadBookmark').mockResolvedValue(undefined);
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    const row = screen.getByRole('button', { name: /Community page/ });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });

    expect(screen.queryByRole('menuitem', { name: 'Add bookmark' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit bookmark' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove bookmark' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit bookmark' }));
    expect(screen.getByRole('heading', { name: 'Edit bookmark' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Bookmark name' })).toHaveValue('Community page');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove bookmark' }));
    expect(removeBookmark).toHaveBeenCalledWith('identity:context-menu-bookmark');
  });

  it('updates the name of an existing bookmark while keeping its address read-only', async () => {
    const destinationHash = 'd'.repeat(32);
    const address = `${destinationHash}:/page/index.mu`;
    nomadBookmarks.set([{
      id: 'identity:bookmark',
      identityId: 'identity',
      destinationHash,
      path: '/',
      label: 'Old name',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const updateBookmark = vi.spyOn(reticulumRuntime, 'updateNomadBookmark').mockResolvedValue(true);
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('textbox', { name: 'Bookmark name' });
    expect(input).toHaveValue('Old name');
    expect(screen.getByRole('button', { name: 'Copy bookmark address' })).toHaveTextContent(address);
    expect(screen.queryByRole('textbox', { name: 'NomadNet address' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Identify before loading/ })).not.toBeChecked();
    await fireEvent.input(input, { target: { value: 'New name' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateBookmark).toHaveBeenCalledWith(
      'identity:bookmark',
      address,
      'New name',
      false,
    ));
  });

  it('removes an existing bookmark from the desktop bookmark action', async () => {
    const destinationHash = 'e'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    nomadBookmarks.set([{
      id: 'identity:existing',
      identityId: 'identity',
      destinationHash,
      path: '/start',
      label: 'Existing bookmark',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const deleteBookmark = vi.spyOn(reticulumRuntime, 'deleteNomadBookmark').mockResolvedValue(undefined);
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    await fireEvent.click(screen.getByRole('button', { name: /Existing bookmark/ }));

    const removeCurrent = screen.getByRole('button', { name: 'Remove current bookmark' });
    expect(removeCurrent).toBeEnabled();
    expect(removeCurrent).toHaveClass('bookmarked');
    expect(removeCurrent.querySelector('path[fill="currentColor"]')).toBeInTheDocument();
    await fireEvent.click(removeCurrent);
    expect(deleteBookmark).toHaveBeenCalledWith('identity:existing');
    expect(screen.queryByRole('heading', { name: 'Edit bookmark' })).not.toBeInTheDocument();
  });

  it('removes an existing bookmark without collapsing the mobile toolbar', async () => {
    useMobileViewport();
    const destinationHash = 'e'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    nomadBookmarks.set([{
      id: 'identity:existing-mobile',
      identityId: 'identity',
      destinationHash,
      path: '/start',
      label: 'Mobile bookmark',
      identifyBeforeLoad: true,
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const deleteBookmark = vi.spyOn(reticulumRuntime, 'deleteNomadBookmark').mockResolvedValue(undefined);
    render(NomadNetView);

    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    await fireEvent.click(screen.getByRole('button', { name: /Mobile bookmark/ }));
    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Show bookmarks (1)' }));
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');

    const removeCurrent = within(toolbar).getByRole('button', { name: 'Remove current bookmark' });
    expect(removeCurrent).toHaveClass('bookmarked');
    await fireEvent.click(removeCurrent);

    expect(deleteBookmark).toHaveBeenCalledWith('identity:existing-mobile');
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('heading', { name: 'Edit bookmark' })).not.toBeInTheDocument();
  });

  it('does not collapse the expanded mobile toolbar while the bookmark editor handles clicks', async () => {
    useMobileViewport();
    nomadBookmarks.set([{
      id: 'identity:editor-clicks',
      identityId: 'identity',
      destinationHash: 'e'.repeat(32),
      path: '/start',
      label: 'Editable bookmark',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(NomadNetView);

    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');

    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Copy bookmark address' }));

    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit bookmark' })).not.toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('does not collapse the expanded mobile toolbar while another dialog is in the foreground', async () => {
    useMobileViewport();
    const destinationHash = 'd'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      destinationHash,
      displayName: 'Dialog test node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    vi.spyOn(reticulumRuntime, 'requestNomadPage').mockResolvedValue({
      destinationHash,
      path: '/page/index.mu',
      requestData: {},
      content: '> Dialog test page',
      receivedAt: '2026-07-16T10:01:00.000Z',
    });
    render(NomadNetView);

    const toolbar = await screen.findByRole('navigation', { name: 'NomadNet page controls' });
    await fireEvent.click(screen.getByRole('button', { name: /Dialog test node/ }));
    expect(await screen.findByText('Dialog test page')).toBeInTheDocument();
    await fireEvent.click(within(toolbar).getByRole('button', { name: 'Show announces (1)' }));

    await fireEvent.click(within(toolbar).getByRole('button', {
      name: 'Share identity with this page',
    }));
    const dialog = screen.getByRole('alertdialog');
    await fireEvent.click(within(dialog).getByRole('heading', { name: 'Share identity?' }));

    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Hide destination list' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('loads announced pages and follows same-destination Micron links', async () => {
    const destinationHash = 'f'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Community Node',
      hops: 1,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    destinationPathStatuses.set({
      [destinationHash]: { destinationHash, hasPath: true, hops: 1 },
    });
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Welcome\n`[Next`:/page/next.mu`c=heap]',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/next.mu',
        requestData: { var_c: 'heap' },
        content: '> Next page',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    render(NomadNetView);
    expect(screen.getByText('Community Node')).toBeInTheDocument();
    expect(screen.getByLabelText('Known path: 1 hop')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('Welcome')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(1, destinationHash, '/page/index.mu', {}, expect.any(Function));
    expect(document.querySelector('.nomad-mobile-browser')).not.toHaveClass('expanded');

    await fireEvent.click(screen.getByRole('link', { name: 'Next' }));
    expect(await screen.findByText('Next page')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(2, destinationHash, '/page/next.mu', { var_c: 'heap' }, expect.any(Function));
  });

  it('shows detailed loading stages, transfer progress, and the final error', async () => {
    const destinationHash = '5'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    let reportUpdate: ((update: NomadPageLoadUpdate) => void) | undefined;
    let finishLoad: ((page: NomadPage | undefined) => void) | undefined;
    vi.spyOn(reticulumRuntime, 'requestNomadPage').mockImplementationOnce(
      (_destination, _path, _requestData, onUpdate) => {
        reportUpdate = onUpdate;
        onUpdate?.({ type: 'progress', stage: 'findingPath' });
        return new Promise((resolve) => { finishLoad = resolve; });
      },
    );
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(screen.getByText('Looking for a Reticulum path to the destination.')).toBeInTheDocument();

    reportUpdate?.({ type: 'progress', stage: 'receivingPage', progress: 0.42, dataSize: 2048 });
    expect(await screen.findByText('Receiving page data from the destination.')).toBeInTheDocument();
    expect(screen.getByText('Transfer progress: 42% of approximately 2 KB')).toBeInTheDocument();

    reportUpdate?.({ type: 'failed', code: 'NOMAD_PATH_REQUEST_TIMEOUT' });
    finishLoad?.(undefined);
    expect(await screen.findByText('No usable Reticulum path to the destination could be found before the request timed out.'))
      .toBeInTheDocument();
    expect(screen.getByText('Error code: NOMAD_PATH_REQUEST_TIMEOUT')).toBeInTheDocument();
  });

  it('retries the failed page even after the address input is changed', async () => {
    const previousHash = '1'.repeat(32);
    const failedHash = '2'.repeat(32);
    setNomadDestinations([{
      id: previousHash,
      destinationHash: previousHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash: previousHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Previous page',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockImplementationOnce((_destination, _path, _requestData, onUpdate) => {
        onUpdate?.({ type: 'failed', code: 'NOMAD_REQUEST_TIMEOUT' });
        return Promise.resolve(undefined);
      })
      .mockResolvedValueOnce({
        destinationHash: failedHash,
        path: '/page/missing.mu',
        requestData: {},
        content: '> Retried page',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(previousHash) }));
    expect(await screen.findByText('Previous page')).toBeInTheDocument();
    const addressInput = screen.getByPlaceholderText('destination:/page/path');
    await fireEvent.input(addressInput, { target: { value: `${failedHash}:/page/missing.mu` } });
    await fireEvent.submit(addressInput.closest('form')!);
    expect(await screen.findByText('The destination did not complete the page request before it timed out.')).toBeInTheDocument();

    await fireEvent.input(addressInput, { target: { value: 'not a destination' } });
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toBeInTheDocument();
    await fireEvent.click(retry);

    expect(await screen.findByText('Retried page')).toBeInTheDocument();
    expect(addressInput).toHaveValue(`${failedHash}:/page/missing.mu`);
    expect(requestPage).toHaveBeenNthCalledWith(
      3,
      failedHash,
      '/page/missing.mu',
      {},
      expect.any(Function),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Back one page' }));
    expect(screen.getByText('Previous page')).toBeInTheDocument();
  });

  it('reloads the failed destination and preserves the page it was opened from', async () => {
    const previousHash = '3'.repeat(32);
    const failedHash = '4'.repeat(32);
    const unrelatedHash = '5'.repeat(32);
    setNomadDestinations([{
      id: previousHash,
      destinationHash: previousHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash: previousHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Page before failure',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockImplementationOnce((_destination, _path, _requestData, onUpdate) => {
        onUpdate?.({ type: 'failed', code: 'NOMAD_DESTINATION_UNKNOWN' });
        return Promise.resolve(undefined);
      })
      .mockResolvedValueOnce({
        destinationHash: failedHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Discovered page',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(previousHash) }));
    expect(await screen.findByText('Page before failure')).toBeInTheDocument();
    const addressInput = screen.getByPlaceholderText('destination:/page/path');
    await fireEvent.input(addressInput, { target: { value: `${failedHash}:/` } });
    await fireEvent.submit(addressInput.closest('form')!);
    expect(await screen.findByText('The destination identity key is unavailable. Wait for a fresh NomadNet announce and try again.'))
      .toBeInTheDocument();

    await fireEvent.input(addressInput, { target: { value: `${unrelatedHash}:/other` } });
    await fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));

    expect(await screen.findByText('Discovered page')).toBeInTheDocument();
    expect(addressInput).toHaveValue(`${failedHash}:/page/index.mu`);
    expect(requestPage).toHaveBeenNthCalledWith(
      3,
      failedHash,
      '/page/index.mu',
      {},
      expect.any(Function),
      true,
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Back one page' }));
    expect(screen.getByText('Page before failure')).toBeInTheDocument();
  });

  it('keeps existing history intact when an unknown destination fails', async () => {
    const firstHash = '6'.repeat(32);
    const secondHash = '7'.repeat(32);
    const unknownHash = '8'.repeat(32);
    setNomadDestinations([{
      id: firstHash,
      destinationHash: firstHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash: firstHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> First history page',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash: secondHash,
        path: '/page/second.mu',
        requestData: {},
        content: '> Second history page',
        receivedAt: '2026-07-16T10:02:00.000Z',
      })
      .mockImplementationOnce((_destination, _path, _requestData, onUpdate) => {
        onUpdate?.({ type: 'failed', code: 'NOMAD_DESTINATION_UNKNOWN' });
        return Promise.resolve(undefined);
      });
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(firstHash) }));
    expect(await screen.findByText('First history page')).toBeInTheDocument();
    const addressInput = screen.getByPlaceholderText('destination:/page/path');
    await fireEvent.input(addressInput, { target: { value: `${secondHash}:/page/second.mu` } });
    await fireEvent.submit(addressInput.closest('form')!);
    expect(await screen.findByText('Second history page')).toBeInTheDocument();

    await fireEvent.input(addressInput, { target: { value: `${unknownHash}:/page/index.mu` } });
    await fireEvent.submit(addressInput.closest('form')!);
    expect(await screen.findByText('The destination identity key is unavailable. Wait for a fresh NomadNet announce and try again.'))
      .toBeInTheDocument();

    const back = screen.getByRole('button', { name: 'Back one page' });
    await fireEvent.click(back);
    expect(screen.getByText('Second history page')).toBeInTheDocument();
    await fireEvent.click(back);
    expect(screen.getByText('First history page')).toBeInTheDocument();
  });

  it('reloads the currently displayed page', async () => {
    useMobileViewport();
    const destinationHash = '9'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> First version',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Reloaded version',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    render(NomadNetView);

    expect(screen.getByRole('button', { name: 'Reload page' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('First version')).toBeInTheDocument();

    vi.mocked(window.scrollTo).mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(await screen.findByText('Reloaded version')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(requestPage).toHaveBeenNthCalledWith(2, destinationHash, '/page/index.mu', {}, expect.any(Function), true);
  });

  it('uses a bookmark policy added after the current page loaded when reloading', async () => {
    const destinationHash = '8'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Newly bookmarked node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Anonymous first load',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Identified reload',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    const addBookmark = vi.spyOn(reticulumRuntime, 'addNomadBookmark')
      .mockImplementation(async (address, label, identifyBeforeLoad) => {
        nomadBookmarks.set([{
          id: `identity:${address}`,
          identityId: 'identity',
          destinationHash,
          path: '/page/index.mu',
          requestData: {},
          identifyBeforeLoad,
          label,
          createdAt: '2026-07-16T10:01:30.000Z',
        }]);
        return true;
      });
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: /Newly bookmarked node/ }));
    expect(await screen.findByText('Anonymous first load')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(
      1,
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Bookmark current address' }));
    await fireEvent.click(screen.getByRole('switch', { name: /Identify before loading/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(addBookmark).toHaveBeenCalledWith(
      `${destinationHash}:/page/index.mu`,
      'Newly bookmarked node',
      true,
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(await screen.findByText('Identified reload')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(
      2,
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
      true,
      true,
    );
  });

  it('replaces an in-progress load with an atomic hard reload', async () => {
    const destinationHash = '6'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    let finishFirstLoad: ((page: NomadPage | undefined) => void) | undefined;
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirstLoad = resolve; }))
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Freshly reloaded page',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    render(NomadNetView);

    const reload = screen.getByRole('button', { name: 'Reload page' });
    expect(reload).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(screen.getByText('Loading NomadNet page')).toBeInTheDocument();
    expect(reload).toBeEnabled();

    await fireEvent.click(reload);
    expect(await screen.findByText('Freshly reloaded page')).toBeInTheDocument();
    expect(requestPage).toHaveBeenCalledTimes(2);
    expect(requestPage).toHaveBeenNthCalledWith(2, destinationHash, '/page/index.mu', {}, expect.any(Function), true);
    finishFirstLoad?.(undefined);
  });

  it('cancels an in-progress navigation and restores the last rendered page', async () => {
    const destinationHash = '4'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    let finishDetails: ((page: NomadPage | undefined) => void) | undefined;
    vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Home before navigation\n`[Open slow page`:/page/slow.mu]',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockImplementationOnce(() => new Promise((resolve) => { finishDetails = resolve; }));
    const cancelPage = vi.spyOn(reticulumRuntime, 'cancelNomadPage');
    render(NomadNetView);

    const back = screen.getByRole('button', { name: 'Back one page' });
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('Home before navigation')).toBeInTheDocument();
    expect(back).toBeDisabled();

    await fireEvent.click(screen.getByRole('link', { name: 'Open slow page' }));
    expect(screen.getByText('Loading NomadNet page')).toBeInTheDocument();
    expect(back).toBeEnabled();

    await fireEvent.click(back);
    expect(cancelPage).toHaveBeenCalledWith(destinationHash);
    expect(screen.getByText('Home before navigation')).toBeInTheDocument();
    expect(screen.queryByText('Loading NomadNet page')).not.toBeInTheDocument();
    expect(back).toBeDisabled();
    finishDetails?.(undefined);
  });

  it('shows a cancel action in the Back slot while loading and restores the cached page', async () => {
    const destinationHash = '3'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    let finishSlowPage: ((page: NomadPage | undefined) => void) | undefined;
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Cached home page\n`[Open slow page`:/page/slow.mu]',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockImplementationOnce(() => new Promise((resolve) => { finishSlowPage = resolve; }));
    const cancelPage = vi.spyOn(reticulumRuntime, 'cancelNomadPage');
    render(NomadNetView);

    const home = screen.getByRole('button', { name: 'Open announced home page' });
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('Cached home page')).toBeInTheDocument();
    expect(home).toBeDisabled();

    await fireEvent.click(screen.getByRole('link', { name: 'Open slow page' }));
    expect(screen.getByText('Loading NomadNet page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back one page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open announced home page' })).toBeEnabled();
    const cancelLoading = screen.getByRole('button', { name: 'Cancel page loading' });
    expect(cancelLoading).toBeEnabled();

    await fireEvent.click(cancelLoading);
    expect(cancelPage).toHaveBeenCalledWith(destinationHash);
    expect(screen.getByText('Cached home page')).toBeInTheDocument();
    expect(screen.queryByText('Loading NomadNet page')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open announced home page' })).toBeDisabled();
    expect(requestPage).toHaveBeenCalledTimes(2);
    finishSlowPage?.(undefined);
  });

  it('cancels an initial page load from the Back slot', async () => {
    const destinationHash = '5'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    let finishLoad: ((page: NomadPage | undefined) => void) | undefined;
    vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockImplementation(() => new Promise((resolve) => { finishLoad = resolve; }));
    const cancelPage = vi.spyOn(reticulumRuntime, 'cancelNomadPage');
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    const cancelLoading = screen.getByRole('button', { name: 'Cancel page loading' });
    expect(cancelLoading).toBeEnabled();

    await fireEvent.click(cancelLoading);
    expect(cancelPage).toHaveBeenCalledWith(destinationHash);
    expect(screen.queryByText('Loading NomadNet page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enter a NomadNet address' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open announced home page' })).toBeDisabled();
    finishLoad?.(undefined);
  });

  it('shares the active identity over the NomadNet link and reloads the page', async () => {
    const destinationHash = '7'.repeat(32);
    const otherDestinationHash = '9'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      displayName: 'Identified node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }, {
      id: otherDestinationHash,
      destinationHash: otherDestinationHash,
      displayName: 'Other node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Anonymous page',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Identified page',
        receivedAt: '2026-07-16T10:02:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/another.mu',
        requestData: {},
        content: '> Identified subpage',
        receivedAt: '2026-07-16T10:03:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash: otherDestinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Other anonymous page',
        receivedAt: '2026-07-16T10:04:00.000Z',
      });
    const identify = vi.spyOn(reticulumRuntime, 'identifyNomadLink').mockResolvedValue(true);
    const queryLinkStatus = vi.spyOn(reticulumRuntime, 'queryNomadLinkStatus')
      .mockResolvedValue({ active: true, identified: true });
    const cancelPage = vi.spyOn(reticulumRuntime, 'cancelNomadPage');
    render(NomadNetView);

    const share = screen.getByRole('button', { name: 'Share identity with this page' });
    expect(share).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('Anonymous page')).toBeInTheDocument();
    expect(share).toBeEnabled();

    await fireEvent.click(share);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Are you sure you want to identify yourself to this NomadNetwork Node? The page will reload after your identity has been sent.',
    );
    expect(identify).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(identify).not.toHaveBeenCalled();

    await fireEvent.click(share);
    await fireEvent.click(screen.getByRole('button', { name: 'Share identity' }));
    expect(identify).toHaveBeenCalledWith(destinationHash);
    expect(await screen.findByText('Identified page')).toBeInTheDocument();
    const identifiedButton = screen.getByRole('button', {
      name: 'Identity shared with this destination',
    });
    expect(identifiedButton).toBeDisabled();
    expect(identifiedButton).toHaveClass('identified');
    expect(requestPage).toHaveBeenNthCalledWith(
      2,
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
      false,
      true,
    );
    expect(cancelPage).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByRole('textbox', { name: 'Destination and path' }), {
      target: { value: `${destinationHash}:/page/another.mu` },
    });
    expect(screen.getByRole('button', {
      name: 'Identity shared with this destination',
    })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
    expect(await screen.findByText('Identified subpage')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(
      3,
      destinationHash,
      '/page/another.mu',
      {},
      expect.any(Function),
      false,
      true,
    );
    expect(screen.getByRole('button', {
      name: 'Identity shared with this destination',
    })).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Back one page' }));
    expect(screen.getByText('Identified page')).toBeInTheDocument();
    expect(queryLinkStatus).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {
      name: 'Identity shared with this destination',
    })).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: /Other node/ }));
    expect(await screen.findByText('Other anonymous page')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(
      4,
      otherDestinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
    );
    expect(screen.queryByRole('button', {
      name: 'Identity shared with this destination',
    })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share identity with this page' })).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Back one page' }));
    expect(screen.getByText('Identified page')).toBeInTheDocument();
    await waitFor(() => expect(queryLinkStatus).toHaveBeenCalledWith(destinationHash));
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Identity shared with this destination',
    })).toBeDisabled());
  });

  it('uses the bookmark policy before link status when reconciling identification on Back', async () => {
    const identifiedHash = '4'.repeat(32);
    const otherHash = '5'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      destinationHash: otherHash,
      displayName: 'Other history node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    nomadBookmarks.set([{
      id: 'identity:auto-history',
      identityId: 'identity',
      destinationHash: identifiedHash,
      path: '/page/index.mu',
      identifyBeforeLoad: true,
      label: 'Auto-identify history page',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    vi.spyOn(reticulumRuntime, 'requestNomadPage').mockImplementation(
      async (destinationHash) => ({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: destinationHash === identifiedHash
          ? '> Auto-identified history page'
          : '> Other history page',
        receivedAt: '2026-07-16T10:01:00.000Z',
      }),
    );
    const queryLinkStatus = vi.spyOn(reticulumRuntime, 'queryNomadLinkStatus')
      .mockResolvedValue({ active: false, identified: false });
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: /Auto-identify history page/ }));
    expect(await screen.findByText('Auto-identified history page')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    await fireEvent.click(screen.getByRole('button', { name: /Other history node/ }));
    expect(await screen.findByText('Other history page')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Back one page' }));
    expect(screen.getByText('Auto-identified history page')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Identity shared with this destination',
    })).toBeDisabled();
    expect(queryLinkStatus).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: /Other history node/ }));
    expect(await screen.findByText('Other history page')).toBeInTheDocument();
    nomadBookmarks.set([]);
    await fireEvent.click(screen.getByRole('button', { name: 'Back one page' }));

    await waitFor(() => expect(queryLinkStatus).toHaveBeenCalledWith(identifiedHash));
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Share identity with this page',
    })).toBeEnabled());
  });

  it('establishes and identifies a missing NomadNet link before reloading the page', async () => {
    const destinationHash = '6'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Anonymous page',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Identified replacement link',
        receivedAt: '2026-07-16T10:02:00.000Z',
      });
    const establish = vi.spyOn(reticulumRuntime, 'establishNomadLink').mockResolvedValue(true);
    const identify = vi.spyOn(reticulumRuntime, 'identifyNomadLink')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('Anonymous page')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Share identity with this page' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Share identity' }));

    expect(establish).toHaveBeenCalledWith(destinationHash);
    expect(identify).toHaveBeenNthCalledWith(1, destinationHash);
    await waitFor(() => expect(identify).toHaveBeenNthCalledWith(2, destinationHash));
    expect(await screen.findByText('Identified replacement link')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(
      2,
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
      false,
      true,
    );
  });

  it('restores cached history when navigating back and returns to the announced home page', async () => {
    useMobileViewport();
    const destinationHash = '8'.repeat(32);
    setNomadDestinations([{
      id: destinationHash,
      destinationHash,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage')
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Home page\n`[Open details`:/page/details.mu]',
        receivedAt: '2026-07-16T10:01:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/details.mu',
        requestData: {},
        content: '> Details page',
        receivedAt: '2026-07-16T10:02:00.000Z',
      })
      .mockResolvedValueOnce({
        destinationHash,
        path: '/page/index.mu',
        requestData: {},
        content: '> Home page again',
        receivedAt: '2026-07-16T10:03:00.000Z',
      });
    render(NomadNetView);

    const back = screen.getByRole('button', { name: 'Back one page' });
    const home = screen.getByRole('button', { name: 'Open announced home page' });
    expect(back).toBeDisabled();
    expect(home).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(back).toBeDisabled();
    expect(home).toBeDisabled();

    vi.mocked(window.scrollTo).mockClear();
    await fireEvent.click(screen.getByRole('link', { name: 'Open details' }));
    expect(await screen.findByText('Details page')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(back).toBeEnabled();
    expect(home).toBeEnabled();

    vi.mocked(window.scrollTo).mockClear();
    await fireEvent.click(home);
    expect(await screen.findByText('Home page again')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(requestPage).toHaveBeenNthCalledWith(3, destinationHash, '/page/index.mu', {}, expect.any(Function));
    expect(home).toBeDisabled();

    vi.mocked(window.scrollTo).mockClear();
    await fireEvent.click(back);
    expect(screen.getByText('Details page')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(requestPage).toHaveBeenCalledTimes(3);
  });
});
