<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    chatConversationSummaries,
    chatMessageDisplayStatus,
    chatMessageDirection,
    chatMessagePeerHash,
    chatMessagePreview,
    messageTime,
    type ChatAttachment,
    type ChatConversationSummary,
    type ChatMessage,
    type ChatMessageStatus,
  } from '../../domain/chat';
  import {
    chatAttachmentBytes,
    formatChatByteSize,
    isRenderableChatImage,
    MAX_CHAT_ATTACHMENT_BYTES,
    normalizeChatAttachments,
  } from '../../domain/chat-attachments';
  import { createDateFormatter, locale, t, type MessageKey } from '../../i18n';
  import {
    chatAnnounces,
    blockedChatDestinations,
    chatContacts,
    chatMessages,
    markChatMessagesRead,
    unreadChatMessageIds,
    unreadChatMessageCounts,
  } from '../../infrastructure/reticulum/chat-state';
  import {
    chatInboundTransfers,
    destinationPathStatuses,
    propagationSyncActive,
    reticulumRuntime,
  } from '../../infrastructure/reticulum/runtime';
  import { pendingProbeDestinationHashes } from '../../infrastructure/reticulum/probe-operations';
  import { probeTimeoutMsForPath } from '../../infrastructure/reticulum/timeouts';
  import EmptyState from '../../lib/components/EmptyState.svelte';
  import ContextMenu from '../../lib/components/ContextMenu.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import PathStatus from '../../lib/components/PathStatus.svelte';
  import { contextMenuTrigger } from '../../lib/actions/contextMenuTrigger';
  import { copyText } from '../../lib/clipboard';
  import ContactEditor from './ContactEditor.svelte';
  import ChatDeleteConfirmation from './ChatDeleteConfirmation.svelte';
  import NewConversationEditor from './NewConversationEditor.svelte';
  import MessageAttachment from './MessageAttachment.svelte';
  import { showDestinationProbeActivity } from '../../lib/notifications/probe-activity';
  import { toast } from '../../lib/notifications/toasts';

  type ChatScope = 'chats' | 'contacts' | 'announces';
  type DestinationActionTarget = {
    destinationHash: string;
    displayName: string;
  };

  let scope = $state<ChatScope>('chats');
  let query = $state('');
  let selectedDestination = $state<string | undefined>();
  let contactEditorDestination = $state<string | undefined>();
  let newConversationOpen = $state(false);
  let composerContent = $state('');
  let composerAttachments = $state<ChatAttachment[]>([]);
  let attachmentMenuOpen = $state(false);
  let attachmentMenu = $state<HTMLDivElement>();
  let attachmentMenuButton = $state<HTMLButtonElement>();
  let fileInput = $state<HTMLInputElement>();
  let recording = $state(false);
  let mediaRecorder: MediaRecorder | undefined;
  let recordingStream: MediaStream | undefined;
  let recordingTimer: ReturnType<typeof setTimeout> | undefined;
  let recordingChunks: Blob[] = [];
  let recordingMimeType = '';
  let recordingAudioContext: AudioContext | undefined;
  let recordingAudioSource: MediaStreamAudioSourceNode | undefined;
  let recordingAnalyser: AnalyserNode | undefined;
  let recordingLevelFrame: number | undefined;
  let smoothedRecordingLevel = 0;
  let composerTextarea = $state<HTMLTextAreaElement>();
  let sending = $state(false);
  let messageFeed = $state<HTMLDivElement>();
  let messageFeedContent = $state<HTMLDivElement>();
  let messageFeedScrollable = $state(false);
  let messageFeedAtBottom = $state(true);
  let followLatestMessageLayout = false;
  let deletingContactId = $state<string | undefined>();
  let propagationSyncRequested = $state(false);
  let openedUnreadMessageIds = $state<string[]>([]);
  let observedIncomingDestination = $state<string | undefined>();
  let observedIncomingMessageId = $state<string | undefined>();
  let messageActions = $state<{ message: ChatMessage; x: number; y: number } | undefined>();
  let chatActions = $state<{
    destinationHash: string;
    displayName: string;
    blocked: boolean;
    x: number;
    y: number;
  } | undefined>();
  let messageActionPending = $state(false);
  let chatActionPending = $state(false);
  let blockActionPending = $state(false);
  let deleteConfirmation = $state<
    | { kind: 'message'; message: ChatMessage }
    | { kind: 'conversation'; destinationHash: string; displayName: string }
    | undefined
  >();
  const scopes: Array<{ id: ChatScope; label: MessageKey }> = [
    { id: 'chats', label: 'chat.scope.chats' },
    { id: 'contacts', label: 'chat.scope.contacts' },
    { id: 'announces', label: 'chat.scope.announces' },
  ];

  const emptyCopy: Record<ChatScope, { title: MessageKey; body: MessageKey }> = {
    chats: { title: 'chat.empty.chats.title', body: 'chat.empty.chats.body' },
    contacts: { title: 'chat.empty.contacts.title', body: 'chat.empty.contacts.body' },
    announces: { title: 'chat.empty.announces.title', body: 'chat.empty.announces.body' },
  };

  const searchName: Record<ChatScope, MessageKey> = {
    chats: 'chat.scope.chats.searchName',
    contacts: 'chat.scope.contacts.searchName',
    announces: 'chat.scope.announces.searchName',
  };

  const statusKeys: Record<ChatMessageStatus, MessageKey> = {
    queued: 'chat.message.status.queued',
    sending: 'chat.message.status.sending',
    sent: 'chat.message.status.sent',
    delivered: 'chat.message.status.delivered',
    failed: 'chat.message.status.failed',
  };

  const verificationKeys: Record<string, MessageKey> = {
    valid: 'chat.message.verification.valid',
    verified: 'chat.message.verification.valid',
    invalid: 'chat.message.verification.invalid',
    unverified: 'chat.message.verification.unverified',
  };

  const conversations = $derived(chatConversationSummaries($chatMessages, $chatAnnounces, $chatContacts));
  const blockedDestinationHashes = $derived(new Set($blockedChatDestinations.map((item) => item.destinationHash)));
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const visibleConversations = $derived(conversations.filter((conversation) => [
    conversation.displayName,
    conversation.destinationHash,
    conversation.latestMessage.title,
    conversation.latestMessage.content,
    ...(conversation.latestMessage.attachments?.map((attachment) => attachment.name) ?? []),
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))));
  const visibleAnnounces = $derived($chatAnnounces.filter((announce) => [
    announce.displayName,
    announce.destinationHash,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))));
  const visibleContacts = $derived($chatContacts.filter((contact) => [
    contact.name,
    contact.destinationHash,
  ].some((value) => value.toLowerCase().includes(normalizedQuery))));
  const selectedAnnounce = $derived($chatAnnounces.find((announce) => announce.destinationHash === selectedDestination));
  const selectedContact = $derived($chatContacts.find((contact) => contact.destinationHash === selectedDestination));
  const contactEditorAnnounce = $derived($chatAnnounces.find(
    (announce) => announce.destinationHash === contactEditorDestination,
  ));
  const contactEditorContact = $derived($chatContacts.find(
    (contact) => contact.destinationHash === contactEditorDestination,
  ));
  const chatActionContact = $derived($chatContacts.find(
    (contact) => contact.destinationHash === chatActions?.destinationHash,
  ));
  const chatActionConversation = $derived(conversations.find(
    (conversation) => conversation.destinationHash === chatActions?.destinationHash,
  ));
  const selectedName = $derived(selectedContact?.name ?? selectedAnnounce?.displayName);
  const selectedDestinationBlocked = $derived(Boolean(
    selectedDestination && blockedDestinationHashes.has(selectedDestination),
  ));
  const selectedMessages = $derived($chatMessages
    .filter((message) => chatMessagePeerHash(message) === selectedDestination)
    .sort((left, right) => messageTime(left) - messageTime(right)));
  const selectedInboundTransfers = $derived($chatInboundTransfers.filter(
    (transfer) => transfer.destinationHash === selectedDestination,
  ));
  const propagationSyncing = $derived(propagationSyncRequested || $propagationSyncActive);
  const propagationSyncLabel = $derived<MessageKey>(propagationSyncing
    ? 'chat.propagationSync.running'
    : 'chat.propagationSync.action');
  const dateFormatter = $derived(createDateFormatter($locale));

  function transferPercent(progress: number | undefined): number {
    return Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100);
  }

  $effect(() => {
    if (selectedDestination && ($unreadChatMessageCounts[selectedDestination] ?? 0) > 0) {
      markChatMessagesRead(selectedDestination);
    }
  });

  $effect(() => {
    const destination = selectedDestination;
    const latestIncomingId = selectedMessages
      .filter((message) => chatMessageDirection(message) === 'incoming')
      .at(-1)?.id;
    if (observedIncomingDestination !== destination) {
      observedIncomingDestination = destination;
      observedIncomingMessageId = latestIncomingId;
      return;
    }
    if (!destination || !latestIncomingId || latestIncomingId === observedIncomingMessageId) return;
    observedIncomingMessageId = latestIncomingId;
    openedUnreadMessageIds = [latestIncomingId];
    void scrollToLatestMessage();
  });

  $effect(() => {
    selectedDestination;
    selectedMessages;
    selectedInboundTransfers;
    void updateMessageFeedOverflow();
  });

  $effect(() => {
    const content = messageFeedContent;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followLatestMessageLayout) void scrollToLatestMessage(false);
      else void updateMessageFeedOverflow();
    });
    observer.observe(content);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!attachmentMenuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      const path = event.composedPath();
      if ((attachmentMenu && path.includes(attachmentMenu))
        || (attachmentMenuButton && path.includes(attachmentMenuButton))) return;
      attachmentMenuOpen = false;
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') attachmentMenuOpen = false;
    };
    window.addEventListener('pointerdown', dismissOutside, true);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('pointerdown', dismissOutside, true);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  });

  onMount(() => {
    const updateOverflow = () => { void updateMessageFeedOverflow(); };
    window.addEventListener('resize', updateOverflow);
    window.visualViewport?.addEventListener('resize', updateOverflow);
    return () => {
      stopRecordingResources();
      window.removeEventListener('resize', updateOverflow);
      window.visualViewport?.removeEventListener('resize', updateOverflow);
    };
  });

  function displayDate(value: string | ChatMessage): string {
    const timestamp = typeof value === 'string' ? Date.parse(value) : messageTime(value);
    return dateFormatter.format(new Date(timestamp));
  }

  function shortHash(value: string): string {
    return `${value.slice(0, 8)}…${value.slice(-6)}`;
  }

  function unreadBadge(count: number): string {
    return count > 99 ? '99+' : String(count);
  }

  async function scrollToLatestMessage(followAttachmentLayout = true): Promise<void> {
    if (followAttachmentLayout) followLatestMessageLayout = true;
    await tick();
    if (messageFeed) messageFeed.scrollTop = messageFeed.scrollHeight;
    await updateMessageFeedOverflow();
  }

  function attachmentLayoutReady(messageId: string): void {
    if (!followLatestMessageLayout || !selectedMessages.some((message) => message.id === messageId)) return;
    requestAnimationFrame(() => { void scrollToLatestMessage(false); });
  }

  function stopFollowingLatestMessageLayout(): void {
    followLatestMessageLayout = false;
  }

  async function updateMessageFeedOverflow(): Promise<void> {
    await tick();
    updateMessageFeedScrollState();
  }

  function updateMessageFeedScrollState(): void {
    if (!selectedDestination || !messageFeed) {
      messageFeedScrollable = false;
      messageFeedAtBottom = true;
      return;
    }
    const remainingScroll = messageFeed.scrollHeight - messageFeed.clientHeight - messageFeed.scrollTop;
    messageFeedScrollable = messageFeed.scrollHeight > messageFeed.clientHeight + 1;
    messageFeedAtBottom = !messageFeedScrollable || remainingScroll <= 2;
  }

  async function selectDestination(destinationHash: string): Promise<void> {
    const incomingMessageIds = new Set($chatMessages
      .filter((message) => chatMessagePeerHash(message) === destinationHash
        && chatMessageDirection(message) === 'incoming')
      .map((message) => message.id));
    openedUnreadMessageIds = ($unreadChatMessageIds[destinationHash] ?? [])
      .filter((messageId) => incomingMessageIds.has(messageId));
    selectedDestination = destinationHash;
    await scrollToLatestMessage();
  }

  function closeConversation(): void {
    openedUnreadMessageIds = [];
    selectedDestination = undefined;
  }

  async function saveContact(name: string): Promise<boolean> {
    return contactEditorDestination
      ? reticulumRuntime.saveChatContact(contactEditorDestination, name)
      : false;
  }

  async function deleteContact(contactId: string): Promise<void> {
    if (deletingContactId) return;
    deletingContactId = contactId;
    try {
      if (!await reticulumRuntime.deleteChatContact(contactId)) toast.error('chat.contact.deleteError');
    } catch {
      toast.error('chat.contact.deleteError');
    } finally {
      deletingContactId = undefined;
    }
  }

  function openMessageActions(message: ChatMessage, clientX: number, clientY: number): void {
    closeChatActions();
    messageActions = {
      message,
      x: clientX,
      y: clientY,
    };
  }

  function destinationActionTarget(destinationHash: string, displayName: string): DestinationActionTarget {
    return {
      destinationHash,
      displayName,
    };
  }

  function conversationActionTarget(conversation: ChatConversationSummary): DestinationActionTarget {
    return destinationActionTarget(
      conversation.destinationHash,
      conversation.displayName ?? shortHash(conversation.destinationHash),
    );
  }

  function openChatActions(target: DestinationActionTarget, clientX: number, clientY: number): void {
    messageActions = undefined;
    chatActions = {
      ...target,
      blocked: blockedDestinationHashes.has(target.destinationHash),
      x: clientX,
      y: clientY,
    };
  }

  function closeChatActions(): void {
    chatActions = undefined;
  }

  async function chatRowClick(destinationHash: string): Promise<void> {
    await selectDestination(destinationHash);
  }

  async function deleteMessage(message: ChatMessage): Promise<void> {
    if (messageActionPending) return;
    messageActions = undefined;
    messageActionPending = true;
    try {
      if (!await reticulumRuntime.deleteChatMessage(message.messageId)) {
        toast.error('chat.message.actions.deleteError');
      } else {
        deleteConfirmation = undefined;
      }
    } catch {
      toast.error('chat.message.actions.deleteError');
    } finally {
      messageActionPending = false;
    }
  }

  async function deleteConversation(destinationHash: string): Promise<void> {
    if (chatActionPending) return;
    chatActions = undefined;
    chatActionPending = true;
    try {
      if (!await reticulumRuntime.deleteChatConversation(destinationHash)) {
        toast.error('chat.conversation.actions.deleteError');
        return;
      }
      deleteConfirmation = undefined;
      if (selectedDestination === destinationHash) closeConversation();
    } catch {
      toast.error('chat.conversation.actions.deleteError');
    } finally {
      chatActionPending = false;
    }
  }

  async function retryMessage(message: ChatMessage): Promise<void> {
    if (messageActionPending) return;
    messageActions = undefined;
    messageActionPending = true;
    try {
      const result = await reticulumRuntime.retryChatMessage(message.messageId);
      if (!result.ok) toast.error('chat.message.actions.retryError');
      else await scrollToLatestMessage();
    } catch {
      toast.error('chat.message.actions.retryError');
    } finally {
      messageActionPending = false;
    }
  }

  async function abortMessage(message: ChatMessage): Promise<void> {
    if (messageActionPending) return;
    messageActions = undefined;
    messageActionPending = true;
    try {
      if (!await reticulumRuntime.abortChatMessage(message.messageId)) {
        toast.error('chat.message.actions.abortError');
      }
    } catch {
      toast.error('chat.message.actions.abortError');
    } finally {
      messageActionPending = false;
    }
  }

  async function setDestinationBlocked(destinationHash: string, blocked: boolean): Promise<void> {
    if (blockActionPending) return;
    blockActionPending = true;
    closeChatActions();
    try {
      const ok = blocked
        ? await reticulumRuntime.blockChatDestination(destinationHash)
        : await reticulumRuntime.unblockChatDestination(destinationHash);
      if (!ok) {
        toast.error(blocked ? 'chat.block.error' : 'chat.unblock.error');
        return;
      }
      toast.success(blocked ? 'chat.block.success' : 'chat.unblock.success');
    } catch {
      toast.error(blocked ? 'chat.block.error' : 'chat.unblock.error');
    } finally {
      blockActionPending = false;
    }
  }

  async function copyDestinationHash(destinationHash: string): Promise<void> {
    closeChatActions();
    if (await copyText(destinationHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  function probeDestination(destinationHash: string, displayName: string): void {
    closeChatActions();
    showDestinationProbeActivity({
      destinationHash,
      displayName,
      fullDestinationName: 'lxmf.delivery',
      timeoutMs: probeTimeoutMsForPath($destinationPathStatuses[destinationHash]),
    });
  }

  function openContactEditor(destinationHash: string): void {
    closeChatActions();
    contactEditorDestination = destinationHash;
  }

  async function sendMessage(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const content = composerContent.trim();
    if (!selectedDestination || (!content && composerAttachments.length === 0) || sending || recording) return;
    sending = true;
    try {
      const result = await reticulumRuntime.sendChatMessage(selectedDestination, content, '', composerAttachments);
      if (result.ok) {
        openedUnreadMessageIds = [];
        composerContent = '';
        composerAttachments = [];
        attachmentMenuOpen = false;
        await tick();
        resizeComposer();
        await scrollToLatestMessage();
      } else {
        toast.error(result.code === 'LXMF_ATTACHMENTS_TOO_LARGE'
          ? 'chat.attachment.tooLarge'
          : result.code === 'LXMF_PROPAGATION_NODE_UNAVAILABLE'
          ? 'chat.composer.propagationUnavailable'
          : result.code === 'LXMF_DESTINATION_BLOCKED'
            ? 'chat.composer.blocked'
            : 'chat.composer.error');
      }
    } catch {
      toast.error('chat.composer.error');
    } finally {
      sending = false;
    }
  }

  async function syncPropagationMessages(): Promise<void> {
    if (propagationSyncing) return;
    propagationSyncRequested = true;
    try {
      const result = await reticulumRuntime.syncLxmfPropagation();
      if (!result) {
        toast.error('chat.propagationSync.failed');
      } else if (result.received === 0) {
        toast.success('chat.propagationSync.complete.none');
      } else if (result.received === 1) {
        toast.success('chat.propagationSync.complete.one');
      } else {
        toast.success('chat.propagationSync.complete.many', { count: result.received });
      }
    } catch {
      toast.error('chat.propagationSync.failed');
    } finally {
      propagationSyncRequested = false;
    }
  }

  function composerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    event.currentTarget instanceof HTMLTextAreaElement
      && event.currentTarget.form?.requestSubmit();
  }

  function preserveComposerFocus(event: PointerEvent): void {
    if (document.activeElement !== composerTextarea) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.conversation-detail button')) event.preventDefault();
  }

  function resizeComposer(event?: Event): void {
    const textarea = event?.currentTarget instanceof HTMLTextAreaElement
      ? event.currentTarget
      : composerTextarea;
    if (!textarea) return;
    const minimumHeight = 42;
    const maximumHeight = 62;
    textarea.style.height = `${minimumHeight}px`;
    const contentHeight = textarea.scrollHeight + 2;
    textarea.style.height = `${Math.min(Math.max(contentHeight, minimumHeight), maximumHeight)}px`;
    textarea.style.overflowY = contentHeight > maximumHeight ? 'auto' : 'hidden';
  }

  async function addFiles(files: FileList | File[]): Promise<void> {
    const additions: ChatAttachment[] = [];
    for (const file of Array.from(files)) {
      const mimeType = file.type.toLowerCase().split(';', 1)[0] || 'application/octet-stream';
      const kind: ChatAttachment['kind'] = mimeType.startsWith('image/') && isRenderableChatImage(mimeType)
        ? 'image'
        : mimeType.startsWith('audio/') ? 'audio' : 'file';
      additions.push({ kind, name: file.name || 'attachment.bin', mimeType, data: new Uint8Array(await file.arrayBuffer()) });
    }
    try {
      composerAttachments = normalizeChatAttachments([...composerAttachments, ...additions]);
      attachmentMenuOpen = false;
    } catch {
      toast.error('chat.attachment.tooLarge', { size: Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1024 / 1024) });
    }
  }

  function fileSelectionChanged(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) void addFiles(input.files);
    input.value = '';
  }

  function removeAttachment(index: number): void {
    composerAttachments = composerAttachments.filter((_, itemIndex) => itemIndex !== index);
  }

  function startRecordingLevelMeter(stream: MediaStream): void {
    stopRecordingLevelMeter();
    if (typeof AudioContext === 'undefined') return;
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      recordingAudioContext = context;
      recordingAudioSource = source;
      recordingAnalyser = analyser;
      void context.resume().catch(() => undefined);

      const samples = new Uint8Array(analyser.fftSize);
      const updateLevel = () => {
        if (recordingAnalyser !== analyser) return;
        analyser.getByteTimeDomainData(samples);
        let squaredAmplitude = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          squaredAmplitude += normalized * normalized;
        }
        const rms = Math.sqrt(squaredAmplitude / samples.length);
        const currentLevel = Math.min(1, Math.max(0, (rms - 0.02) * 5));
        smoothedRecordingLevel = Math.max(currentLevel, smoothedRecordingLevel * 0.82);
        attachmentMenuButton?.style.setProperty(
          '--recording-pulse-scale',
          String(0.32 + smoothedRecordingLevel * 0.78),
        );
        attachmentMenuButton?.style.setProperty(
          '--recording-pulse-scale-outer',
          String(0.28 + smoothedRecordingLevel * 1.05),
        );
        attachmentMenuButton?.style.setProperty(
          '--recording-pulse-opacity',
          String(0.08 + smoothedRecordingLevel * 0.11),
        );
        attachmentMenuButton?.style.setProperty(
          '--recording-pulse-opacity-outer',
          String(0.04 + smoothedRecordingLevel * 0.07),
        );
        recordingLevelFrame = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch {
      stopRecordingLevelMeter();
    }
  }

  function stopRecordingLevelMeter(): void {
    if (recordingLevelFrame !== undefined) cancelAnimationFrame(recordingLevelFrame);
    recordingLevelFrame = undefined;
    recordingAudioSource?.disconnect();
    recordingAudioSource = undefined;
    recordingAnalyser?.disconnect();
    recordingAnalyser = undefined;
    const context = recordingAudioContext;
    recordingAudioContext = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    smoothedRecordingLevel = 0;
    for (const property of [
      '--recording-pulse-scale',
      '--recording-pulse-scale-outer',
      '--recording-pulse-opacity',
      '--recording-pulse-opacity-outer',
    ]) attachmentMenuButton?.style.removeProperty(property);
  }

  async function toggleRecording(): Promise<void> {
    if (recording) {
      mediaRecorder?.stop();
      return;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((candidate) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate));
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      toast.error('chat.attachment.recordingUnsupported');
      return;
    }
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
      recordingMimeType = mimeType.split(';', 1)[0];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunks.push(event.data);
      };
      mediaRecorder.onstop = () => { void finishRecording(); };
      mediaRecorder.onerror = () => {
        toast.error('chat.attachment.recordingError');
        stopRecordingResources();
      };
      mediaRecorder.start(1_000);
      recording = true;
      attachmentMenuOpen = false;
      await tick();
      startRecordingLevelMeter(recordingStream);
      recordingTimer = setTimeout(() => mediaRecorder?.state === 'recording' && mediaRecorder.stop(), 5 * 60 * 1_000);
    } catch (error) {
      stopRecordingResources();
      const errorName = error instanceof DOMException
        ? error.name
        : error && typeof error === 'object' && 'name' in error
          ? String(error.name)
          : '';
      toast.error(errorName === 'NotAllowedError' || errorName === 'SecurityError'
        ? 'chat.attachment.microphoneDenied'
        : 'chat.attachment.recordingError');
    }
  }

  async function finishRecording(): Promise<void> {
    const chunks = recordingChunks;
    const completedMimeType = recordingMimeType;
    stopRecordingResources();
    if (!chunks.length) return;
    const mimeType = completedMimeType || 'audio/webm';
    const extension = mimeType === 'audio/mp4' ? 'm4a' : 'webm';
    const blob = new Blob(chunks, { type: mimeType });
    const name = `voice-message-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    await addFiles([new File([blob], name, { type: mimeType })]);
  }

  function stopRecordingResources(): void {
    stopRecordingLevelMeter();
    if (recordingTimer) clearTimeout(recordingTimer);
    recordingTimer = undefined;
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = undefined;
    mediaRecorder = undefined;
    recordingChunks = [];
    recordingMimeType = '';
    recording = false;
  }
</script>

<svelte:window onpointerdown={preserveComposerFocus} />

<div
  class="chat-workspace"
  class:conversation-selected={selectedDestination !== undefined}
  class:message-feed-scrollable={messageFeedScrollable}
>
  <section class="chat-overview">
    <header class="page-header chat-header">
      <div>
        <p class="eyebrow">{$t('app.name')}</p><h1>{$t('chat.title')}</h1>
      </div>
      <div class="header-actions">
        <button
          class="icon-button chat-sync-button"
          class:syncing={propagationSyncing}
          disabled={propagationSyncing}
          aria-label={$t(propagationSyncLabel)}
          title={$t(propagationSyncLabel)}
          onclick={syncPropagationMessages}
        ><Icon name="sync" size={18} /></button>
        <button
          class="icon-button primary"
          aria-label={$t('chat.newConversation')}
          title={$t('chat.newConversation')}
          onclick={() => { newConversationOpen = true; }}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>
    </header>

    <div class="scope-tabs" role="tablist" aria-label={$t('chat.scopes.label')}>
      {#each scopes as item}
        <button
          role="tab"
          aria-selected={scope === item.id}
          class:active={scope === item.id}
          onclick={() => {
            scope = item.id;
            query = '';
          }}
        >{$t(item.label)}</button>
      {/each}
    </div>

    <label class="search-field">
      <Icon name="search" size={18} />
      <span class="sr-only">{$t('chat.search.label', { scope: $t(searchName[scope]) })}</span>
      <input
        bind:value={query}
        placeholder={$t('chat.search.placeholder', { scope: $t(searchName[scope]) })}
        type="search"
      />
    </label>

    <div
      class="overview-content"
      class:has-items={(scope === 'chats' && visibleConversations.length > 0)
        || (scope === 'contacts' && visibleContacts.length > 0)
        || (scope === 'announces' && visibleAnnounces.length > 0)}
      role="tabpanel"
    >
      {#if scope === 'chats' && visibleConversations.length > 0}
        <div class="chat-directory-list">
          {#each visibleConversations as conversation (conversation.destinationHash)}
            {@const unreadCount = $unreadChatMessageCounts[conversation.destinationHash] ?? 0}
            {@const actionTarget = conversationActionTarget(conversation)}
            <button
              class="chat-directory-row"
              class:active={selectedDestination === conversation.destinationHash}
              aria-haspopup="menu"
              title={$t('chat.conversation.actions.open', {
                name: conversation.displayName ?? shortHash(conversation.destinationHash),
              })}
              onclick={() => { void chatRowClick(conversation.destinationHash); }}
              use:contextMenuTrigger={{
                onopen: (x, y) => openChatActions(actionTarget, x, y),
              }}
            >
              <span class="chat-peer-avatar">{(conversation.displayName ?? conversation.destinationHash).slice(0, 1).toUpperCase()}</span>
              <span class="chat-row-copy">
                <strong>{conversation.displayName ?? shortHash(conversation.destinationHash)}</strong>
                <span>{chatMessagePreview(conversation.latestMessage)}</span>
                <code>{conversation.destinationHash}</code>
              </span>
              <span class="chat-row-meta">
                <time>{displayDate(conversation.latestMessage)}</time>
                <span class="chat-row-indicators">
                  {#if unreadCount > 0}
                    <span
                      class="badge"
                      aria-label={$t(unreadCount === 1 ? 'chat.unread.one' : 'chat.unread.many', { count: unreadCount })}
                    >{unreadBadge(unreadCount)}</span>
                  {/if}
                  <PathStatus
                    status={$destinationPathStatuses[conversation.destinationHash]}
                    blocked={blockedDestinationHashes.has(conversation.destinationHash)}
                  />
                </span>
              </span>
            </button>
          {/each}
        </div>
      {:else if scope === 'contacts' && visibleContacts.length > 0}
        <div class="chat-directory-list">
          {#each visibleContacts as contact (contact.id)}
            {@const actionTarget = destinationActionTarget(contact.destinationHash, contact.name)}
            <div class="chat-contact-row" class:active={selectedDestination === contact.destinationHash}>
              <button
                class="chat-directory-row"
                aria-haspopup="menu"
                onclick={() => { void chatRowClick(contact.destinationHash); }}
                use:contextMenuTrigger={{
                  onopen: (x, y) => openChatActions(actionTarget, x, y),
                }}
              >
                <span class="chat-peer-avatar">{contact.name.slice(0, 1).toUpperCase()}</span>
                <span class="chat-row-copy">
                  <strong>{contact.name}</strong>
                  <code>{contact.destinationHash}</code>
                </span>
                <span class="directory-row-route">
                  <PathStatus
                    status={$destinationPathStatuses[contact.destinationHash]}
                    blocked={blockedDestinationHashes.has(contact.destinationHash)}
                  />
                  <Icon name="arrow-right" size={16} />
                </span>
              </button>
              <div class="bookmark-actions">
                <button
                  aria-label={$t('chat.contact.edit')}
                  onclick={() => {
                    contactEditorDestination = contact.destinationHash;
                  }}
                >
                  <Icon name="edit" size={14} />{$t('chat.contact.edit')}
                </button>
                <button
                  class="danger"
                  disabled={deletingContactId === contact.id}
                  aria-label={$t('chat.contact.delete', { name: contact.name })}
                  onclick={() => deleteContact(contact.id)}
                >
                  <Icon name="trash" size={14} />{$t('common.delete')}
                </button>
              </div>
            </div>
          {/each}
        </div>
      {:else if scope === 'announces' && visibleAnnounces.length > 0}
        <div class="chat-directory-list">
          {#each visibleAnnounces as announce (announce.id)}
            {@const actionTarget = destinationActionTarget(
              announce.destinationHash,
              announce.displayName ?? shortHash(announce.destinationHash),
            )}
            <button
              class="chat-directory-row"
              class:active={selectedDestination === announce.destinationHash}
              aria-haspopup="menu"
              onclick={() => { void chatRowClick(announce.destinationHash); }}
              use:contextMenuTrigger={{
                onopen: (x, y) => openChatActions(actionTarget, x, y),
              }}
            >
              <span class="chat-peer-avatar announce">{(announce.displayName ?? announce.destinationHash).slice(0, 1).toUpperCase()}</span>
              <span class="chat-row-copy">
                <strong>{announce.displayName ?? shortHash(announce.destinationHash)}</strong>
                <span>{$t('chat.announce.heardAt', { date: displayDate(announce.heardAt) })}</span>
                <code>{announce.destinationHash}</code>
              </span>
              <span class="directory-row-route">
                <PathStatus
                  status={$destinationPathStatuses[announce.destinationHash]}
                  blocked={blockedDestinationHashes.has(announce.destinationHash)}
                />
                <Icon name="arrow-right" size={16} />
              </span>
            </button>
          {/each}
        </div>
      {:else}
        <EmptyState
          icon={scope === 'announces' ? 'network' : scope === 'contacts' ? 'identity' : 'chat'}
          title={$t(emptyCopy[scope].title)}
          body={$t(emptyCopy[scope].body)}
          hint={$t('chat.empty.networkHint')}
        />
      {/if}
    </div>

    <div class="trust-note"><Icon name="shield" size={16} /><span>{$t('chat.securityNotice')}</span></div>
  </section>

  {#if selectedDestination}
    <section class="conversation-detail">
      <header class="conversation-header">
        <button
          class="icon-button conversation-back"
          aria-label={$t('common.back')}
          onclick={closeConversation}
        ><Icon name="arrow-right" size={19} /></button>
        <div class="conversation-peer">
          <strong>{selectedName ?? shortHash(selectedDestination)}</strong>
          <code>{selectedDestination}</code>
        </div>
        <button
          class="icon-button conversation-contact-button"
          title={$t(selectedContact ? 'chat.contact.edit' : 'chat.contact.add')}
          aria-label={$t(selectedContact ? 'chat.contact.edit' : 'chat.contact.add')}
          onclick={() => { contactEditorDestination = selectedDestination; }}
        ><Icon name={selectedContact ? 'edit' : 'identity'} size={17} /></button>
        <button
          class="icon-button conversation-block-button"
          class:danger={!selectedDestinationBlocked}
          class:blocked={selectedDestinationBlocked}
          disabled={blockActionPending}
          title={$t(selectedDestinationBlocked ? 'chat.unblock.action' : 'chat.block.action')}
          aria-label={$t(selectedDestinationBlocked ? 'chat.unblock.action' : 'chat.block.action')}
          onclick={() => setDestinationBlocked(selectedDestination!, !selectedDestinationBlocked)}
        ><Icon name="block" size={17} /></button>
        <button
          class="icon-button chat-sync-button mobile-conversation-sync-button"
          class:syncing={propagationSyncing}
          disabled={propagationSyncing}
          aria-label={$t(propagationSyncLabel)}
          title={$t(propagationSyncLabel)}
          onclick={syncPropagationMessages}
        ><Icon name="sync" size={17} /></button>
      </header>
      <div class="message-feed-region">
      <div
        class="message-feed"
        bind:this={messageFeed}
        role="log"
        aria-label={$t('chat.messages.received')}
        onscroll={updateMessageFeedScrollState}
        onwheel={stopFollowingLatestMessageLayout}
        ontouchmove={stopFollowingLatestMessageLayout}
        onpointerdown={stopFollowingLatestMessageLayout}
      >
        <div class="message-feed-content" bind:this={messageFeedContent}>
        {#if selectedMessages.length > 0 || selectedInboundTransfers.length > 0}
          {#each selectedMessages as message (message.id)}
            {@const displayStatus = chatMessageDisplayStatus(message)}
            {@const isOpenedUnread = openedUnreadMessageIds.includes(message.id)}
            <div
              class="message-bubble"
              class:outgoing={chatMessageDirection(message) === 'outgoing'}
              class:incoming={chatMessageDirection(message) === 'incoming'}
              class:has-new={isOpenedUnread}
              role="button"
              tabindex="0"
              aria-haspopup="menu"
              aria-label={$t('chat.message.actions.open', { message: chatMessagePreview(message) })}
              use:contextMenuTrigger={{
                onopen: (x, y) => openMessageActions(message, x, y),
                openOnActivate: true,
              }}
            >
              {#if isOpenedUnread}
                <span class="message-new-badge">{$t('chat.message.new')}</span>
              {/if}
              <div class="message-copy">
                {#if message.title}<strong>{message.title}</strong>{/if}
                {#if message.content}<p>{message.content}</p>{/if}
              </div>
              {#if message.attachments?.length}
                <div class="message-attachments">
                  {#each message.attachments as attachment, index (`${attachment.name}:${index}`)}
                    <MessageAttachment {attachment} onlayout={() => attachmentLayoutReady(message.id)} />
                  {/each}
                </div>
                {#if chatMessageDirection(message) === 'outgoing'
                  && (displayStatus === 'queued' || displayStatus === 'sending')}
                  {@const attachmentSize = chatAttachmentBytes(message.attachments)}
                  {@const percent = transferPercent(message.progress)}
                  <div class="chat-transfer-progress" aria-live="polite">
                    <div>
                      <span>{$t('chat.attachment.uploading')}</span>
                      <span>{$t('chat.attachment.progress', {
                        percent,
                        size: formatChatByteSize(attachmentSize),
                      })}</span>
                    </div>
                    <progress value={percent} max="100" aria-label={$t('chat.attachment.uploading')}></progress>
                  </div>
                {/if}
              {/if}
              <footer>
                <time>{displayDate(message)}</time>
                {#if chatMessageDirection(message) === 'incoming'
                  && message.verification
                  && message.verification !== 'valid'
                  && message.verification !== 'verified'}
                  <span
                    class="message-verification-badge"
                    class:invalid={message.verification === 'invalid'}
                  >
                    {$t(verificationKeys[message.verification] ?? 'chat.message.verification.unverified')}
                  </span>
                {/if}
                {#if chatMessageDirection(message) === 'outgoing' && displayStatus}
                  <span class:failed={displayStatus === 'failed'}>
                    {#if displayStatus === 'sending' && message.attempts !== undefined && message.maxAttempts !== undefined}
                      {$t('chat.message.status.sendingAttempt', { attempt: message.attempts, max: message.maxAttempts })}
                    {:else if displayStatus === 'sent' && message.method === 'propagated'}
                      {$t('chat.message.status.sentToPropagationNode')}
                    {:else}
                      {$t(statusKeys[displayStatus])}
                    {/if}
                  </span>
                {/if}
              </footer>
            </div>
          {/each}
          {#each selectedInboundTransfers as transfer (transfer.id)}
            {@const percent = transferPercent(transfer.progress)}
            <div class="chat-inbound-transfer" aria-live="polite">
              <Icon name="download" size={18} />
              <div>
                <strong>{$t('chat.attachment.downloading')}</strong>
                <span>{$t('chat.attachment.progress', {
                  percent,
                  size: formatChatByteSize(transfer.dataSize),
                })}</span>
                <progress value={percent} max="100" aria-label={$t('chat.attachment.downloading')}></progress>
              </div>
            </div>
          {/each}
        {:else}
          <div class="conversation-detail-empty">
            <EmptyState icon="chat" title={$t('chat.detail.noMessages.title')} body={$t('chat.detail.noMessages.body')} />
          </div>
        {/if}
        </div>
      </div>
      {#if messageFeedScrollable && !messageFeedAtBottom}
        <button
          class="icon-button message-scroll-latest"
          type="button"
          title={$t('chat.messages.scrollToLatest')}
          aria-label={$t('chat.messages.scrollToLatest')}
          onclick={() => { void scrollToLatestMessage(); }}
        ><Icon name="chevron-down" size={20} /></button>
      {/if}
      </div>
      <form class="message-composer" onsubmit={sendMessage}>
        <input
          class="sr-only"
          bind:this={fileInput}
          type="file"
          multiple
          tabindex="-1"
          onchange={fileSelectionChanged}
        />
        {#if composerAttachments.length > 0}
          <div class="composer-attachments" aria-label={$t('chat.attachment.add')}>
            {#each composerAttachments as attachment, index (`${attachment.name}:${index}`)}
              <span>
                <Icon name={attachment.kind === 'image' ? 'image' : attachment.kind === 'audio' ? 'microphone' : 'file'} size={14} />
                <span>{attachment.name}</span>
                <button
                  type="button"
                  aria-label={$t('chat.attachment.remove', { name: attachment.name })}
                  onclick={() => removeAttachment(index)}
                ><Icon name="close" size={13} /></button>
              </span>
            {/each}
          </div>
        {/if}
        {#if attachmentMenuOpen && !recording}
          <div class="composer-attachment-menu" bind:this={attachmentMenu}>
            <button type="button" onclick={() => {
              attachmentMenuOpen = false;
              fileInput?.click();
            }}>
              <Icon name="file" size={17} />{$t('chat.attachment.addFile')}
            </button>
            <button type="button" onclick={() => {
              attachmentMenuOpen = false;
              void toggleRecording();
            }}>
              <Icon name="microphone" size={17} />{$t('chat.attachment.record')}
            </button>
          </div>
        {/if}
        <button
          class="icon-button composer-attachment-button"
          class:recording
          bind:this={attachmentMenuButton}
          type="button"
          disabled={selectedDestinationBlocked || sending}
          title={$t(recording ? 'chat.attachment.stopRecording' : 'chat.attachment.add')}
          aria-label={$t(recording ? 'chat.attachment.stopRecording' : 'chat.attachment.add')}
          onclick={() => recording ? toggleRecording() : attachmentMenuOpen = !attachmentMenuOpen
          }
        ><Icon name={recording ? 'stop' : 'paperclip'} size={18} /></button>
        <label>
          <span class="sr-only">{$t('chat.composer.label')}</span>
          <textarea
            bind:this={composerTextarea}
            bind:value={composerContent}
            rows="1"
            maxlength="65536"
            disabled={selectedDestinationBlocked}
            placeholder={$t(selectedDestinationBlocked ? 'chat.composer.blocked' : 'chat.composer.placeholder')}
            oninput={resizeComposer}
            onkeydown={composerKeydown}
          ></textarea>
        </label>
        <button
          class="icon-button primary"
          type="submit"
          disabled={selectedDestinationBlocked || sending || recording
            || (!composerContent.trim() && composerAttachments.length === 0)}
          title={$t('chat.composer.send')}
          aria-label={$t('chat.composer.send')}
        ><Icon name="send" size={18} /></button>
      </form>
    </section>
  {:else}
    <section class="conversation-empty">
      <div class="conversation-watermark" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <EmptyState icon="chat" title={$t('chat.detail.empty.title')} body={$t('chat.detail.empty.body')} />
    </section>
  {/if}
</div>

{#if contactEditorDestination}
  <ContactEditor
    address={contactEditorDestination}
    currentName={contactEditorContact?.name ?? contactEditorAnnounce?.displayName ?? ''}
    mode={contactEditorContact ? 'edit' : 'add'}
    oncancel={() => { contactEditorDestination = undefined; }}
    onsave={saveContact}
  />
{/if}

{#if messageActions}
  <ContextMenu
    x={messageActions.x}
    y={messageActions.y}
    label={$t('chat.message.actions.label')}
    closeLabel={$t('chat.message.actions.close')}
    onclose={() => { messageActions = undefined; }}
  >
    {#if chatMessageDirection(messageActions.message) === 'outgoing'
      && (chatMessageDisplayStatus(messageActions.message) === 'queued'
        || chatMessageDisplayStatus(messageActions.message) === 'sending')}
      <button role="menuitem" onclick={() => abortMessage(messageActions!.message)}>
        <Icon name="stop" size={17} />{$t('chat.message.actions.abort')}
      </button>
    {/if}
    {#if chatMessageDirection(messageActions.message) === 'outgoing'
      && !blockedDestinationHashes.has(messageActions.message.destinationHash)
      && chatMessageDisplayStatus(messageActions.message) === 'failed'}
      <button role="menuitem" onclick={() => retryMessage(messageActions!.message)}>
        <Icon name="sync" size={17} />{$t('chat.message.actions.retry')}
      </button>
    {/if}
    <button
      class="danger"
      role="menuitem"
      onclick={() => {
        deleteConfirmation = { kind: 'message', message: messageActions!.message };
        messageActions = undefined;
      }}
    >
      <Icon name="trash" size={17} />{$t('chat.message.actions.delete')}
    </button>
  </ContextMenu>
{/if}

{#if chatActions}
  <ContextMenu
    x={chatActions.x}
    y={chatActions.y}
    label={$t('chat.conversation.actions.label')}
    closeLabel={$t('chat.conversation.actions.close')}
    onclose={closeChatActions}
  >
    <button
      role="menuitem"
      onclick={() => { void copyDestinationHash(chatActions!.destinationHash); }}
    >
      <Icon name="copy" size={17} />{$t('chat.destination.actions.copyHash')}
    </button>
    <button
      role="menuitem"
      disabled={$pendingProbeDestinationHashes.has(chatActions.destinationHash)}
      onclick={() => { void probeDestination(chatActions!.destinationHash, chatActions!.displayName); }}
    >
      <Icon name="probe" size={17} />{$t('chat.destination.actions.probe')}
    </button>
    <button
      role="menuitem"
      onclick={() => openContactEditor(chatActions!.destinationHash)}
    >
      <Icon name={chatActionContact ? 'edit' : 'identity'} size={17} />
      {$t(chatActionContact ? 'chat.contact.editAction' : 'chat.contact.add')}
    </button>
    {#if chatActionContact}
      <button
        class="danger"
        role="menuitem"
        onclick={() => {
          const contactId = chatActionContact?.id;
          closeChatActions();
          if (contactId) void deleteContact(contactId);
        }}
      >
        <Icon name="trash" size={17} />{$t('chat.contact.removeAction')}
      </button>
    {/if}
    <button
      class:danger={!chatActions.blocked}
      role="menuitem"
      onclick={() => setDestinationBlocked(chatActions!.destinationHash, !chatActions!.blocked)}
    >
      <Icon name="block" size={17} />{$t(chatActions.blocked ? 'chat.unblock.action' : 'chat.block.action')}
    </button>
    {#if chatActionConversation && chatActionConversation.messageCount > 0}
      <button
        class="danger"
        role="menuitem"
        onclick={() => {
          deleteConfirmation = {
            kind: 'conversation',
            destinationHash: chatActions!.destinationHash,
            displayName: chatActions!.displayName,
          };
          closeChatActions();
        }}
      >
        <Icon name="trash" size={17} />{$t('chat.conversation.actions.delete')}
      </button>
    {/if}
  </ContextMenu>
{/if}

{#if deleteConfirmation}
  <ChatDeleteConfirmation
    kind={deleteConfirmation.kind}
    chatName={deleteConfirmation.kind === 'conversation' ? deleteConfirmation.displayName : ''}
    oncancel={() => { deleteConfirmation = undefined; }}
    onconfirm={() => deleteConfirmation?.kind === 'message'
      ? deleteMessage(deleteConfirmation.message)
      : deleteConfirmation?.kind === 'conversation'
        ? deleteConversation(deleteConfirmation.destinationHash)
        : Promise.resolve()}
  />
{/if}

{#if newConversationOpen}
  <NewConversationEditor
    oncancel={() => { newConversationOpen = false; }}
    onopen={(destinationHash) => {
      selectDestination(destinationHash);
      newConversationOpen = false;
    }}
  />
{/if}
