import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NomadPage, NomadPageLoadUpdate } from '../../domain/nomadnet';
import {
  activeIdentity,
  destinationPathStatuses,
  nomadAnnounces,
  nomadBookmarks,
  reticulumRuntime,
} from '../../infrastructure/reticulum/runtime';
import NomadNetView from './NomadNetView.svelte';

describe('NomadNetView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    activeIdentity.set(undefined);
    nomadAnnounces.set([]);
    nomadBookmarks.set([]);
    destinationPathStatuses.set({});
  });

  it('switches between announced and bookmarked destinations', async () => {
    render(NomadNetView);

    expect(screen.getByRole('heading', { name: 'No NomadNet destinations announced' })).toBeInTheDocument();
    const directoryToggle = screen.getByRole('button', { name: 'Hide destination list' });
    expect(directoryToggle).toHaveAttribute('aria-expanded', 'true');
    await fireEvent.click(directoryToggle);
    expect(screen.getByRole('button', { name: 'Show announced destinations (0)' })).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    expect(screen.getByRole('heading', { name: 'No bookmarks yet' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search bookmarks')).toBeInTheDocument();
  });

  it('collapses the mobile directory immediately after choosing an announce or bookmark', async () => {
    const announcedHash = '1'.repeat(32);
    const bookmarkedHash = '2'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${announcedHash}`,
      identityId: 'identity',
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

    const announcedPage = screen.getByRole('button', { name: /Announced node/ });
    await fireEvent.click(announcedPage);
    expect(announcedPage).toHaveClass('active');
    expect(announcedPage).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Show announced destinations (1)' })).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(screen.getByRole('button', { name: 'Show announced destinations (1)' }));
    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    const bookmarkedPage = screen.getByRole('button', { name: /Saved node/ });
    await fireEvent.click(bookmarkedPage);
    expect(bookmarkedPage.closest('.nomad-bookmark-row')).toHaveClass('active');
    expect(bookmarkedPage).toHaveAttribute('aria-current', 'page');
    expect(bookmarkedPage).toHaveTextContent('/page/stack.mu`c=heap');
    expect(requestPage).toHaveBeenLastCalledWith(
      bookmarkedHash,
      '/page/stack.mu',
      { var_c: 'heap' },
      expect.any(Function),
      false,
      true,
    );
    expect(screen.getByRole('button', { name: 'Show bookmarks (1)' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('uses the exact bookmark identification policy when opening an announced page', async () => {
    const destinationHash = '3'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
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
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const requestPage = vi.spyOn(reticulumRuntime, 'requestNomadPage').mockImplementation(() => new Promise(() => {}));
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('button', { name: /Identified node/ }));

    expect(requestPage).toHaveBeenCalledWith(
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
      false,
      true,
    );
  });

  it('keeps an announced destination active on its subpages while bookmarks remain path-specific', async () => {
    const destinationHash = '4'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
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

    expect(screen.getByRole('button', { name: /Subpage node/ })).toHaveAttribute('aria-current', 'page');
    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    expect(screen.getByRole('button', { name: /Home bookmark/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /Details bookmark/ })).toHaveAttribute('aria-current', 'page');
  });

  it('asks for a name when bookmarking the current address', async () => {
    const destinationHash = 'a'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      displayName: 'Forest Node',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    destinationPathStatuses.set({
      [destinationHash]: { destinationHash, hasPath: true, hops: 1 },
    });
    const addBookmark = vi.spyOn(reticulumRuntime, 'addNomadBookmark').mockResolvedValue(true);
    render(NomadNetView);

    await fireEvent.input(screen.getByPlaceholderText('destination:/page/path'), {
      target: { value: `${destinationHash}:/start\`c=heap` },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Bookmark current address' }));
    const bookmarkName = screen.getByRole('textbox', { name: 'Bookmark name' });
    expect(bookmarkName).toHaveValue('Forest Node');
    await fireEvent.input(bookmarkName, {
      target: { value: '  Community node  ' },
    });
    await fireEvent.click(screen.getByRole('switch', { name: /Identify before loading/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addBookmark).toHaveBeenCalledWith(
      `${destinationHash}:/start\`c=heap`,
      'Community node',
      true,
    ));
    expect(screen.getByRole('tab', { name: 'Announced' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'false');
  });

  it('copies an announced destination hash and offers to add it as a bookmark', async () => {
    const destinationHash = 'b'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'c'.repeat(32),
      publicKeyHex: 'd'.repeat(128),
    });
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
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

  it('renames an existing bookmark', async () => {
    const destinationHash = 'd'.repeat(32);
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
    expect(screen.getByRole('switch', { name: /Identify before loading/ })).not.toBeChecked();
    await fireEvent.input(input, { target: { value: 'New name' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateBookmark).toHaveBeenCalledWith('identity:bookmark', 'New name', false));
  });

  it('disables the bookmark action when the selected destination is already bookmarked', async () => {
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
    render(NomadNetView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    await fireEvent.click(screen.getByRole('button', { name: /Existing bookmark/ }));

    expect(screen.getByRole('button', { name: 'Already bookmarked' })).toBeDisabled();
  });

  it('loads announced pages and follows same-destination Micron links', async () => {
    const destinationHash = 'f'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      publicKey: 'd'.repeat(128),
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
    expect(screen.getByRole('button', { name: 'Show announced destinations (1)' })).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(screen.getByRole('link', { name: 'Next' }));
    expect(await screen.findByText('Next page')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(2, destinationHash, '/page/next.mu', { var_c: 'heap' }, expect.any(Function));
  });

  it('shows detailed loading stages, transfer progress, and the final error', async () => {
    const destinationHash = '5'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      publicKey: 'd'.repeat(128),
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
    nomadAnnounces.set([{
      id: `identity:${previousHash}`,
      identityId: 'identity',
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
    nomadAnnounces.set([{
      id: `identity:${previousHash}`,
      identityId: 'identity',
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
    nomadAnnounces.set([{
      id: `identity:${firstHash}`,
      identityId: 'identity',
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
    const destinationHash = '9'.repeat(32);
    activeIdentity.set({
      id: 'identity',
      displayName: 'Anonymous',
      identityHashHex: 'b'.repeat(32),
      publicKeyHex: 'c'.repeat(128),
    });
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      publicKey: 'd'.repeat(128),
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

    await fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(await screen.findByText('Reloaded version')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(2, destinationHash, '/page/index.mu', {}, expect.any(Function), true);
  });

  it('replaces an in-progress load with an atomic hard reload', async () => {
    const destinationHash = '6'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      publicKey: 'd'.repeat(128),
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
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      publicKey: 'd'.repeat(128),
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

  it('allows Home to cancel loading and restore an already cached home page', async () => {
    const destinationHash = '3'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      publicKey: 'd'.repeat(128),
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
    expect(home).toBeEnabled();

    await fireEvent.click(home);
    expect(cancelPage).toHaveBeenCalledWith(destinationHash);
    expect(screen.getByText('Cached home page')).toBeInTheDocument();
    expect(screen.queryByText('Loading NomadNet page')).not.toBeInTheDocument();
    expect(home).toBeDisabled();
    expect(requestPage).toHaveBeenCalledTimes(2);
    finishSlowPage?.(undefined);
  });

  it('shares the active identity over the NomadNet link and reloads the page', async () => {
    const destinationHash = '7'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      publicKey: 'd'.repeat(128),
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
      });
    const identify = vi.spyOn(reticulumRuntime, 'identifyNomadLink').mockResolvedValue(true);
    const cancelPage = vi.spyOn(reticulumRuntime, 'cancelNomadPage');
    render(NomadNetView);

    const share = screen.getByRole('button', { name: 'Share identity with this page' });
    expect(share).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(destinationHash) }));
    expect(await screen.findByText('Anonymous page')).toBeInTheDocument();
    expect(share).toBeEnabled();

    await fireEvent.click(share);
    expect(identify).toHaveBeenCalledWith(destinationHash);
    expect(await screen.findByText('Identified page')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(
      2,
      destinationHash,
      '/page/index.mu',
      {},
      expect.any(Function),
    );
    expect(cancelPage).not.toHaveBeenCalled();
  });

  it('restores cached history when navigating back and returns to the announced home page', async () => {
    const destinationHash = '8'.repeat(32);
    nomadAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
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

    await fireEvent.click(screen.getByRole('link', { name: 'Open details' }));
    expect(await screen.findByText('Details page')).toBeInTheDocument();
    expect(back).toBeEnabled();
    expect(home).toBeEnabled();

    await fireEvent.click(home);
    expect(await screen.findByText('Home page again')).toBeInTheDocument();
    expect(requestPage).toHaveBeenNthCalledWith(3, destinationHash, '/page/index.mu', {}, expect.any(Function));
    expect(home).toBeDisabled();

    await fireEvent.click(back);
    expect(screen.getByText('Details page')).toBeInTheDocument();
    expect(requestPage).toHaveBeenCalledTimes(3);
  });
});
