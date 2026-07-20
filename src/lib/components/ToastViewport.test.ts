import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { clearToasts, toast } from '../notifications/toasts';
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
});
