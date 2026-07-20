import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MicronPage from './MicronPage.svelte';

describe('MicronPage', () => {
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
});
