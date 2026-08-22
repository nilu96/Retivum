import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDestinationHashHistory } from '../../infrastructure/reticulum/destination-hash-history';
import { clearDestinationPathRequestCooldowns } from '../../infrastructure/reticulum/path-request-operations';
import { reticulumRuntime, runtimeStatus } from '../../infrastructure/reticulum/runtime';
import DestinationHashView from './DestinationHashView.svelte';

describe('DestinationHashView', () => {
  beforeEach(() => {
    clearDestinationHashHistory();
  });

  afterEach(() => {
    clearDestinationPathRequestCooldowns();
    runtimeStatus.set('online');
    vi.restoreAllMocks();
  });

  it('offers to scroll the destination hash generator back to the top', async () => {
    const main = document.createElement('main');
    Object.defineProperty(main, 'scrollTo', { configurable: true, value: vi.fn() });
    document.body.append(main);
    render(DestinationHashView, { target: main });

    main.scrollTop = 120;
    await fireEvent.scroll(main);
    expect(await screen.findByRole('button', { name: 'Scroll to top' })).toHaveClass('page-scroll-top');
    main.remove();
  });

  it('offers only classified aspect names while allowing custom input', async () => {
    render(DestinationHashView);

    expect(screen.getByLabelText('Full aspect name')).toHaveValue('lxmf.delivery');
    await fireEvent.click(screen.getByRole('button', { name: 'Show known aspect names' }));
    const names = screen.getByRole('listbox', { name: 'Known aspect names' });
    expect(within(names).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'lxmf.delivery',
      'lxmf.propagation',
      'nomadnetwork.node',
      'rnstransport.probe',
      'rnstransport.remote.management',
    ]);

    await fireEvent.click(within(names).getByRole('option', { name: 'nomadnetwork.node' }));
    expect(screen.getByLabelText('Full aspect name')).toHaveValue('nomadnetwork.node');
    await fireEvent.input(screen.getByLabelText('Full aspect name'), {
      target: { value: 'audit.kat.field' },
    });
    expect(screen.getByLabelText('Full aspect name')).toHaveValue('audit.kat.field');
  });

  it('generates and copies the reference destination hash', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(DestinationHashView);

    await fireEvent.input(screen.getByLabelText('Identity hash'), {
      target: { value: 'fdeab9acf3710362bd2658cdc9a29e8f' },
    });
    await fireEvent.input(screen.getByLabelText('Full aspect name'), {
      target: { value: 'audit.kat.field' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate destination hash' }));

    const expectedDestination = 'f000a6e0bcdb026f6dbc6eed918fab21';
    const result = await screen.findByText(expectedDestination);
    expect(result).toBeInTheDocument();
    expect(result.closest('.settings-card')).toBeNull();
    expect(result.closest('li')?.querySelector('time')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Generation history' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request path/ })).not.toBeInTheDocument();
    const copyButton = screen.getByRole('button', { name: 'Copy destination hash' });
    expect(copyButton).toHaveClass('history-inline-action');
    expect(copyButton.parentElement).toHaveStyle({ alignItems: 'center' });
    await fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedDestination));
  });

  it('copies the identity hash and aspect name from the history context menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(DestinationHashView);

    const identityHash = 'fdeab9acf3710362bd2658cdc9a29e8f';
    const aspectName = 'audit.kat.field';
    await fireEvent.input(screen.getByLabelText('Identity hash'), {
      target: { value: identityHash },
    });
    await fireEvent.input(screen.getByLabelText('Full aspect name'), {
      target: { value: aspectName },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate destination hash' }));
    const entry = await screen.findByRole('button', { name: 'Destination hash history actions' });

    await fireEvent.contextMenu(entry, { clientX: 100, clientY: 100 });
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Copy identity hash',
      'Copy aspect name',
      'Request path to destination',
    ]);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy identity hash' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(identityHash));

    await fireEvent.contextMenu(entry, { clientX: 100, clientY: 100 });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy aspect name' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(aspectName));
  });

  it('requests a generated destination through the shared pending and cooldown operation', async () => {
    const expectedDestination = 'f000a6e0bcdb026f6dbc6eed918fab21';
    const dropPath = vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockResolvedValue(true);
    const requestPath = vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockResolvedValue({
      ok: true,
      destinationHash: expectedDestination,
      hops: 2,
    });
    runtimeStatus.set('online');
    render(DestinationHashView);

    await fireEvent.input(screen.getByLabelText('Identity hash'), {
      target: { value: 'fdeab9acf3710362bd2658cdc9a29e8f' },
    });
    await fireEvent.input(screen.getByLabelText('Full aspect name'), {
      target: { value: 'audit.kat.field' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate destination hash' }));
    const entry = await screen.findByRole('button', { name: 'Destination hash history actions' });
    await fireEvent.contextMenu(entry, { clientX: 100, clientY: 100 });
    const button = screen.getByRole('menuitem', { name: 'Request path to destination' });

    expect(button).toBeEnabled();
    await fireEvent.click(button);
    await waitFor(() => expect(requestPath).toHaveBeenCalledWith(
      expectedDestination,
      expect.any(AbortSignal),
    ));
    expect(dropPath).toHaveBeenCalledWith(expectedDestination);
    await fireEvent.contextMenu(entry, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Request path to destination' })).toBeDisabled();
  });

  it('disables path requests while the runtime is offline', async () => {
    runtimeStatus.set('offline');
    render(DestinationHashView);

    await fireEvent.input(screen.getByLabelText('Identity hash'), {
      target: { value: 'fdeab9acf3710362bd2658cdc9a29e8f' },
    });
    await fireEvent.input(screen.getByLabelText('Full aspect name'), {
      target: { value: 'audit.kat.field' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate destination hash' }));

    const entry = await screen.findByRole('button', { name: 'Destination hash history actions' });
    await fireEvent.contextMenu(entry, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Request path to destination' })).toBeDisabled();
  });

  it('shows validation errors and does not produce output for malformed values', async () => {
    render(DestinationHashView);

    await fireEvent.input(screen.getByLabelText('Identity hash'), {
      target: { value: 'not-an-identity' },
    });
    await fireEvent.input(screen.getByLabelText('Full aspect name'), {
      target: { value: 'lxmf..delivery' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate destination hash' }));

    expect(screen.getByLabelText('Identity hash')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Full aspect name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('button', { name: 'Copy destination hash' })).not.toBeInTheDocument();
  });
});
