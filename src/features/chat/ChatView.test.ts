import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRouter } from '../../app/router';
import { defaultAppPreferences } from '../../domain/settings';
import {
  chatAnnounces,
  blockedChatDestinations,
  chatContacts,
  chatDirectoryReady,
  chatMessages,
  markChatMessagesRead,
  noteUnreadChatMessage,
} from '../../infrastructure/reticulum/chat-state';
import {
  appPreferences,
  chatInboundTransfers,
  destinationPathStatuses,
  interfaceStatuses,
  propagationSyncActive,
  reticulumRuntime,
} from '../../infrastructure/reticulum/runtime';
import { clearProbeHistory, probeHistory } from '../../infrastructure/reticulum/probe-history';
import ToastViewport from '../../lib/components/ToastViewport.svelte';
import { clearToasts } from '../../lib/notifications/toasts';
import ChatView from './ChatView.svelte';

describe('ChatView', () => {
  let stopRouter: (() => void) | undefined;

  beforeEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.nativeShell;
    window.history.replaceState(null, '', '#/chat');
    stopRouter = startRouter();
    chatAnnounces.set([]);
    chatContacts.set([]);
    chatMessages.set([]);
    chatDirectoryReady.set(true);
    blockedChatDestinations.set([]);
    destinationPathStatuses.set({});
    interfaceStatuses.set({});
    chatInboundTransfers.set([]);
    appPreferences.set(structuredClone(defaultAppPreferences));
    propagationSyncActive.set(false);
    markChatMessagesRead();
    clearToasts();
    clearProbeHistory();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    stopRouter?.();
    stopRouter = undefined;
  });

  it('defaults to announces when there are no chats or contacts', async () => {
    render(ChatView);

    expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'No chat announces heard' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(screen.getByRole('heading', { name: 'No contacts saved' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search contacts')).toBeInTheDocument();
  });

  it('shows the interface hint only while every interface is disconnected', async () => {
    render(ChatView);

    expect(screen.getByText('A connected interface is required to receive announces.')).toBeInTheDocument();

    interfaceStatuses.set({ websocket: 'online' });
    await waitFor(() => {
      expect(screen.queryByText('A connected interface is required to receive announces.'))
        .not.toBeInTheDocument();
    });

    interfaceStatuses.set({ websocket: 'reconnecting' });
    await waitFor(() => {
      expect(screen.getByText('A connected interface is required to receive announces.')).toBeInTheDocument();
    });
  });

  it('defaults to contacts when there are contacts but no chats', () => {
    const destinationHash = '1'.repeat(32);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Saved contact',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);

    render(ChatView);

    expect(screen.getByRole('tab', { name: 'Contacts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Saved contact')).toBeInTheDocument();
  });

  it('keeps chats as the first default when a conversation exists', () => {
    const destinationHash = '2'.repeat(32);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Conversation contact',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    chatMessages.set([{
      id: 'identity:default-conversation',
      identityId: 'identity',
      messageId: 'default-conversation',
      sourceHash: destinationHash,
      destinationHash: '3'.repeat(32),
      title: '',
      content: 'Existing conversation',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);

    render(ChatView);

    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Existing conversation')).toBeInTheDocument();
  });

  it('selects contacts when they finish loading after the view opens', async () => {
    chatDirectoryReady.set(false);
    render(ChatView);
    expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');

    const destinationHash = '4'.repeat(32);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Loaded contact',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    chatDirectoryReady.set(true);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Contacts' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByText('Loaded contact')).toBeInTheDocument();
  });

  it('does not switch from contacts when the first chat starts while the view is open', async () => {
    const destinationHash = '5'.repeat(32);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'New chat contact',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(ChatView);
    expect(screen.getByRole('tab', { name: 'Contacts' })).toHaveAttribute('aria-selected', 'true');
    await fireEvent.click(screen.getByText('New chat contact').closest('button')!);

    chatMessages.set([{
      id: 'identity:first-chat-message',
      identityId: 'identity',
      messageId: 'first-chat-message',
      sourceHash: '6'.repeat(32),
      destinationHash,
      title: '',
      content: 'First chat message',
      direction: 'outgoing',
      status: 'sent',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);

    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('log', { name: 'Conversation messages' }))
      .not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Contacts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('New chat contact')).toBeInTheDocument();
    expect(screen.queryByText('First chat message')).not.toBeInTheDocument();
  });

  it('syncs from the preferred or best discovered propagation node independently of sending preferences', async () => {
    const sync = vi.spyOn(reticulumRuntime, 'syncLxmfPropagation').mockResolvedValue({ received: 2, duplicates: 1 });
    render(ChatView);
    render(ToastViewport);

    const syncButton = await screen.findByRole('button', { name: 'Sync messages from the preferred or best available propagation node' });
    expect(syncButton).toBeEnabled();
    await fireEvent.click(syncButton);

    expect(sync).toHaveBeenCalledOnce();
    expect(await screen.findByText('Sync complete. 2 new messages.')).toBeInTheDocument();
  });

  it('keeps showing an active propagation sync after the chat view is remounted', async () => {
    propagationSyncActive.set(true);
    const firstView = render(ChatView);

    const firstButton = await screen.findByRole('button', { name: 'Syncing messages from propagation node' });
    expect(firstButton).toBeDisabled();
    expect(firstButton).toHaveClass('syncing');

    firstView.unmount();
    render(ChatView);

    const remountedButton = await screen.findByRole('button', { name: 'Syncing messages from propagation node' });
    expect(remountedButton).toBeDisabled();
    expect(remountedButton).toHaveClass('syncing');
  });

  it('provides propagation sync beside the contact action in an open mobile conversation', async () => {
    const destinationHash = '7'.repeat(32);
    chatAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: 'b'.repeat(32),
      publicKey: 'c'.repeat(128),
      displayName: 'Mobile peer',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const sync = vi.spyOn(reticulumRuntime, 'syncLxmfPropagation').mockResolvedValue({ received: 0, duplicates: 0 });
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    await fireEvent.click(screen.getByRole('button', { name: /Mobile peer/ }));
    const mobileSync = document.querySelector<HTMLButtonElement>('.mobile-conversation-sync-button');
    expect(mobileSync).not.toBeNull();
    expect(mobileSync).toBeEnabled();
    if (mobileSync) await fireEvent.click(mobileSync);

    expect(sync).toHaveBeenCalledOnce();
  });

  it('shows heard LXMF destinations and received messages', async () => {
    const sourceHash = 'a'.repeat(32);
    chatAnnounces.set([{
      id: `identity:${sourceHash}`,
      identityId: 'identity',
      destinationHash: sourceHash,
      identityHash: 'b'.repeat(32),
      publicKey: 'c'.repeat(128),
      displayName: 'Alice',
      hops: 3,
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    chatMessages.set([{
      id: 'identity:message',
      identityId: 'identity',
      messageId: 'message',
      sourceHash,
      destinationHash: 'd'.repeat(32),
      title: 'Greeting',
      content: 'Hello from LXMF',
      verification: 'verified',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    destinationPathStatuses.set({
      [sourceHash]: { destinationHash: sourceHash, hasPath: true, hops: 3 },
    });
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(sourceHash)).toBeInTheDocument();
    expect(screen.getByLabelText('Known path: 3 hops')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('tab', { name: 'Chats' }));
    expect(screen.getByText('Hello from LXMF')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /Alice.*Hello from LXMF/ }));

    expect(screen.getByRole('log', { name: 'Conversation messages' })).toBeInTheDocument();
    expect(screen.getByText('Greeting')).toBeInTheDocument();
    expect(screen.getAllByText('Hello from LXMF')).toHaveLength(2);
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
  });

  it('colors unverified and invalid message badges by verification state', async () => {
    const sourceHash = 'f'.repeat(32);
    chatMessages.set([{
      id: 'identity:unverified-message',
      identityId: 'identity',
      messageId: 'unverified-message',
      sourceHash,
      destinationHash: 'd'.repeat(32),
      title: '',
      content: 'Unverified message',
      verification: 'unverified',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }, {
      id: 'identity:invalid-message',
      identityId: 'identity',
      messageId: 'invalid-message',
      sourceHash,
      destinationHash: 'd'.repeat(32),
      title: '',
      content: 'Invalid message',
      verification: 'invalid',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Invalid message/ }));

    expect(screen.getByText('Unverified')).toHaveClass('message-verification-badge');
    expect(screen.getByText('Unverified')).not.toHaveClass('valid', 'invalid');
    expect(screen.getByText('Invalid')).toHaveClass('message-verification-badge', 'invalid');
  });

  it('scrolls to the latest message when a conversation is opened', async () => {
    const sourceHash = '9'.repeat(32);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
    chatMessages.set([{
      id: 'identity:older-message',
      identityId: 'identity',
      messageId: 'older-message',
      sourceHash,
      destinationHash: '8'.repeat(32),
      title: '',
      content: 'Older message',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }, {
      id: 'identity:latest-message',
      identityId: 'identity',
      messageId: 'latest-message',
      sourceHash,
      destinationHash: '8'.repeat(32),
      title: '',
      content: 'Latest message',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Latest message/ }));
    const feed = screen.getByRole('log', { name: 'Conversation messages' });

    await waitFor(() => expect(feed.scrollTop).toBe(1200));
  });

  it('offers to scroll to the latest message when the open conversation is not at the bottom', async () => {
    const sourceHash = '9'.repeat(32);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    chatMessages.set([{
      id: 'identity:scroll-control-message',
      identityId: 'identity',
      messageId: 'scroll-control-message',
      sourceHash,
      destinationHash: '8'.repeat(32),
      title: '',
      content: 'Scrollable conversation',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Scrollable conversation/ }));
    const feed = screen.getByRole('log', { name: 'Conversation messages' });
    await waitFor(() => expect(feed.scrollTop).toBe(1200));
    expect(screen.queryByRole('button', { name: 'Scroll to latest message' })).not.toBeInTheDocument();

    feed.scrollTop = 100;
    await fireEvent.scroll(feed);
    const scrollButton = await screen.findByRole('button', { name: 'Scroll to latest message' });
    const composer = screen.getByRole('textbox', { name: 'Message' });
    composer.focus();
    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    scrollButton.dispatchEvent(pointerDown);
    expect(pointerDown).toHaveProperty('defaultPrevented', true);
    expect(composer).toHaveFocus();
    await fireEvent.click(scrollButton);

    await waitFor(() => expect(feed.scrollTop).toBe(1200));
    expect(screen.queryByRole('button', { name: 'Scroll to latest message' })).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
  });

  it('scrolls to a newly received message in the open conversation', async () => {
    const sourceHash = 'a'.repeat(32);
    let feedHeight = 500;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => feedHeight);
    const firstMessage = {
      id: 'identity:first-incoming',
      identityId: 'identity',
      messageId: 'first-incoming',
      sourceHash,
      destinationHash: '8'.repeat(32),
      title: '',
      content: 'First incoming',
      direction: 'incoming' as const,
      receivedAt: '2026-07-16T10:00:00.000Z',
    };
    chatMessages.set([firstMessage]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /First incoming/ }));
    const feed = screen.getByRole('log', { name: 'Conversation messages' });
    await waitFor(() => expect(feed.scrollTop).toBe(500));
    feed.scrollTop = 0;
    feedHeight = 1300;

    chatMessages.set([firstMessage, {
      ...firstMessage,
      id: 'identity:new-incoming',
      messageId: 'new-incoming',
      content: 'New incoming',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);

    await waitFor(() => expect(feed.scrollTop).toBe(1300));
  });

  it('keeps the conversation at the bottom while image attachments finish layout', async () => {
    const sourceHash = 'b'.repeat(32);
    let feedHeight = 500;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => feedHeight);
    chatMessages.set([{
      id: 'identity:image-message',
      identityId: 'identity',
      messageId: 'image-message',
      sourceHash,
      destinationHash: '8'.repeat(32),
      title: '',
      content: 'Image attached',
      attachments: [{
        kind: 'image',
        name: 'photo.png',
        mimeType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      }, {
        kind: 'image',
        name: 'second-photo.png',
        mimeType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
      }],
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Image attached/ }));
    const feed = screen.getByRole('log', { name: 'Conversation messages' });
    await waitFor(() => expect(feed.scrollTop).toBe(500));

    feedHeight = 1400;
    await fireEvent.load(screen.getByRole('img', { name: 'photo.png' }));
    await waitFor(() => expect(feed.scrollTop).toBe(1400));

    feedHeight = 1900;
    await fireEvent.load(screen.getByRole('img', { name: 'second-photo.png' }));
    await waitFor(() => expect(feed.scrollTop).toBe(1900));
  });

  it('opens image attachments in a large accessible viewer', async () => {
    const sourceHash = 'c'.repeat(32);
    chatMessages.set([{
      id: 'identity:preview-image',
      identityId: 'identity',
      messageId: 'preview-image',
      sourceHash,
      destinationHash: 'd'.repeat(32),
      title: '',
      content: 'Photo attached',
      attachments: [{
        kind: 'image',
        name: 'landscape.png',
        mimeType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      }],
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Photo attached/ }));
    const previewButton = screen.getByRole('button', { name: 'View landscape.png full size' });
    await fireEvent.click(previewButton);

    const viewer = await screen.findByRole('dialog', { name: 'Image preview: landscape.png' });
    const closeButton = viewer.querySelector<HTMLButtonElement>('.message-image-viewer-close');
    expect(viewer).toBeInTheDocument();
    expect(closeButton).not.toBeNull();
    if (closeButton) await waitFor(() => expect(closeButton).toHaveFocus());

    await fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Image preview: landscape.png' })).not.toBeInTheDocument();
    await waitFor(() => expect(previewButton).toHaveFocus());
  });

  it('shows delivery attempts and propagation-node acceptance', async () => {
    const destinationHash = '3'.repeat(32);
    const outbound = {
      id: 'identity:outbound-status',
      identityId: 'identity',
      messageId: 'outbound-status',
      sourceHash: '2'.repeat(32),
      destinationHash,
      title: '',
      content: 'Status message',
      direction: 'outgoing' as const,
      status: 'sending' as const,
      attempts: 2,
      maxAttempts: 5,
      method: 'direct',
      receivedAt: '2026-07-16T10:01:00.000Z',
    };
    chatMessages.set([outbound]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Status message/ }));
    expect(screen.getByText('Sending — attempt 2/5')).toBeInTheDocument();

    chatMessages.set([{ ...outbound, status: 'sent', method: 'propagated' }]);
    expect(await screen.findByText('Sent to propagation node')).toBeInTheDocument();
  });

  it('shows attachment upload and inbound resource progress with sizes', async () => {
    const destinationHash = '3'.repeat(32);
    chatMessages.set([{
      id: 'identity:attachment-progress',
      identityId: 'identity',
      messageId: 'attachment-progress',
      sourceHash: '2'.repeat(32),
      destinationHash,
      title: '',
      content: '',
      attachments: [{
        kind: 'file',
        name: 'payload.bin',
        mimeType: 'application/octet-stream',
        data: new Uint8Array(2048),
      }],
      direction: 'outgoing',
      status: 'sending',
      progress: 0.42,
      attempts: 1,
      maxAttempts: 3,
      method: 'direct',
      representation: 'directResource',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /payload.bin/ }));
    expect(screen.getByText('Uploading attachments')).toBeInTheDocument();
    expect(screen.getByText('42% · 2.0 KB')).toBeInTheDocument();

    chatInboundTransfers.set([{
      id: 'incoming-resource',
      destinationHash,
      progress: 0.5,
      dataSize: 4096,
      transferSize: 4352,
    }]);
    expect(await screen.findByText('Receiving LXMF message')).toBeInTheDocument();
    expect(screen.getByText('50% · 4.1 KB')).toBeInTheDocument();

    const otherDestination = '4'.repeat(32);
    chatMessages.update((items) => [...items, {
      id: 'identity:other-chat',
      identityId: 'identity',
      messageId: 'other-chat',
      sourceHash: otherDestination,
      destinationHash: '2'.repeat(32),
      title: '',
      content: 'Other conversation',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:02:00.000Z',
    }]);
    await fireEvent.click(await screen.findByRole('button', { name: /Other conversation/ }));
    await waitFor(() => {
      expect(screen.queryByText('Receiving LXMF message')).not.toBeInTheDocument();
    });
  });

  it('retries a failed outbound message from its context menu', async () => {
    const destinationHash = '4'.repeat(32);
    chatMessages.set([{
      id: 'identity:failed-message',
      identityId: 'identity',
      messageId: 'failed-message',
      sourceHash: '3'.repeat(32),
      destinationHash,
      title: '',
      content: 'Please retry this',
      direction: 'outgoing',
      status: 'failed',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const retry = vi.spyOn(reticulumRuntime, 'retryChatMessage').mockResolvedValue({ ok: true });
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Please retry this/ }));
    await fireEvent.contextMenu(screen.getByLabelText('Open actions for message: Please retry this'), {
      clientX: 100,
      clientY: 100,
    });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Retry sending' }));

    expect(retry).toHaveBeenCalledWith('failed-message');
  });

  it('copies a message title and body from its context menu', async () => {
    const destinationHash = '5'.repeat(32);
    chatMessages.set([{
      id: 'identity:copy-message',
      identityId: 'identity',
      messageId: 'copy-message',
      sourceHash: destinationHash,
      destinationHash: '6'.repeat(32),
      title: 'Message title',
      content: 'Message body',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(ChatView);

      await fireEvent.click(screen.getByRole('button', { name: /Message body/ }));
      await fireEvent.contextMenu(screen.getByLabelText('Open actions for message: Message body'), {
        clientX: 100,
        clientY: 100,
      });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy message text' }));

      expect(writeText).toHaveBeenCalledWith('Message title\n\nMessage body');
      expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('shows but disables copying for an attachment-only message', async () => {
    const destinationHash = '5'.repeat(32);
    chatMessages.set([{
      id: 'identity:attachment-only-copy',
      identityId: 'identity',
      messageId: 'attachment-only-copy',
      sourceHash: destinationHash,
      destinationHash: '6'.repeat(32),
      title: '',
      content: '',
      attachments: [{
        kind: 'file',
        name: 'payload.bin',
        mimeType: 'application/octet-stream',
        data: new Uint8Array([1, 2, 3]),
      }],
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /payload.bin/ }));
    await fireEvent.contextMenu(screen.getByLabelText('Open actions for message: payload.bin'), {
      clientX: 100,
      clientY: 100,
    });

    expect(screen.getByRole('menuitem', { name: 'Copy message text' })).toBeDisabled();
  });

  it('aborts a sending message without deleting it and then offers retry', async () => {
    const destinationHash = '6'.repeat(32);
    chatMessages.set([{
      id: 'identity:abort-message',
      identityId: 'identity',
      messageId: 'abort-message',
      sourceHash: '5'.repeat(32),
      destinationHash,
      title: '',
      content: 'Abort this message',
      direction: 'outgoing',
      status: 'sending',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const abort = vi.spyOn(reticulumRuntime, 'abortChatMessage').mockImplementation(async () => {
      chatMessages.update((items) => items.map((message) => (
        message.messageId === 'abort-message' ? { ...message, status: 'failed' as const } : message
      )));
      return true;
    });
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Abort this message/ }));
    const bubble = screen.getByLabelText('Open actions for message: Abort this message');
    await fireEvent.contextMenu(bubble, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Abort sending' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Retry sending' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Abort sending' }));

    expect(abort).toHaveBeenCalledWith('abort-message');
    expect(screen.getAllByText('Abort this message').length).toBeGreaterThan(0);
    await fireEvent.contextMenu(bubble, { clientX: 100, clientY: 100 });
    expect(screen.queryByRole('menuitem', { name: 'Abort sending' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Retry sending' })).toBeInTheDocument();
  });

  it('deletes a sending message from its context menu', async () => {
    const destinationHash = '6'.repeat(32);
    chatMessages.set([{
      id: 'identity:sending-message',
      identityId: 'identity',
      messageId: 'sending-message',
      sourceHash: '5'.repeat(32),
      destinationHash,
      title: '',
      content: 'Cancel this message',
      direction: 'outgoing',
      status: 'sending',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const remove = vi.spyOn(reticulumRuntime, 'deleteChatMessage').mockResolvedValue(true);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Cancel this message/ }));
    await fireEvent.contextMenu(screen.getByLabelText('Open actions for message: Cancel this message'), {
      clientX: 100,
      clientY: 100,
    });
    expect(screen.queryByRole('menuitem', { name: 'Retry sending' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete message?');
    expect(remove).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete message' }));

    expect(remove).toHaveBeenCalledWith('sending-message');
  });

  it('opens message actions after a touch long press', async () => {
    const sourceHash = '8'.repeat(32);
    chatMessages.set([{
      id: 'identity:touch-message',
      identityId: 'identity',
      messageId: 'touch-message',
      sourceHash,
      destinationHash: '9'.repeat(32),
      title: '',
      content: 'Hold this message',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);
    await fireEvent.click(screen.getByRole('button', { name: /Hold this message/ }));
    const bubble = screen.getByLabelText('Open actions for message: Hold this message');

    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(bubble, {
        pointerType: 'touch',
        pointerId: 1,
        button: 0,
        clientX: 80,
        clientY: 120,
      });
      await vi.advanceTimersByTimeAsync(550);
      const menu = screen.getByRole('menu', { name: 'Message actions' });
      expect(menu).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete message' })).toBeInTheDocument();
      await fireEvent.pointerUp(bubble, { pointerType: 'touch', pointerId: 1, button: 0 });
      await fireEvent.contextMenu(bubble, { clientX: 20, clientY: 30 });
      expect(menu).toHaveStyle({ left: '80px', top: '120px' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes a complete chat from its right-click menu', async () => {
    const destinationHash = 'd'.repeat(32);
    chatMessages.set([{
      id: 'identity:conversation-message',
      identityId: 'identity',
      messageId: 'conversation-message',
      sourceHash: destinationHash,
      destinationHash: 'e'.repeat(32),
      title: '',
      content: 'Delete this conversation',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Conversation contact',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const remove = vi.spyOn(reticulumRuntime, 'deleteChatConversation').mockImplementation(async () => {
      chatMessages.set([]);
      return true;
    });
    render(ChatView);

    const row = screen.getByRole('button', { name: /Delete this conversation/ });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menu', { name: 'Chat actions' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete conversation' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete the chat with “Conversation contact”?');
    expect(remove).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));

    expect(remove).toHaveBeenCalledWith(destinationHash);
    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'No conversations yet' })).toBeInTheDocument();
  });

  it('copies a chat destination hash and offers to add an unknown destination as a contact', async () => {
    const destinationHash = 'c'.repeat(32);
    chatMessages.set([{
      id: 'identity:destination-actions',
      identityId: 'identity',
      messageId: 'destination-actions',
      sourceHash: destinationHash,
      destinationHash: 'e'.repeat(32),
      title: '',
      content: 'Destination actions',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(ChatView);
      const row = screen.getByRole('button', { name: /Destination actions/ });

      await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy destination hash' }));
      expect(writeText).toHaveBeenCalledWith(destinationHash);

      await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
      expect(screen.getByRole('menuitem', { name: 'Add contact' })).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Add contact' }));
      expect(screen.getByRole('heading', { name: 'Add contact' })).toBeInTheDocument();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('probes a chat destination from the action below copy and reports live progress', async () => {
    const destinationHash = '9'.repeat(32);
    chatMessages.set([{
      id: 'identity:probe-actions',
      identityId: 'identity',
      messageId: 'probe-actions',
      sourceHash: destinationHash,
      destinationHash: 'e'.repeat(32),
      title: '',
      content: 'Probe actions',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Remote Alice',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    let resolveProbe!: (result: Awaited<ReturnType<typeof reticulumRuntime.probeDestination>>) => void;
    const probe = vi.spyOn(reticulumRuntime, 'probeDestination').mockImplementation(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    destinationPathStatuses.set({
      [destinationHash]: { destinationHash, hasPath: true, hops: 3 },
    });
    render(ChatView);
    render(ToastViewport);

    const row = screen.getByRole('button', { name: /Probe actions/ });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    const menuItems = screen.getAllByRole('menuitem');
    const copyIndex = menuItems.findIndex((item) => item.textContent?.includes('Copy destination hash'));
    expect(menuItems[copyIndex + 1]).toHaveTextContent('Probe destination');

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Probe destination' }));
    expect(probe).toHaveBeenCalledWith(destinationHash, 'lxmf.delivery', 22_000, 8, expect.any(AbortSignal));
    expect(await screen.findByRole('status')).toHaveTextContent(`Probe sent to Remote Alice <${destinationHash.slice(0, 8)}…${destinationHash.slice(-6)}>. Waiting for a response…`);
    expect(screen.getByRole('button', { name: 'Cancel activity' })).toBeInTheDocument();
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Probe destination' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Close chat actions' }));

    resolveProbe({
      ok: true,
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      probeSizeBytes: 8,
      roundTripTimeMs: 31.25,
      hops: 1,
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`Probe to Remote Alice <${destinationHash.slice(0, 8)}…${destinationHash.slice(-6)}> succeeded in 0.0 s.`));
    expect(get(probeHistory)[0]).toEqual(expect.objectContaining({ destinationHash, ok: true }));

    probe.mockResolvedValueOnce({
      ok: false,
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      probeSizeBytes: 8,
      code: 'PROBE_DESTINATION_UNKNOWN',
    });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Probe destination' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`Cannot probe Remote Alice <${destinationHash.slice(0, 8)}…${destinationHash.slice(-6)}> because no public identity is known for this destination.`);
  });

  it('opens destination actions from contact and announce rows and edits known contacts', async () => {
    const destinationHash = 'a'.repeat(32);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Known Alice',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    chatAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: 'b'.repeat(32),
      publicKey: 'c'.repeat(128),
      displayName: 'Announced Alice',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const removeContact = vi.spyOn(reticulumRuntime, 'deleteChatContact').mockResolvedValue(true);
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    const contactRow = screen.getByText('Known Alice').closest('button');
    expect(contactRow).not.toBeNull();
    if (contactRow) await fireEvent.contextMenu(contactRow, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Edit contact' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove contact' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete conversation' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit contact' }));
    expect(screen.getByRole('textbox', { name: /^Contact name/ })).toHaveValue('Known Alice');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    chatMessages.set([{
      id: 'identity:known-alice-message',
      identityId: 'identity',
      messageId: 'known-alice-message',
      sourceHash: destinationHash,
      destinationHash: 'd'.repeat(32),
      title: '',
      content: 'Message from known Alice',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);

    if (contactRow) await fireEvent.contextMenu(contactRow, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Delete conversation' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Close chat actions' }));

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    const announceRow = screen.getByText('Announced Alice').closest('button');
    expect(announceRow).not.toBeNull();
    if (announceRow) await fireEvent.contextMenu(announceRow, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Copy destination hash' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit contact' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove contact' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Block destination' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete conversation' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove contact' }));
    expect(removeContact).toHaveBeenCalledWith(`identity:${destinationHash}`);
  });

  it('blocks a chat from its context menu and makes the open chat read-only', async () => {
    const destinationHash = 'b'.repeat(32);
    chatMessages.set([{
      id: 'identity:block-conversation',
      identityId: 'identity',
      messageId: 'block-conversation',
      sourceHash: destinationHash,
      destinationHash: 'e'.repeat(32),
      title: '',
      content: 'Block this conversation',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const block = vi.spyOn(reticulumRuntime, 'blockChatDestination').mockImplementation(async () => {
      blockedChatDestinations.set([{
        id: `identity:${destinationHash}`,
        identityId: 'identity',
        destinationHash,
        blockedAt: '2026-07-16T10:02:00.000Z',
      }]);
      return true;
    });
    render(ChatView);

    const row = screen.getByRole('button', { name: /Block this conversation/ });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Block destination' }));
    expect(block).toHaveBeenCalledWith(destinationHash);
    expect(await screen.findByLabelText('Blocked destination')).toBeInTheDocument();

    await fireEvent.click(row);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unblock destination' })).toBeInTheDocument();
  });

  it('can dismiss message deletion without deleting it', async () => {
    const destinationHash = '2'.repeat(32);
    chatMessages.set([{
      id: 'identity:keep-message',
      identityId: 'identity',
      messageId: 'keep-message',
      sourceHash: destinationHash,
      destinationHash: '3'.repeat(32),
      title: '',
      content: 'Keep this message',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const remove = vi.spyOn(reticulumRuntime, 'deleteChatMessage').mockResolvedValue(true);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Keep this message/ }));
    await fireEvent.contextMenu(screen.getByLabelText('Open actions for message: Keep this message'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('opens chat actions after a touch long press', async () => {
    const destinationHash = 'f'.repeat(32);
    chatMessages.set([{
      id: 'identity:touch-conversation',
      identityId: 'identity',
      messageId: 'touch-conversation',
      sourceHash: destinationHash,
      destinationHash: '1'.repeat(32),
      title: '',
      content: 'Hold this chat',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);
    const row = screen.getByRole('button', { name: /Hold this chat/ });

    vi.useFakeTimers();
    try {
      await fireEvent.pointerDown(row, {
        pointerType: 'touch',
        pointerId: 2,
        button: 0,
        clientX: 80,
        clientY: 120,
      });
      expect(row).toHaveClass('touch-active');
      await vi.advanceTimersByTimeAsync(550);
      const menu = screen.getByRole('menu', { name: 'Chat actions' });
      expect(menu).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete conversation' })).toBeInTheDocument();
      await fireEvent.pointerUp(row, { pointerType: 'touch', pointerId: 2, button: 0 });
      expect(row).not.toHaveClass('touch-active');
      await fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });
      expect(menu).toHaveStyle({ left: '80px', top: '120px' });
      await fireEvent.click(screen.getByRole('button', { name: 'Close chat actions' }));
      expect(screen.queryByRole('menu', { name: 'Chat actions' })).not.toBeInTheDocument();
      vi.useRealTimers();
      row.classList.add('touch-active');
      await fireEvent.click(row);
      expect(row).not.toHaveClass('touch-active');
      await waitFor(() => {
        expect(document.querySelector('.chat-workspace')).toHaveClass('conversation-selected');
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows touch feedback for contact and announce rows', async () => {
    const contactDestination = '6'.repeat(32);
    const announceDestination = '7'.repeat(32);
    chatContacts.set([{
      id: `identity:${contactDestination}`,
      identityId: 'identity',
      destinationHash: contactDestination,
      name: 'Touch contact',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    chatAnnounces.set([{
      id: `identity:${announceDestination}`,
      identityId: 'identity',
      destinationHash: announceDestination,
      identityHash: '8'.repeat(32),
      publicKey: '9'.repeat(128),
      displayName: 'Touch announce',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    const contactRow = screen.getByText('Touch contact').closest('button');
    expect(contactRow).not.toBeNull();
    if (contactRow) {
      await fireEvent.pointerDown(contactRow, { pointerType: 'touch', pointerId: 3, button: 0 });
      expect(contactRow).toHaveClass('touch-active');
      await fireEvent.pointerUp(contactRow, { pointerType: 'touch', pointerId: 3, button: 0 });
      expect(contactRow).not.toHaveClass('touch-active');
    }

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    const announceRow = screen.getByText('Touch announce').closest('button');
    expect(announceRow).not.toBeNull();
    if (announceRow) {
      await fireEvent.pointerDown(announceRow, { pointerType: 'touch', pointerId: 4, button: 0 });
      expect(announceRow).toHaveClass('touch-active');
      await fireEvent.pointerUp(announceRow, { pointerType: 'touch', pointerId: 4, button: 0 });
      expect(announceRow).not.toHaveClass('touch-active');
    }
  });

  it('paints cleared touch feedback before opening a pointer-activated conversation', async () => {
    const destinationHash = '4'.repeat(32);
    chatMessages.set([{
      id: 'identity:painted-touch-conversation',
      identityId: 'identity',
      messageId: 'painted-touch-conversation',
      sourceHash: destinationHash,
      destinationHash: '1'.repeat(32),
      title: '',
      content: 'Paint before opening',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    document.documentElement.dataset.nativeShell = 'true';
    render(ChatView);
    const row = screen.getByRole('button', { name: /Paint before opening/ });
    row.classList.add('touch-active');

    row.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    expect(row).not.toHaveClass('touch-active');
    expect(document.querySelector('.chat-workspace')).not.toHaveClass('conversation-selected');
    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks.shift()?.(0);
    await Promise.resolve();
    expect(document.querySelector('.chat-workspace')).not.toHaveClass('conversation-selected');
    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks.shift()?.(16);
    await waitFor(() => {
      expect(document.querySelector('.chat-workspace')).toHaveClass('conversation-selected');
    });
  });

  it('shows per-chat unread messages and clears them when that chat is opened', async () => {
    const sourceHash = '6'.repeat(32);
    chatMessages.set([{
      id: 'identity:unread-1',
      identityId: 'identity',
      messageId: 'unread-1',
      sourceHash,
      destinationHash: '5'.repeat(32),
      title: '',
      content: 'First unread',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }, {
      id: 'identity:unread-2',
      identityId: 'identity',
      messageId: 'unread-2',
      sourceHash,
      destinationHash: '5'.repeat(32),
      title: '',
      content: 'Second unread',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    noteUnreadChatMessage(sourceHash, 'identity:unread-1');
    noteUnreadChatMessage(sourceHash, 'identity:unread-2');
    render(ChatView);

    const conversation = screen.getByRole('button', { name: /Second unread/ });
    expect(conversation).toHaveTextContent('2');
    expect(screen.getByLabelText('2 unread messages')).toBeInTheDocument();

    await fireEvent.click(conversation);
    await waitFor(() => expect(screen.queryByLabelText('2 unread messages')).not.toBeInTheDocument());
    expect(screen.getAllByText('New')).toHaveLength(2);

    chatMessages.update((messages) => [...messages, {
      id: 'identity:unread-3',
      identityId: 'identity',
      messageId: 'unread-3',
      sourceHash,
      destinationHash: '5'.repeat(32),
      title: '',
      content: 'Received while open',
      receivedAt: '2026-07-16T10:02:00.000Z',
    }]);
    noteUnreadChatMessage(sourceHash, 'identity:unread-3');

    await waitFor(() => expect(screen.getAllByText('New')).toHaveLength(1));
    const receivedMessage = screen.getAllByText('Received while open').find((element) => element.tagName === 'P');
    expect(receivedMessage?.closest('.message-bubble')).toHaveTextContent('New');
    expect(screen.getByText('First unread').closest('.message-bubble')).not.toHaveTextContent('New');
    expect(screen.getByText('Second unread').closest('.message-bubble')).not.toHaveTextContent('New');
  });

  it('clears open-chat unread markers after sending a new message', async () => {
    const sourceHash = '7'.repeat(32);
    chatMessages.set([{
      id: 'identity:send-marker',
      identityId: 'identity',
      messageId: 'send-marker',
      sourceHash,
      destinationHash: '5'.repeat(32),
      title: '',
      content: 'Unread before reply',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    noteUnreadChatMessage(sourceHash, 'identity:send-marker');
    vi.spyOn(reticulumRuntime, 'sendChatMessage').mockResolvedValue({ ok: true });
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Unread before reply/ }));
    expect(screen.getByText('New')).toBeInTheDocument();

    await fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Reply' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.queryByText('New')).not.toBeInTheDocument());
  });

  it('does not restore unread markers after the conversation is closed', async () => {
    const sourceHash = '8'.repeat(32);
    chatMessages.set([{
      id: 'identity:close-marker',
      identityId: 'identity',
      messageId: 'close-marker',
      sourceHash,
      destinationHash: '5'.repeat(32),
      title: '',
      content: 'Unread before close',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    noteUnreadChatMessage(sourceHash, 'identity:close-marker');
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Unread before close/ }));
    expect(screen.getByText('New')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('log', { name: 'Conversation messages' })).not.toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: /Unread before close/ }));

    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('closes and restores a conversation through browser history', async () => {
    const sourceHash = '7'.repeat(32);
    chatMessages.set([{
      id: 'identity:history-conversation',
      identityId: 'identity',
      messageId: 'history-conversation',
      sourceHash,
      destinationHash: '4'.repeat(32),
      title: '',
      content: 'History conversation',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /History conversation/ }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Preserved draft' },
    });

    window.history.back();
    await waitFor(() => expect(screen.queryByRole('log', { name: 'Conversation messages' })).not.toBeInTheDocument());

    window.history.forward();
    await waitFor(() => expect(screen.getByRole('log', { name: 'Conversation messages' })).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Preserved draft');
  });

  it('reacts to announces and messages received after the view is mounted', async () => {
    const sourceHash = 'e'.repeat(32);
    render(ChatView);

    expect(screen.getByRole('heading', { name: 'No chat announces heard' })).toBeInTheDocument();

    chatAnnounces.set([{
      id: `identity:${sourceHash}`,
      identityId: 'identity',
      destinationHash: sourceHash,
      identityHash: 'f'.repeat(32),
      publicKey: 'a'.repeat(128),
      displayName: 'Live Alice',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    chatMessages.set([{
      id: 'identity:live-message',
      identityId: 'identity',
      messageId: 'live-message',
      sourceHash,
      destinationHash: 'b'.repeat(32),
      title: 'Live greeting',
      content: 'Arrived after mount',
      verification: 'verified',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);

    await waitFor(() => expect(screen.getByText('Live Alice')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Announces' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(sourceHash)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('tab', { name: 'Chats' }));
    expect(screen.getByText('Arrived after mount')).toBeInTheDocument();
  });

  it('prefills a contact name from the selected announce and saves a custom name', async () => {
    const destinationHash = '1'.repeat(32);
    chatAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: '2'.repeat(32),
      publicKey: '3'.repeat(128),
      displayName: 'Announced Alice',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const saveContact = vi.spyOn(reticulumRuntime, 'saveChatContact').mockResolvedValue(true);
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    await fireEvent.click(screen.getByRole('button', { name: /Announced Alice/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    const name = screen.getByRole('textbox', { name: /^Contact name/ });
    expect(name).toHaveValue('Announced Alice');
    await fireEvent.input(name, { target: { value: 'My Alice' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveContact).toHaveBeenCalledWith(destinationHash, 'My Alice');
  });

  it('deletes a contact from the Contacts list', async () => {
    const destinationHash = '7'.repeat(32);
    chatContacts.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Local Alice',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const deleteContact = vi.spyOn(reticulumRuntime, 'deleteChatContact').mockResolvedValue(true);
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(screen.getByRole('heading', { name: 'Choose a conversation' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: /^Contact name/ })).toHaveValue('Local Alice');
    expect(screen.getByRole('heading', { name: 'Choose a conversation' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete contact Local Alice' }));

    expect(deleteContact).toHaveBeenCalledWith(`identity:${destinationHash}`);
  });

  it('queues an outbound message from an announced destination conversation', async () => {
    const destinationHash = '4'.repeat(32);
    let feedHeight = 400;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => feedHeight);
    chatAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: '5'.repeat(32),
      publicKey: '6'.repeat(128),
      displayName: 'Bob',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const send = vi.spyOn(reticulumRuntime, 'sendChatMessage').mockResolvedValue({ ok: true });
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    await fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    const feed = screen.getByRole('log', { name: 'Conversation messages' });
    await waitFor(() => expect(feed.scrollTop).toBe(400));
    feed.scrollTop = 0;
    feedHeight = 1400;
    const composer = screen.getByRole('textbox', { name: 'Message' });
    await fireEvent.input(composer, { target: { value: 'Hello Bob' } });
    composer.focus();
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    sendButton.dispatchEvent(pointerDown);
    expect(pointerDown).toHaveProperty('defaultPrevented', true);
    expect(composer).toHaveFocus();
    await fireEvent.click(sendButton);

    expect(send).toHaveBeenCalledWith(destinationHash, 'Hello Bob', '', []);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    await waitFor(() => expect(feed.scrollTop).toBe(1400));
    expect(composer).toHaveFocus();
  });

  it('dismisses the attachment menu outside and exposes one shared file chooser', async () => {
    const destinationHash = '4'.repeat(32);
    chatAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: '5'.repeat(32),
      publicKey: '6'.repeat(128),
      displayName: 'Bob',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    await fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose photo' })).not.toBeInTheDocument();

    await fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Choose files' })).not.toBeInTheDocument());
  });

  it('allows an attachment-only message to be selected and sent', async () => {
    const destinationHash = '4'.repeat(32);
    chatAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: '5'.repeat(32),
      publicKey: '6'.repeat(128),
      displayName: 'Bob',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    const send = vi.spyOn(reticulumRuntime, 'sendChatMessage').mockResolvedValue({ ok: true });
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    await fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([accept])');
    const file = new File(['attachment'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('attachment').buffer,
    });
    expect(input).not.toBeNull();
    if (input) await fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    const attachmentMenu = screen.getByRole('button', { name: 'Choose files' })
      .closest('.composer-attachment-menu');
    expect(attachmentMenu?.parentElement).toHaveClass('composer-attachment-control');
    await fireEvent.pointerDown(document.body);

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton).toBeEnabled();
    await fireEvent.click(sendButton);

    expect(send).toHaveBeenCalledWith(destinationHash, '', '', [expect.objectContaining({
      kind: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
    })]);
  });

  it('uses the image icon for every image in the draft', async () => {
    const destinationHash = '4'.repeat(32);
    chatAnnounces.set([{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: '5'.repeat(32),
      publicKey: '6'.repeat(128),
      displayName: 'Bob',
      heardAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('tab', { name: 'Announces' }));
    await fireEvent.click(screen.getByRole('button', { name: /Bob/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));

    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([accept])');
    expect(input).not.toBeNull();
    if (input) {
      await fireEvent.change(input, {
        target: {
          files: [
            new File(['first'], 'first.gif', { type: 'image/gif' }),
            new File(['second'], 'second.gif', { type: 'image/gif' }),
          ],
        },
      });
    }

    const firstChip = (await screen.findByText('first.gif')).parentElement;
    const secondChip = (await screen.findByText('second.gif')).parentElement;
    expect(firstChip).toHaveAttribute('data-attachment-icon', 'image');
    expect(secondChip).toHaveAttribute('data-attachment-icon', 'image');

    chatMessages.set([{
      id: 'identity:multiple-images',
      identityId: 'identity',
      messageId: 'multiple-images',
      sourceHash: destinationHash,
      destinationHash: '7'.repeat(32),
      title: '',
      content: '',
      attachments: [
        {
          kind: 'image',
          name: 'first.gif',
          mimeType: 'image/gif',
          data: new Uint8Array([1]),
        },
        {
          kind: 'file',
          name: 'second.gif',
          mimeType: 'image/gif',
          data: new Uint8Array([2]),
        },
      ],
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);

    await waitFor(() => expect(document.querySelectorAll('.message-file-copy')).toHaveLength(2));
    expect(Array.from(document.querySelectorAll('.message-file-copy')).map(
      (element) => element.getAttribute('data-attachment-icon'),
    )).toEqual(['image', 'image']);
  });

  it('prompts once and keeps a smaller downscaled image attachment', async () => {
    const destinationHash = 'd'.repeat(32);
    const imageEncoding = installLargeImageMocks(80, true);
    chatMessages.set([incomingConversationMessage(
      destinationHash,
      'image-downscale-success',
      'Conversation for image downscaling',
    )]);
    render(ChatView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: /Conversation for image downscaling/ }));
    await selectComposerFile(sizedFile('landscape.jpeg', 'image/jpeg', 200));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      '“landscape.jpeg” is 4096 × 2048 pixels. Scale down this image to reduce its size before sending?',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Downscale' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Downscaling “landscape.jpeg”…');

    imageEncoding.finish();

    expect(await screen.findByText('landscape.jpg')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reduced “landscape.jpeg” from 200 B to 80 B.',
    );
    expect(imageEncoding.drawImage).toHaveBeenCalledOnce();
    expect(imageEncoding.close).toHaveBeenCalledOnce();
  });

  it('automatically downscales to the configured edge without prompting', async () => {
    const destinationHash = 'c'.repeat(32);
    const preferences = structuredClone(defaultAppPreferences);
    preferences.chat.imageDownscalingMode = 'automatic';
    preferences.chat.imageDownscalingMaxLongEdge = 1_000;
    appPreferences.set(preferences);
    const imageEncoding = installLargeImageMocks(80, true);
    chatMessages.set([incomingConversationMessage(
      destinationHash,
      'automatic-image-downscale',
      'Conversation with automatic image downscaling',
    )]);
    render(ChatView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: /Conversation with automatic image downscaling/ }));
    await selectComposerFile(sizedFile('automatic.jpeg', 'image/jpeg', 200));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Downscaling “automatic.jpeg”…');

    imageEncoding.finish();

    expect(await screen.findByText('automatic.jpg')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reduced “automatic.jpeg” from 200 B to 80 B.',
    );
    expect(imageEncoding.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1_000, 500);
    expect(imageEncoding.close).toHaveBeenCalledOnce();
  });

  it('keeps original images without decoding or prompting when downscaling is disabled', async () => {
    const destinationHash = '8'.repeat(32);
    const preferences = structuredClone(defaultAppPreferences);
    preferences.chat.imageDownscalingMode = 'never';
    appPreferences.set(preferences);
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    chatMessages.set([incomingConversationMessage(
      destinationHash,
      'never-image-downscale',
      'Conversation without image downscaling',
    )]);
    render(ChatView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: /Conversation without image downscaling/ }));
    await selectComposerFile(sizedFile('original.jpeg', 'image/jpeg', 200));

    expect(await screen.findByText('original.jpeg')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('keeps the original image and shows informational feedback when downscaling is larger', async () => {
    const destinationHash = 'e'.repeat(32);
    installLargeImageMocks(240);
    chatMessages.set([incomingConversationMessage(
      destinationHash,
      'image-downscale-larger',
      'Conversation with incompressible image',
    )]);
    render(ChatView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: /Conversation with incompressible image/ }));
    await selectComposerFile(sizedFile('detail.jpeg', 'image/jpeg', 200));
    await fireEvent.click(await screen.findByRole('button', { name: 'Downscale' }));

    expect(await screen.findByText('detail.jpeg')).toBeInTheDocument();
    const status = await screen.findByRole('status');
    expect(status).toHaveClass('info');
    expect(status).toHaveTextContent(
      'The downscaled “detail.jpeg” was 240 B, not smaller than the 200 B original. The original was kept.',
    );
  });

  it('keeps the original image and shows an error when downscaling fails', async () => {
    const destinationHash = 'f'.repeat(32);
    installLargeImageMocks(null);
    chatMessages.set([incomingConversationMessage(
      destinationHash,
      'image-downscale-error',
      'Conversation with failed image processing',
    )]);
    render(ChatView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: /Conversation with failed image processing/ }));
    await selectComposerFile(sizedFile('broken.jpeg', 'image/jpeg', 200));
    await fireEvent.click(await screen.findByRole('button', { name: 'Downscale' }));

    expect(await screen.findByText('broken.jpeg')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '“broken.jpeg” could not be downscaled. The original was kept.',
    );
  });

  it('keeps text and attachment drafts scoped to their conversation', async () => {
    const aliceHash = 'a'.repeat(32);
    const bobHash = 'b'.repeat(32);
    chatMessages.set([{
      id: 'identity:alice-message',
      identityId: 'identity',
      messageId: 'alice-message',
      sourceHash: aliceHash,
      destinationHash: '1'.repeat(32),
      title: '',
      content: 'Message from Alice',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }, {
      id: 'identity:bob-message',
      identityId: 'identity',
      messageId: 'bob-message',
      sourceHash: bobHash,
      destinationHash: '1'.repeat(32),
      title: '',
      content: 'Message from Bob',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }]);
    render(ChatView);

    await fireEvent.click(screen.getByRole('button', { name: /Message from Alice/ }));
    const composer = screen.getByRole('textbox', { name: 'Message' });
    await fireEvent.input(composer, { target: { value: 'Draft for Alice' } });

    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([accept])');
    const file = new File(['alice attachment'], 'alice-notes.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('alice attachment').buffer,
    });
    expect(input).not.toBeNull();
    if (input) await fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('alice-notes.txt')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Message from Bob/ }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(screen.queryByText('alice-notes.txt')).not.toBeInTheDocument();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Draft for Bob' },
    });

    await fireEvent.click(screen.getByRole('button', { name: /Message from Alice/ }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Draft for Alice');
    expect(screen.getByText('alice-notes.txt')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Message from Bob/ }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Draft for Bob');
    expect(screen.queryByText('alice-notes.txt')).not.toBeInTheDocument();
  });

  it('stops a voice recording when its conversation closes and keeps the audio in that draft', async () => {
    const destinationHash = 'c'.repeat(32);
    const stopTrack = vi.fn();
    const stopRecording = vi.fn();

    class MockFile extends Blob {
      readonly name: string;
      readonly lastModified: number;

      constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
        super(parts, options);
        this.name = name;
        this.lastModified = options?.lastModified ?? Date.now();
      }
    }

    class MockMediaRecorder {
      static isTypeSupported(mimeType: string): boolean {
        return mimeType === 'audio/mp4';
      }

      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;

      start(): void {
        this.state = 'recording';
      }

      stop(): void {
        stopRecording();
        this.state = 'inactive';
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
        } as BlobEvent);
        this.onstop?.();
      }
    }

    vi.stubGlobal('File', MockFile);
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });
    chatMessages.set([{
      id: 'identity:recording-message',
      identityId: 'identity',
      messageId: 'recording-message',
      sourceHash: destinationHash,
      destinationHash: '1'.repeat(32),
      title: '',
      content: 'Conversation with recording',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    render(ChatView);

    const conversation = screen.getByRole('button', { name: /Conversation with recording/ });
    await fireEvent.click(conversation);
    await fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Record audio message' }));
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(stopRecording).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();

    await fireEvent.click(conversation);
    expect(await screen.findByText(/voice-message-.*\.m4a/)).toBeInTheDocument();
  });
});

function incomingConversationMessage(destinationHash: string, messageId: string, content: string) {
  return {
    id: `identity:${messageId}`,
    identityId: 'identity',
    messageId,
    sourceHash: destinationHash,
    destinationHash: '1'.repeat(32),
    title: '',
    content,
    receivedAt: '2026-07-16T10:00:00.000Z',
  };
}

function sizedFile(name: string, type: string, byteLength: number): File {
  const bytes = new Uint8Array(byteLength);
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.buffer,
  });
  return file;
}

async function selectComposerFile(file: File): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([accept])');
  expect(input).not.toBeNull();
  if (input) await fireEvent.change(input, { target: { files: [file] } });
}

function installLargeImageMocks(encodedByteLength: number | null, deferred = false): {
  close: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  finish: () => void;
} {
  const close = vi.fn();
  const drawImage = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
    width: 4_096,
    height: 2_048,
    close,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage,
  } as unknown as CanvasRenderingContext2D);

  let callback: BlobCallback | undefined;
  const finish = () => {
    callback?.(encodedByteLength === null
      ? null
      : {
          arrayBuffer: async () => new Uint8Array(encodedByteLength).buffer,
        } as Blob);
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((nextCallback) => {
    callback = nextCallback;
    if (!deferred) finish();
  });
  return { close, drawImage, finish };
}
