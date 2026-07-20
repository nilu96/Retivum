import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  blockedChatDestinations,
  chatAnnounces,
  chatContacts,
} from '../../infrastructure/reticulum/runtime';
import SettingsView from './SettingsView.svelte';

describe('SettingsView blocked destinations', () => {
  beforeEach(() => {
    chatAnnounces.set([]);
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

  it('shows two blocked destinations until the list is expanded', async () => {
    render(SettingsView);

    expect(screen.getByRole('switch', { name: /Only receive messages from contacts/ })).toBeInTheDocument();

    expect(screen.getByText('1'.repeat(32))).toBeInTheDocument();
    expect(screen.queryByText('3'.repeat(32))).not.toBeInTheDocument();
    expect(screen.queryByText('4'.repeat(32))).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('4'.repeat(32))).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('4'.repeat(32))).not.toBeInTheDocument();
  });

  it('places the experimental network node setting between appearance and logs', () => {
    render(SettingsView);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    const appearanceIndex = headings.indexOf('Appearance');
    const networkIndex = headings.indexOf('Network node');
    const logsIndex = headings.indexOf('Reticulum logs');

    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(networkIndex).toBeGreaterThan(appearanceIndex);
    expect(logsIndex).toBeGreaterThan(networkIndex);
    expect(screen.getByText('Experimental')).toBeInTheDocument();
  });
});
