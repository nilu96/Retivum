import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import PathStatus from './PathStatus.svelte';

describe('PathStatus', () => {
  it('shows the current hop count for a known path', () => {
    render(PathStatus, {
      status: { destinationHash: 'a'.repeat(32), hasPath: true, hops: 2 },
    });

    expect(screen.getByLabelText('Known path: 2 hops')).toHaveTextContent('2');
  });

  it('shows an unavailable-route symbol when no path is known', () => {
    render(PathStatus, { status: undefined });

    expect(screen.getByLabelText('No current known path')).toBeInTheDocument();
  });

  it('shows a blocked symbol instead of the known hop count', () => {
    render(PathStatus, {
      status: { destinationHash: 'a'.repeat(32), hasPath: true, hops: 2 },
      blocked: true,
    });

    expect(screen.getByLabelText('Blocked destination')).not.toHaveTextContent('2');
    expect(screen.queryByLabelText('Known path: 2 hops')).not.toBeInTheDocument();
  });
});
