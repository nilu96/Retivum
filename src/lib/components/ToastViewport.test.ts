import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, liveActivity, toast } from '../notifications/toasts';
import ToastViewport from './ToastViewport.svelte';

describe('ToastViewport', () => {
  afterEach(clearToasts);

  it('renders translated action feedback without changing page content', async () => {
    render(ToastViewport);

    toast.error('chat.composer.error');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The message could not be queued for delivery.');
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders parameterized success feedback as a status', async () => {
    render(ToastViewport);

    toast.success('chat.propagationSync.complete.many', { count: 3 });

    expect(await screen.findByRole('status')).toHaveTextContent('Sync complete. 3 new messages.');
  });

  it('keeps a live activity visible and non-dismissible until it finishes', async () => {
    render(ToastViewport);

    const activity = liveActivity.start('probe.activity.pending', { destination: '1234…abcd' });
    const pending = await screen.findByRole('status');
    expect(pending).toHaveTextContent('Probe sent to <1234…abcd>. Waiting for a response…');
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    activity.success('probe.activity.success', { destination: '1234…abcd', duration: '24.50 ms' });
    expect(await screen.findByRole('status')).toHaveTextContent('Probe to <1234…abcd> succeeded in 24.50 ms.');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('cancels and removes a cancellable live activity from its close button', async () => {
    const cancel = vi.fn();
    render(ToastViewport);

    liveActivity.start('probe.activity.pending', { destination: '1234…abcd' }, cancel);
    await screen.findByRole('status');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel activity' }));

    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
