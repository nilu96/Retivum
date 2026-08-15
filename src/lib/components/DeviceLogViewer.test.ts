import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeviceLogViewer from './DeviceLogViewer.svelte';

afterEach(cleanup);

describe('DeviceLogViewer', () => {
  it('filters plain device log lines by severity and text', async () => {
    render(DeviceLogViewer, {
      lines: [
        '[!!!] halted',
        '[ERR] radio failed',
        '[WRN] battery low',
        '[NOT] link changed',
        '[INF] radio ready',
        '[VRB] packet details',
        '[DBG] state details',
        '[---] trace point',
        '[...] memory sample',
        'unprefixed information',
      ],
      onclear: vi.fn(),
    });

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'unprefixed information',
      '[...] memory sample',
      '[---] trace point',
      '[DBG] state details',
      '[VRB] packet details',
      '[INF] radio ready',
      '[NOT] link changed',
      '[WRN] battery low',
      '[ERR] radio failed',
      '[!!!] halted',
    ]);

    const level = screen.getByLabelText('Minimum log level') as HTMLSelectElement;
    expect(Array.from(level.options, (option) => option.textContent)).toEqual([
      'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Verbose', 'Debug', 'Trace', 'All',
    ]);
    await fireEvent.change(level, { target: { value: '3' } });
    expect(screen.getByText('[!!!] halted')).toBeInTheDocument();
    expect(screen.getByText('[ERR] radio failed')).toBeInTheDocument();
    expect(screen.getByText('[WRN] battery low')).toBeInTheDocument();
    expect(screen.queryByText('[INF] radio ready')).not.toBeInTheDocument();
    expect(screen.queryByText('unprefixed information')).not.toBeInTheDocument();

    await fireEvent.change(level, { target: { value: '9' } });
    await fireEvent.input(screen.getByLabelText('Filter text'), { target: { value: 'RADIO' } });
    expect(screen.getByText('[ERR] radio failed')).toBeInTheDocument();
    expect(screen.getByText('[INF] radio ready')).toBeInTheDocument();
    expect(screen.queryByText('[WRN] battery low')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((screen.getByLabelText('Filter text') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('[WRN] battery low')).toBeInTheDocument();
  });
});
