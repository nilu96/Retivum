import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markChatMessagesRead, noteUnreadChatMessage } from '../../infrastructure/reticulum/chat-state';
import { reticulumRuntime, runtimeStatus } from '../../infrastructure/reticulum/runtime';
import AppShell from './AppShell.svelte';

const emptyChildren = createRawSnippet(() => ({ render: () => '<div>Content</div>' }));

describe('AppShell Chat unread indicator', () => {
  beforeEach(() => {
    markChatMessagesRead();
    runtimeStatus.set('offline');
    vi.restoreAllMocks();
  });

  it('shows the unread count in desktop and mobile navigation', () => {
    noteUnreadChatMessage('alice');
    noteUnreadChatMessage('bob');
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
    noteUnreadChatMessage('alice');
    render(AppShell, { current: 'chat', children: emptyChildren });

    expect(screen.getAllByRole('button', { name: 'Chat, 1 new message' })).toHaveLength(2);
    markChatMessagesRead('alice');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Chat' })).toHaveLength(2);
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });
  });
});
