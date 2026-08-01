import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentitySummary } from '../../domain/identity';
import { defaultAppPreferences } from '../../domain/settings';
import { BrowserSettingsRepository } from '../../infrastructure/database/settings-repository';
import {
  activeIdentity,
  appPreferences,
  reticulumRuntime,
} from '../../infrastructure/reticulum/runtime';
import OnboardingView from './OnboardingView.svelte';

const anonymous: IdentitySummary = {
  id: 'identity-1',
  displayName: 'Anonymous',
  identityHashHex: 'a'.repeat(32),
  publicKeyHex: 'b'.repeat(64),
};

describe('OnboardingView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    activeIdentity.set(anonymous);
    appPreferences.set(structuredClone(defaultAppPreferences));
  });

  it('guides the default identity through naming before interface selection', async () => {
    const updateName = vi.spyOn(reticulumRuntime, 'updateActiveIdentityDisplayName').mockResolvedValue(true);
    const onskip = vi.fn();
    render(OnboardingView, { onskip, oncomplete: vi.fn() });

    expect(screen.getByRole('heading', { name: 'What should people call you?' })).toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: /Identity name/ });
    await fireEvent.input(name, { target: { value: 'Anonymous' } });
    expect(screen.getByText('Choose a name other than Anonymous.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await fireEvent.input(name, { target: { value: 'Alice' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('heading', { name: 'Connect to Reticulum' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /WebSocket/ })).toBeInTheDocument();
    expect(updateName).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onskip).toHaveBeenCalledOnce();
    expect(updateName).not.toHaveBeenCalled();
  });

  it('saves a disabled first interface and applies it to the runtime', async () => {
    activeIdentity.set({ ...anonymous, displayName: 'Alice' });
    const saveInterface = vi.spyOn(BrowserSettingsRepository.prototype, 'saveInterface').mockResolvedValue();
    const applyConfiguration = vi.spyOn(reticulumRuntime, 'applyConfiguration').mockResolvedValue();
    const oncomplete = vi.fn();
    render(OnboardingView, { onskip: vi.fn(), oncomplete });

    await fireEvent.click(screen.getByRole('button', { name: /WebSocket/ }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Home relay' } });
    await fireEvent.click(screen.getByRole('switch', { name: 'Enable after saving' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveInterface).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Home relay',
      enabled: false,
      type: 'websocket',
    })));
    expect(applyConfiguration).toHaveBeenCalledWith(
      defaultAppPreferences,
      [expect.objectContaining({ name: 'Home relay', enabled: false })],
    );
    expect(screen.getByText('Interface configuration saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: "You're ready to use Retivum" })).toBeInTheDocument();
    expect(screen.getByText('Configuration saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Start messaging' }));
    expect(oncomplete).toHaveBeenCalledOnce();
  });

  it('commits the staged identity name when the first interface is saved', async () => {
    const saveInterface = vi.spyOn(BrowserSettingsRepository.prototype, 'saveInterface').mockResolvedValue();
    const updateName = vi.spyOn(reticulumRuntime, 'updateActiveIdentityDisplayName').mockResolvedValue(true);
    const applyConfiguration = vi.spyOn(reticulumRuntime, 'applyConfiguration').mockResolvedValue();
    render(OnboardingView, { onskip: vi.fn(), oncomplete: vi.fn() });

    await fireEvent.input(screen.getByRole('textbox', { name: /Identity name/ }), {
      target: { value: 'Alice' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await fireEvent.click(screen.getByRole('button', { name: /WebSocket/ }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Home relay' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('Alice'));
    expect(saveInterface).toHaveBeenCalledOnce();
    expect(applyConfiguration).toHaveBeenCalledOnce();
    expect(saveInterface.mock.invocationCallOrder[0]).toBeLessThan(updateName.mock.invocationCallOrder[0]);
    expect(updateName.mock.invocationCallOrder[0]).toBeLessThan(applyConfiguration.mock.invocationCallOrder[0]);
  });
});
