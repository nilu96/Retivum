import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PageScrollToTop from './PageScrollToTop.svelte';

afterEach(cleanup);

describe('PageScrollToTop', () => {
  it('appears after scrolling and smoothly returns the page container to the top', async () => {
    const main = document.createElement('main');
    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      if (typeof options?.top === 'number') main.scrollTop = options.top;
    });
    Object.defineProperty(main, 'scrollTo', { configurable: true, value: scrollTo });
    document.body.append(main);
    render(PageScrollToTop, { target: main });

    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();
    main.scrollTop = 120;
    await fireEvent.scroll(main);
    const button = await screen.findByRole('button', { name: 'Scroll to top' });
    expect(button).toHaveClass('message-scroll-latest', 'page-scroll-top');
    await fireEvent.click(button);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();
  });
});
