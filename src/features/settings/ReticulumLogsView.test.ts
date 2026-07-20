import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { reticulumLogs } from '../../infrastructure/reticulum/runtime';
import ReticulumLogsView from './ReticulumLogsView.svelte';

describe('ReticulumLogsView', () => {
  beforeEach(() => {
    reticulumLogs.set([
      {
        id: 'log-1',
        timestamp: '2026-07-16T12:00:00.000Z',
        level: 'info',
        source: 'runtime',
        code: 'RUNTIME_READY',
        details: { interfaces: 1 },
      },
      {
        id: 'log-2',
        timestamp: '2026-07-16T12:01:00.000Z',
        level: 'error',
        source: 'websocket',
        code: 'WEBSOCKET_CONNECTION_ERROR',
      },
    ]);
  });

  it('filters and clears current-session runtime logs', async () => {
    render(ReticulumLogsView);
    expect(screen.getByText('RUNTIME_READY')).toBeInTheDocument();
    expect(screen.getByText('WEBSOCKET_CONNECTION_ERROR')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Errors' }));
    expect(screen.queryByText('RUNTIME_READY')).not.toBeInTheDocument();
    expect(screen.getByText('WEBSOCKET_CONNECTION_ERROR')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Clear logs' }));
    expect(screen.getByRole('heading', { name: 'No matching log entries' })).toBeInTheDocument();
  });

  it('starts at the newest logs when opened', () => {
    document.documentElement.scrollTop = 480;
    document.body.scrollTop = 480;

    render(ReticulumLogsView);

    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });
});
