import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, liveActivity, toast } from '../notifications/toasts';
import ToastViewport from './ToastViewport.svelte';

describe('ToastViewport', () => {
  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

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

  it('can finish a live activity as informational feedback', async () => {
    render(ToastViewport);

    const activity = liveActivity.start('chat.attachment.imageDownscale.running', { name: 'photo.jpg' });
    activity.info('chat.attachment.imageDownscale.originalKept', {
      name: 'photo.jpg',
      originalSize: '2.0 MB',
      resultSize: '2.2 MB',
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveClass('info');
    expect(status).toHaveTextContent('The downscaled “photo.jpg” was 2.2 MB');
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

  it('dismisses a transient toast after an upward flick', async () => {
    vi.useFakeTimers();
    toast.success('chat.propagationSync.complete.many', { count: 2 });
    render(ToastViewport);

    const status = screen.getByRole('status');
    await fireEvent.pointerDown(status, {
      pointerType: 'touch',
      pointerId: 4,
      button: 0,
      clientY: 120,
    });
    await fireEvent.pointerMove(status, {
      pointerType: 'touch',
      pointerId: 4,
      clientY: 60,
    });
    expect(status).toHaveClass('flick-dragging');
    await vi.advanceTimersByTimeAsync(16);
    expect(status.style.getPropertyValue('--toast-flick-offset')).toBe('-60px');
    expect(status.style.getPropertyValue('--toast-flick-opacity')).toBe('');

    await fireEvent.pointerUp(status, {
      pointerType: 'touch',
      pointerId: 4,
      clientY: 60,
    });
    expect(status).toHaveClass('flick-dismissing');
    expect(status.style.getPropertyValue('--toast-flick-offset')).toBe('-60px');

    await vi.advanceTimersByTimeAsync(180);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses the same exit animation when a transient toast expires automatically', async () => {
    vi.useFakeTimers();
    toast.success('chat.propagationSync.complete.many', { count: 2 }, 100);
    render(ToastViewport);

    const status = screen.getByRole('status');
    await vi.advanceTimersByTimeAsync(100);

    expect(status).toHaveClass('flick-dismissing');
    expect(status).toBeInTheDocument();
    expect(status.style.getPropertyValue('--toast-flick-dismiss-offset')).not.toBe('');

    await vi.advanceTimersByTimeAsync(180);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses the regular exit animation for the oldest toast when the visible limit is reached', async () => {
    vi.useFakeTimers();
    render(ToastViewport);

    for (let count = 1; count <= 4; count += 1) {
      toast.success('chat.propagationSync.complete.many', { count });
    }
    const oldest = (await screen.findByText('Sync complete. 1 new messages.')).closest('article');

    toast.success('chat.propagationSync.complete.many', { count: 5 });
    await screen.findByText('Sync complete. 5 new messages.');

    expect(oldest).toHaveClass('flick-dismissing');
    expect(oldest).toBeInTheDocument();
    expect(oldest?.style.getPropertyValue('--toast-flick-dismiss-offset')).not.toBe('');
    expect(screen.getAllByRole('status')).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(180);
    expect(screen.queryByText('Sync complete. 1 new messages.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(4);
  });

  it('returns a transient toast after an upward drag below the dismissal threshold', async () => {
    vi.useFakeTimers();
    toast.info('chat.attachment.imageDownscale.originalKept', {
      name: 'photo.jpg',
      originalSize: '2.0 MB',
      resultSize: '2.2 MB',
    });
    render(ToastViewport);

    const status = screen.getByRole('status');
    await fireEvent.pointerDown(status, {
      pointerType: 'touch',
      pointerId: 5,
      button: 0,
      clientY: 100,
    });
    await fireEvent.pointerMove(status, {
      pointerType: 'touch',
      pointerId: 5,
      clientY: 76,
    });
    await fireEvent.pointerUp(status, {
      pointerType: 'touch',
      pointerId: 5,
      clientY: 76,
    });

    expect(status).toHaveClass('flick-returning');
    await vi.advanceTimersByTimeAsync(160);
    expect(status).not.toHaveClass('flick-returning');
    expect(status).toBeInTheDocument();
  });

  it('removes a confirmed flick from the toast layout before its exit animation finishes', async () => {
    vi.useFakeTimers();
    toast.success('chat.propagationSync.complete.many', { count: 2 });
    toast.info('chat.attachment.imageDownscale.originalKept', {
      name: 'photo.jpg',
      originalSize: '2.0 MB',
      resultSize: '2.2 MB',
    });
    render(ToastViewport);

    const [dismissed, remaining] = screen.getAllByRole('status');
    vi.spyOn(dismissed, 'getBoundingClientRect').mockImplementation(() => {
      const offset = Number.parseFloat(dismissed.style.getPropertyValue('--toast-flick-offset')) || 0;
      return {
        x: 18,
        y: 18 + offset,
        left: 18,
        top: 18 + offset,
        right: 408,
        bottom: 76 + offset,
        width: 390,
        height: 58,
        toJSON: () => ({}),
      };
    });
    vi.spyOn(remaining, 'getBoundingClientRect').mockImplementation(() => {
      const top = dismissed.classList.contains('flick-dismissing') ? 18 : 86;
      return {
        x: 18,
        y: top,
        left: 18,
        top,
        right: 408,
        bottom: top + 58,
        width: 390,
        height: 58,
        toJSON: () => ({}),
      };
    });
    await fireEvent.pointerDown(dismissed, {
      pointerType: 'touch',
      pointerId: 7,
      button: 0,
      clientY: 120,
    });
    await fireEvent.pointerMove(dismissed, {
      pointerType: 'touch',
      pointerId: 7,
      clientY: 60,
    });
    await vi.advanceTimersByTimeAsync(16);
    await fireEvent.pointerUp(dismissed, {
      pointerType: 'touch',
      pointerId: 7,
      clientY: 60,
    });

    expect(dismissed).toHaveClass('flick-dismissing');
    expect(dismissed.style.getPropertyValue('--toast-flick-dismiss-top')).toBe('18px');
    expect(dismissed.style.getPropertyValue('--toast-flick-dismiss-offset')).toBe('-108px');
    expect(remaining).toBeInTheDocument();
    expect(remaining).toHaveClass('toast-reflow-preparing');
    expect(remaining.style.getPropertyValue('--toast-reflow-offset')).toBe('68px');

    await vi.advanceTimersByTimeAsync(16);
    expect(remaining).toHaveClass('toast-reflowing');
    expect(remaining.style.getPropertyValue('--toast-reflow-offset')).toBe('0px');

    await vi.advanceTimersByTimeAsync(140);
    expect(remaining).not.toHaveClass('toast-reflowing');
    expect(remaining.style.getPropertyValue('--toast-reflow-offset')).toBe('');
  });

  it('does not allow a persistent live activity to be flicked away', async () => {
    liveActivity.start('probe.activity.pending', { destination: '1234…abcd' });
    render(ToastViewport);

    const activity = screen.getByRole('status');
    await fireEvent.pointerDown(activity, {
      pointerType: 'touch',
      pointerId: 6,
      button: 0,
      clientY: 120,
    });
    await fireEvent.pointerMove(activity, {
      pointerType: 'touch',
      pointerId: 6,
      clientY: 40,
    });
    await fireEvent.pointerUp(activity, {
      pointerType: 'touch',
      pointerId: 6,
      clientY: 40,
    });

    expect(activity).not.toHaveClass('flick-dragging', 'flick-dismissing');
    expect(activity).toBeInTheDocument();
  });
});
