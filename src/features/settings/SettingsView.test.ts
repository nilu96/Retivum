import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../../package.json';
import {
  activeIdentity,
  blockedChatDestinations,
  chatContacts,
  identities,
  knownDestinations,
  reticulumRuntime,
} from '../../infrastructure/reticulum/runtime';
import { clearToasts, toasts } from '../../lib/notifications/toasts';
import SettingsView from './SettingsView.svelte';

describe('SettingsView blocked destinations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearToasts();
    identities.set([]);
    activeIdentity.set(undefined);
    knownDestinations.set([]);
    chatContacts.set([]);
    blockedChatDestinations.set(Array.from({ length: 4 }, (_, index) => {
      const destinationHash = String(index + 1).repeat(32);
      return {
        id: `identity:${destinationHash}`,
        identityId: 'identity',
        destinationHash,
        blockedAt: `2026-07-16T10:0${index}:00.000Z`,
      };
    }));
  });

  it('copies an identity hash only from its hash and shows the copied toast', async () => {
    const identityHash = 'a'.repeat(32);
    identities.set([{
      id: 'identity-1',
      displayName: 'Alice',
      identityHashHex: identityHash,
      publicKeyHex: 'b'.repeat(128),
    }]);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(SettingsView);
      const copyTargets = screen.getAllByRole('button', { name: 'Copy identity hash for Alice' });
      expect(copyTargets).toHaveLength(1);
      expect(screen.getByText('Alice')).not.toHaveAttribute('role', 'button');

      await fireEvent.click(copyTargets[0]);
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(identityHash));
      expect(get(toasts).at(-1)).toMatchObject({ kind: 'success', messageKey: 'common.copied' });
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('requires a name when adding an identity instead of pre-filling a default', async () => {
    const currentIdentity = {
      id: 'identity-1',
      displayName: 'Alice',
      identityHashHex: 'a'.repeat(32),
      publicKeyHex: 'b'.repeat(128),
    };
    identities.set([currentIdentity]);
    activeIdentity.set(currentIdentity);
    const createIdentity = vi.spyOn(reticulumRuntime, 'createIdentity').mockResolvedValue(true);
    render(SettingsView);

    await fireEvent.click(screen.getByRole('button', { name: 'Add identity' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Add identity' })).toBeInTheDocument();
    const name = within(dialog).getByRole('textbox', { name: /Identity name/ });
    expect(name).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await fireEvent.input(name, { target: { value: 'Travel' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createIdentity).toHaveBeenCalledWith('Travel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for a display name before importing an identity', async () => {
    const currentIdentity = {
      id: 'identity-1',
      displayName: 'Alice',
      identityHashHex: 'a'.repeat(32),
      publicKeyHex: 'b'.repeat(128),
    };
    identities.set([currentIdentity]);
    activeIdentity.set(currentIdentity);
    const importIdentity = vi.spyOn(reticulumRuntime, 'importIdentity').mockResolvedValue(true);
    render(SettingsView);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const privateKey = Uint8Array.from({ length: 64 }, (_, index) => index);
    const file = {
      size: privateKey.byteLength,
      arrayBuffer: vi.fn().mockResolvedValue(privateKey.buffer),
    } as unknown as File;

    await fireEvent.change(fileInput!, { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Name imported identity' })).toBeInTheDocument();
    expect(importIdentity).not.toHaveBeenCalled();
    const name = within(dialog).getByRole('textbox', { name: /Identity name/ });
    expect(name).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled();

    await fireEvent.input(name, { target: { value: 'Imported travel identity' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(importIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: '' }),
      'Imported travel identity',
    ));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows two blocked destinations until the list is expanded', async () => {
    render(SettingsView);

    expect(screen.getByRole('switch', { name: /Only accept messages from contacts/ })).toBeInTheDocument();

    expect(screen.getByText('1'.repeat(32))).toBeInTheDocument();
    expect(screen.queryByText('3'.repeat(32))).not.toBeInTheDocument();
    expect(screen.queryByText('4'.repeat(32))).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('4'.repeat(32))).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('4'.repeat(32))).not.toBeInTheDocument();
  });

  it('adds one or more blocked destination hashes from the settings dialog', async () => {
    const blockDestination = vi.spyOn(reticulumRuntime, 'blockChatDestination').mockResolvedValue(true);
    render(SettingsView);
    const firstHash = 'a'.repeat(32);
    const secondHash = 'b'.repeat(32);

    const addButton = screen.getByRole('button', { name: 'Add destinations' });
    expect(addButton).toHaveClass('compact', 'blocked-destination-add-button');
    await fireEvent.click(addButton);
    expect(screen.getByRole('heading', { name: 'Add blocked destinations' })).toBeInTheDocument();
    await fireEvent.input(screen.getByRole('textbox', { name: /Destination hashes/ }), {
      target: { value: `${firstHash}\n${secondHash}` },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Block destinations' }));

    await waitFor(() => {
      expect(blockDestination).toHaveBeenNthCalledWith(1, firstHash);
      expect(blockDestination).toHaveBeenNthCalledWith(2, secondHash);
    });
    expect(screen.queryByRole('heading', { name: 'Add blocked destinations' })).not.toBeInTheDocument();
  });

  it('stops a blocked-destination batch on failure and leaves the dialog open', async () => {
    const blockDestination = vi.spyOn(reticulumRuntime, 'blockChatDestination')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    render(SettingsView);
    const hashes = ['c', 'd', 'e'].map((character) => character.repeat(32));

    await fireEvent.click(screen.getByRole('button', { name: 'Add destinations' }));
    await fireEvent.input(screen.getByRole('textbox', { name: /Destination hashes/ }), {
      target: { value: hashes.join('\n') },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Block destinations' }));

    await waitFor(() => expect(blockDestination).toHaveBeenCalledTimes(2));
    expect(blockDestination).not.toHaveBeenCalledWith(hashes[2]);
    expect(screen.getByRole('heading', { name: 'Add blocked destinations' })).toBeInTheDocument();
  });

  it('places the experimental network node setting after appearance', () => {
    render(SettingsView);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    const appearanceIndex = headings.indexOf('Appearance');
    const networkIndex = headings.indexOf('Network node');

    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(networkIndex).toBeGreaterThan(appearanceIndex);
    expect(headings).not.toContain('Reticulum logs');
    expect(screen.getByText('Experimental')).toBeInTheDocument();
  });

  it('offers notification, image handling, and message retention preferences in the Chat section', async () => {
    render(SettingsView);

    const notifications = screen.getByRole('combobox', {
      name: /In-app message notifications/,
    });
    const imageDownscaling = screen.getByRole('combobox', {
      name: /Image downscaling/,
    });
    const maximumEdge = screen.getByRole('spinbutton', { name: /Maximum image edge/ });
    const messageRetention = screen.getByRole('combobox', { name: /Delete old messages/ });
    const chatSection = screen.getByRole('heading', { name: 'Chat' }).closest('.settings-card');
    expect(chatSection?.querySelector('.chat-settings-grid')).toHaveClass('two-column');
    expect(notifications.closest('.field')).toHaveClass('chat-notification-mode');
    expect(imageDownscaling.closest('.field')).toHaveClass('chat-image-downscaling-mode');
    expect(maximumEdge.closest('.field')).toHaveClass('chat-image-max-edge');
    expect(messageRetention.closest('.field')).toHaveClass('chat-message-retention');
    expect(Array.from(chatSection?.querySelectorAll('.field') ?? []).map((field) => field.classList[1]))
      .toEqual([
        'chat-image-downscaling-mode',
        'chat-image-max-edge',
        'chat-notification-mode',
        'chat-message-retention',
      ]);
    expect(notifications).toHaveValue('all');
    expect(imageDownscaling).toHaveValue('ask');
    expect(maximumEdge).toHaveValue(1_500);
    expect(messageRetention).toHaveValue('0');
    expect(Array.from((messageRetention as HTMLSelectElement).options).map((option) => option.text)).toContain('After 3 days');
    expect(Array.from((messageRetention as HTMLSelectElement).options).map((option) => option.text)).not.toContain('After 1 year');

    await fireEvent.change(notifications, { target: { value: 'contacts' } });
    await fireEvent.change(imageDownscaling, { target: { value: 'automatic' } });
    await fireEvent.change(maximumEdge, { target: { value: '1200' } });
    await fireEvent.change(messageRetention, { target: { value: '2' } });
    expect(notifications).toHaveValue('contacts');
    expect(imageDownscaling).toHaveValue('automatic');
    expect(maximumEdge).toHaveValue(1_200);
    expect(messageRetention).toHaveValue('2');
  });

  it('credits its protocol foundations and shows the project package version', () => {
    render(SettingsView);

    expect(document.querySelector('.about-description')).toHaveTextContent(
      'Retivum is based on the Reticulum Network Stack (RNS) and powered by Leviculum.',
    );
    expect(screen.getByText(`Version ${packageJson.version}`)).toBeInTheDocument();
    expect(screen.getByText('Licensed under GNU AGPL-3.0-or-later.')).toBeInTheDocument();
    const reticulumLink = screen.getByRole('link', { name: 'Reticulum on GitHub' });
    const leviculumLink = screen.getByRole('link', { name: 'Leviculum on Codeberg' });
    expect(reticulumLink).toHaveAttribute(
      'href',
      'https://github.com/markqvist/Reticulum',
    );
    expect(leviculumLink).toHaveAttribute(
      'href',
      'https://codeberg.org/Lew_Palm/leviculum',
    );
    expect(reticulumLink.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(leviculumLink.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText(/Development build/)).not.toBeInTheDocument();
  });
});
