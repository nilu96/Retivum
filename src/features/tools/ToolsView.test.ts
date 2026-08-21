import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ToolsView from './ToolsView.svelte';

describe('ToolsView', () => {
  it('lists the available and planned Reticulum tools', () => {
    render(ToolsView);

    expect(screen.getByRole('heading', { name: 'Remote provisioning' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Network visualizer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reticulum logs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Path management' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Destination hash generator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Probing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Status details' })).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Path management',
      'Network visualizer',
      'Status details',
      'Probing',
      'Remote provisioning',
      'Destination hash generator',
      'Reticulum logs',
    ]);
  });

  it('opens the network visualizer', async () => {
    render(ToolsView);

    await fireEvent.click(screen.getByRole('button', { name: /Network visualizer/ }));
    expect(window.location.hash).toBe('#/network-visualizer');
  });

  it('opens the implemented provisioning tool', async () => {
    render(ToolsView);

    await fireEvent.click(screen.getByRole('button', { name: /Remote provisioning/ }));
    expect(window.location.hash).toBe('#/provisioning');
  });

  it('opens Reticulum logs', async () => {
    render(ToolsView);

    await fireEvent.click(screen.getByRole('button', { name: /Reticulum logs/ }));
    expect(window.location.hash).toBe('#/logs');
  });

  it('opens Status details', async () => {
    render(ToolsView);

    await fireEvent.click(screen.getByRole('button', { name: /Status details/ }));
    expect(window.location.hash).toBe('#/status');
  });

  it('opens the probing tool', async () => {
    render(ToolsView);

    await fireEvent.click(screen.getByRole('button', { name: /Probing/ }));
    expect(window.location.hash).toBe('#/probe');
  });

  it('opens path management', async () => {
    render(ToolsView);

    await fireEvent.click(screen.getByRole('button', { name: /Path management/ }));
    expect(window.location.hash).toBe('#/path-management');
  });

  it('opens the destination hash generator', async () => {
    render(ToolsView);

    await fireEvent.click(screen.getByRole('button', { name: /Destination hash generator/ }));
    expect(window.location.hash).toBe('#/destination-hash');
  });
});
