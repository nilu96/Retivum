import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeNavigationLayer,
  navigate,
  navigateBack,
  navigateTopLevel,
  navigationLayer,
  openChatConversation,
  route,
  startRouter,
} from './router';

describe('app router history', () => {
  let stopRouter: (() => void) | undefined;

  beforeEach(() => {
    window.history.replaceState(null, '', '#/chat');
    stopRouter = startRouter();
  });

  afterEach(() => {
    stopRouter?.();
    stopRouter = undefined;
  });

  it('pops a tool detail route back to its logical parent', async () => {
    navigate('tools');
    navigate('probe');

    expect(get(route)).toBe('probe');
    expect(window.location.hash).toBe('#/probe');

    navigateBack('tools');

    await vi.waitFor(() => {
      expect(get(route)).toBe('tools');
      expect(window.location.hash).toBe('#/tools');
    });
  });

  it('replaces a directly loaded tool detail with its fallback parent', () => {
    stopRouter?.();
    window.history.replaceState(null, '', '#/probe');
    stopRouter = startRouter();

    navigateBack('tools');

    expect(get(route)).toBe('tools');
    expect(window.location.hash).toBe('#/tools');
  });

  it('does not retain Settings behind Chat in top-level history', async () => {
    navigate('settings');
    navigateTopLevel('chat');

    expect(get(route)).toBe('chat');
    expect(window.location.hash).toBe('#/chat');

    window.history.back();
    await vi.waitFor(() => {
      expect(get(route)).toBe('chat');
      expect(window.location.hash).toBe('#/chat');
    });
  });

  it('collapses a tool detail before switching its top-level destination', async () => {
    navigate('tools');
    navigate('probe');

    navigateTopLevel('chat');
    await vi.waitFor(() => {
      expect(get(route)).toBe('chat');
      expect(window.location.hash).toBe('#/chat');
    });

    window.history.back();
    await vi.waitFor(() => expect(get(route)).toBe('chat'));
  });

  it('represents an open chat conversation as one replaceable history layer', async () => {
    const firstDestination = 'a'.repeat(32);
    const secondDestination = 'b'.repeat(32);

    openChatConversation(firstDestination);
    openChatConversation(secondDestination);
    expect(get(navigationLayer)).toEqual({
      kind: 'chatConversation',
      destinationHash: secondDestination,
    });

    expect(closeNavigationLayer('chatConversation')).toBe(true);
    await vi.waitFor(() => expect(get(navigationLayer)).toBeUndefined());

    window.history.forward();
    await vi.waitFor(() => {
      expect(get(navigationLayer)).toEqual({
        kind: 'chatConversation',
        destinationHash: secondDestination,
      });
    });
  });
});
