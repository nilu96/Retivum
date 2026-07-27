import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationLayer } from '../../app/router';
import { defaultAppPreferences } from '../../domain/settings';
import {
  emitAutomaticPropagationSyncComplete,
  emitIncomingChatMessage,
  markChatMessagesRead,
  noteUnreadChatMessage,
} from '../../infrastructure/reticulum/chat-state';
import {
  appPreferences,
  chatContacts,
  knownDestinations,
  reticulumRuntime,
  runtimeStatus,
} from '../../infrastructure/reticulum/runtime';
import { clearToasts, toasts } from '../notifications/toasts';
import AppShell from './AppShell.svelte';

const emptyChildren = createRawSnippet(() => ({ render: () => '<div>Content</div>' }));
const selectedConversationChildren = createRawSnippet(() => ({
  render: () => '<div class="chat-workspace conversation-selected"></div>',
}));

describe('AppShell Chat unread indicator', () => {
  beforeEach(() => {
    markChatMessagesRead();
    runtimeStatus.set('offline');
    appPreferences.set(structuredClone(defaultAppPreferences));
    chatContacts.set([]);
    knownDestinations.set([]);
    navigationLayer.set(undefined);
    clearToasts();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the unread count in desktop and mobile navigation', () => {
    noteUnreadChatMessage('alice', 'alice-1');
    noteUnreadChatMessage('bob', 'bob-1');
    render(AppShell, { current: 'nomadnet', children: emptyChildren });

    expect(screen.getAllByRole('button', { name: 'Chat, 2 new messages' })).toHaveLength(2);
    expect(screen.getAllByText('2')).toHaveLength(2);
  });

  it('keeps provisioning grouped under Tools in desktop and mobile navigation', () => {
    render(AppShell, { current: 'provisioning', children: emptyChildren });

    const toolsButtons = screen.getAllByRole('button', { name: 'Tools' });
    const settingsButtons = screen.getAllByRole('button', { name: 'Settings' });
    expect(toolsButtons).toHaveLength(2);
    expect(toolsButtons.every((button) => button.classList.contains('active'))).toBe(true);
    expect(settingsButtons.every((button) => !button.classList.contains('active'))).toBe(true);
  });

  it('keeps Reticulum logs grouped under Tools in desktop and mobile navigation', () => {
    render(AppShell, { current: 'logs', children: emptyChildren });

    const toolsButtons = screen.getAllByRole('button', { name: 'Tools' });
    const settingsButtons = screen.getAllByRole('button', { name: 'Settings' });
    expect(toolsButtons.every((button) => button.classList.contains('active'))).toBe(true);
    expect(settingsButtons.every((button) => !button.classList.contains('active'))).toBe(true);
  });

  it('resets desktop and mobile scroll positions when the route changes', async () => {
    const { rerender } = render(AppShell, { current: 'tools', children: emptyChildren });
    const main = document.getElementById('main-content') as HTMLElement;
    main.scrollTop = 240;
    main.scrollLeft = 20;
    document.documentElement.scrollTop = 240;
    document.documentElement.scrollLeft = 20;
    document.body.scrollTop = 240;
    document.body.scrollLeft = 20;

    await rerender({ current: 'path-management', children: emptyChildren });

    await waitFor(() => {
      expect(main.scrollTop).toBe(0);
      expect(main.scrollLeft).toBe(0);
      expect(document.documentElement.scrollTop).toBe(0);
      expect(document.documentElement.scrollLeft).toBe(0);
      expect(document.body.scrollTop).toBe(0);
      expect(document.body.scrollLeft).toBe(0);
    });
  });

  it('shows the live network state beside the mobile announce action', async () => {
    render(AppShell, { current: 'chat', children: emptyChildren });

    expect(screen.getByRole('button', { name: 'Show identity actions, Offline' })).toBeInTheDocument();
    runtimeStatus.set('online');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show identity actions, Online' })).toBeInTheDocument();
    });
  });

  it('expands the mobile actions horizontally from the status control', async () => {
    runtimeStatus.set('online');
    render(AppShell, { current: 'chat', children: emptyChildren });

    expect(document.querySelector('.mobile-identity-actions [aria-label="Announce"]')).not.toBeInTheDocument();
    const status = screen.getByRole('button', { name: 'Show identity actions, Online' });
    expect(status).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(status);

    expect(screen.getAllByRole('button', { name: 'Announce' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open interface settings, Online' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses expanded mobile actions when the user taps outside them', async () => {
    runtimeStatus.set('online');
    render(AppShell, { current: 'chat', children: emptyChildren });

    await fireEvent.click(screen.getByRole('button', { name: 'Show identity actions, Online' }));
    expect(screen.getAllByRole('button', { name: 'Announce' })).toHaveLength(2);

    await fireEvent.pointerDown(screen.getByText('Content'));

    expect(screen.getAllByRole('button', { name: 'Announce' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Show identity actions, Online' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('collapses expanded mobile actions after using an action', async () => {
    runtimeStatus.set('online');
    vi.spyOn(reticulumRuntime, 'announceLxmf').mockResolvedValue(true);
    render(AppShell, { current: 'chat', children: emptyChildren });

    await fireEvent.click(screen.getByRole('button', { name: 'Show identity actions, Online' }));
    await fireEvent.click(screen.getAllByRole('button', { name: 'Announce' })[1]);

    expect(document.querySelector('.mobile-identity-actions [aria-label="Announce"]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show identity actions, Online' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('reverses the mobile action order when positioned on the left', async () => {
    runtimeStatus.set('online');
    render(AppShell, { current: 'chat', children: emptyChildren });

    const status = screen.getByRole('button', { name: 'Show identity actions, Online' });
    await fireEvent.keyDown(status, { key: 'ArrowLeft' });
    await fireEvent.click(screen.getByRole('button', { name: 'Show identity actions, Online' }));

    const tray = document.querySelector<HTMLElement>('.mobile-identity-actions');
    expect(tray).toHaveAttribute('data-side', 'left');
    expect(tray).toHaveClass('side-left', 'expanded');
    expect(document.querySelector('.app-shell')).toHaveClass('mobile-actions-left');
    expect(document.querySelector('.app-shell')).not.toHaveClass('mobile-actions-right');
    expect(Array.from(tray?.querySelectorAll('button') ?? []).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open interface settings, Online',
      'Show LXMF address and QR code',
      'Announce',
    ]);
  });

  it('follows a long-press drag and animates to the side under the released finger', async () => {
    vi.useFakeTimers();
    runtimeStatus.set('online');
    render(AppShell, { current: 'chat', children: emptyChildren });

    const status = screen.getByRole('button', { name: 'Show identity actions, Online' });
    vi.spyOn(status, 'getBoundingClientRect').mockReturnValue({
      x: 960,
      y: 10,
      left: 960,
      top: 10,
      right: 998,
      bottom: 48,
      width: 38,
      height: 38,
      toJSON: () => ({}),
    });

    await fireEvent.pointerDown(status, {
      pointerType: 'touch',
      pointerId: 7,
      button: 0,
      clientX: 980,
      clientY: 30,
    });
    await vi.advanceTimersByTimeAsync(150);

    const tray = document.querySelector<HTMLElement>('.mobile-identity-actions');
    expect(tray).toHaveClass('dragging');
    expect(tray).toHaveAttribute('data-dragging', 'true');
    expect(status).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.pointerMove(status, {
      pointerType: 'touch',
      pointerId: 7,
      clientX: 120,
      clientY: 260,
    });
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-left')).toBe('95px');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-top')).toBe('235px');

    await fireEvent.pointerUp(status, {
      pointerType: 'touch',
      pointerId: 7,
      clientX: 120,
      clientY: 260,
    });
    expect(tray).toHaveClass('side-left', 'snapping');
    expect(tray).not.toHaveClass('dragging');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-left')).toContain('safe-area-inset-left');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-top')).toContain('100dvh');

    const snappedStatus = screen.getByRole('button', { name: 'Show identity actions, Online' });
    await fireEvent.click(snappedStatus);
    expect(snappedStatus).toHaveAttribute('aria-expanded', 'false');

    await vi.advanceTimersByTimeAsync(260);
    expect(tray).not.toHaveClass('snapping');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-left')).toBe('');
    expect(screen.getByText('Identity actions moved to the bottom left.')).toBeInTheDocument();
  });

  it('keeps a drag pending when the finger leaves the status control before the long-press interval', async () => {
    vi.useFakeTimers();
    runtimeStatus.set('online');
    render(AppShell, { current: 'chat', children: emptyChildren });

    const status = screen.getByRole('button', { name: 'Show identity actions, Online' });
    vi.spyOn(status, 'getBoundingClientRect').mockReturnValue({
      x: 960,
      y: 10,
      left: 960,
      top: 10,
      right: 998,
      bottom: 48,
      width: 38,
      height: 38,
      toJSON: () => ({}),
    });

    await fireEvent.pointerDown(status, {
      pointerType: 'touch',
      pointerId: 9,
      button: 0,
      clientX: 980,
      clientY: 30,
    });
    await fireEvent.pointerMove(status, {
      pointerType: 'touch',
      pointerId: 9,
      clientX: 300,
      clientY: 240,
    });

    const tray = document.querySelector<HTMLElement>('.mobile-identity-actions');
    expect(tray).toHaveClass('drag-armed');
    expect(tray).not.toHaveClass('dragging');

    await vi.advanceTimersByTimeAsync(150);

    expect(tray).toHaveClass('dragging');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-left')).toBe('275px');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-top')).toBe('215px');

    await fireEvent.pointerMove(status, {
      pointerType: 'touch',
      pointerId: 9,
      clientX: 120,
      clientY: 260,
    });
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-left')).toBe('95px');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-top')).toBe('235px');

    await fireEvent.pointerUp(status, {
      pointerType: 'touch',
      pointerId: 9,
      clientX: 120,
      clientY: 260,
    });
    expect(tray).toHaveClass('side-left', 'snapping');
  });

  it('snaps back to the top inside a conversation regardless of scrollability', async () => {
    vi.useFakeTimers();
    render(AppShell, { current: 'chat', children: selectedConversationChildren });

    const status = screen.getByRole('button', { name: 'Show identity actions, Offline' });
    vi.spyOn(status, 'getBoundingClientRect').mockReturnValue({
      x: 360,
      y: 72,
      left: 360,
      top: 72,
      right: 398,
      bottom: 110,
      width: 38,
      height: 38,
      toJSON: () => ({}),
    });
    await fireEvent.pointerDown(status, {
      pointerType: 'touch',
      pointerId: 8,
      button: 0,
      clientX: 380,
      clientY: 92,
    });
    await vi.advanceTimersByTimeAsync(150);
    await fireEvent.pointerMove(status, {
      pointerType: 'touch',
      pointerId: 8,
      clientX: 100,
      clientY: 300,
    });
    await fireEvent.pointerUp(status, {
      pointerType: 'touch',
      pointerId: 8,
      clientX: 100,
      clientY: 300,
    });

    const tray = document.querySelector<HTMLElement>('.mobile-identity-actions');
    expect(tray).toHaveClass('side-left', 'snapping');
    expect(tray?.style.getPropertyValue('--mobile-actions-drag-top')).toBe(
      'calc(env(safe-area-inset-top, 0px) + 77px)',
    );
  });

  it('keeps the mobile side in memory only for the mounted app shell', async () => {
    const first = render(AppShell, { current: 'chat', children: emptyChildren });
    const status = screen.getByRole('button', { name: 'Show identity actions, Offline' });
    await fireEvent.keyDown(status, { key: 'ArrowLeft' });
    expect(document.querySelector('.mobile-identity-actions')).toHaveAttribute('data-side', 'left');

    first.unmount();
    render(AppShell, { current: 'chat', children: emptyChildren });

    expect(document.querySelector('.mobile-identity-actions')).toHaveAttribute('data-side', 'right');
    expect(document.querySelector('.app-shell')).toHaveClass('mobile-actions-right');
  });

  it('fades successful manual announce feedback for the Announced label duration', async () => {
    runtimeStatus.set('online');
    vi.spyOn(reticulumRuntime, 'announceLxmf').mockResolvedValue(true);
    render(AppShell, { current: 'chat', children: emptyChildren });

    await fireEvent.click(screen.getByRole('button', { name: 'Show identity actions, Online' }));

    await fireEvent.click(screen.getAllByRole('button', { name: 'Announce' })[0]);

    expect(await screen.findByText('Announced')).toBeInTheDocument();
    expect(document.querySelectorAll('.announce-feedback-success')).toHaveLength(2);
    expect(document.querySelector('.app-shell')).toHaveStyle('--announce-feedback-duration: 3000ms');
  });

  it('keeps the navigation count until a conversation is marked read', async () => {
    noteUnreadChatMessage('alice', 'alice-1');
    render(AppShell, { current: 'chat', children: emptyChildren });

    expect(screen.getAllByRole('button', { name: 'Chat, 1 new message' })).toHaveLength(2);
    markChatMessagesRead('alice');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Chat' })).toHaveLength(2);
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });
  });

  it('shows a foreground notification for a new message outside the open conversation', () => {
    const destinationHash = 'a'.repeat(32);
    knownDestinations.set([{
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      displayName: 'Announced Alice',
    }]);
    render(AppShell, { current: 'tools', children: emptyChildren });

    emitIncomingChatMessage(incomingMessage(destinationHash, 'all-destinations'));

    expect(get(toasts).at(-1)).toMatchObject({
      kind: 'info',
      messageKey: 'chat.notification.messageReceived',
      parameters: { name: 'Announced Alice' },
      onactivate: expect.any(Function),
    });
  });

  it('suppresses individual foreground notifications for propagation-sync messages', () => {
    const destinationHash = 'b'.repeat(32);
    render(AppShell, { current: 'tools', children: emptyChildren });

    emitIncomingChatMessage(incomingMessage(destinationHash, 'propagated', 'propagated'));
    expect(get(toasts)).toEqual([]);

    emitIncomingChatMessage(incomingMessage(destinationHash, 'direct', 'direct'));
    expect(get(toasts).at(-1)).toMatchObject({
      messageKey: 'chat.notification.messageReceived',
    });
  });

  it('shows one aggregate toast only when an automatic propagation sync adds messages', () => {
    render(AppShell, { current: 'tools', children: emptyChildren });

    emitAutomaticPropagationSyncComplete({ received: 2, duplicates: 2 });
    expect(get(toasts)).toEqual([]);

    emitAutomaticPropagationSyncComplete({ received: 5, duplicates: 2 });
    expect(get(toasts)).toHaveLength(1);
    expect(get(toasts)[0]).toMatchObject({
      kind: 'success',
      messageKey: 'chat.propagationSync.complete.many',
      parameters: { count: 3 },
    });
  });

  it('limits foreground notifications to contacts when configured', () => {
    const contactHash = 'b'.repeat(32);
    const unknownHash = 'c'.repeat(32);
    const preferences = structuredClone(defaultAppPreferences);
    preferences.chat.inAppNotificationMode = 'contacts';
    appPreferences.set(preferences);
    chatContacts.set([{
      id: `identity:${contactHash}`,
      identityId: 'identity',
      destinationHash: contactHash,
      name: 'Local Bob',
      createdAt: '2026-07-26T10:00:00.000Z',
      updatedAt: '2026-07-26T10:00:00.000Z',
    }]);
    render(AppShell, { current: 'settings', children: emptyChildren });

    emitIncomingChatMessage(incomingMessage(unknownHash, 'unknown'));
    expect(get(toasts)).toEqual([]);

    emitIncomingChatMessage(incomingMessage(contactHash, 'contact'));
    expect(get(toasts).at(-1)).toMatchObject({
      messageKey: 'chat.notification.messageReceived',
      parameters: { name: 'Local Bob' },
    });
  });

  it('suppresses notifications for the open conversation, disabled mode, and background app', () => {
    const destinationHash = 'd'.repeat(32);
    navigationLayer.set({ kind: 'chatConversation', destinationHash });
    const rendered = render(AppShell, { current: 'chat', children: emptyChildren });

    emitIncomingChatMessage(incomingMessage(destinationHash, 'open'));
    expect(get(toasts)).toEqual([]);

    const preferences = structuredClone(defaultAppPreferences);
    preferences.chat.inAppNotificationMode = 'never';
    appPreferences.set(preferences);
    emitIncomingChatMessage(incomingMessage('e'.repeat(32), 'disabled'));
    expect(get(toasts)).toEqual([]);

    preferences.chat.inAppNotificationMode = 'all';
    appPreferences.set(preferences);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    emitIncomingChatMessage(incomingMessage('f'.repeat(32), 'background'));
    expect(get(toasts)).toEqual([]);

    rendered.unmount();
  });
});

function incomingMessage(sourceHash: string, messageId: string, method?: string) {
  return {
    id: `identity:${messageId}`,
    identityId: 'identity',
    messageId,
    sourceHash,
    destinationHash: '0'.repeat(32),
    title: '',
    content: 'Hello',
    direction: 'incoming' as const,
    status: 'delivered' as const,
    ...(method ? { method } : {}),
    receivedAt: '2026-07-26T10:00:00.000Z',
  };
}
