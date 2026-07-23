import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';
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

    expect(screen.getByRole('switch', { name: /Only accept messages from contacts/ })).toBeInTheDocument();

    expect(screen.getByText('1'.repeat(32))).toBeInTheDocument();
    expect(screen.queryByText('3'.repeat(32))).not.toBeInTheDocument();
    expect(screen.queryByText('4'.repeat(32))).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('4'.repeat(32))).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('4'.repeat(32))).not.toBeInTheDocument();
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
