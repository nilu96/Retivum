import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type {
  ChatMessageDirection,
  ChatMessageStamp,
} from '../../domain/chat';
import MessageDetailsDialog from './MessageDetailsDialog.svelte';

describe('MessageDetailsDialog delivery stamp presentation', () => {
  it.each([
    {
      direction: 'incoming',
      stamp: { status: 'requiredAccepted', cost: 12 },
      expected: 'Required and accepted — cost 12',
    },
    {
      direction: 'incoming',
      stamp: { status: 'ticket' },
      expected: 'Accepted using reply ticket',
    },
    {
      direction: 'incoming',
      stamp: { status: 'notRequired' },
      expected: 'Not required',
    },
    {
      direction: 'incoming',
      stamp: { status: 'notEvaluatedSourceUnknown' },
      expected: 'Not evaluated — source identity unknown',
    },
    {
      direction: 'outgoing',
      stamp: { status: 'calculating', cost: 9 },
      expected: 'Calculating — cost 9',
    },
    {
      direction: 'outgoing',
      stamp: { status: 'calculated', cost: 9 },
      expected: 'Calculated — cost 9',
    },
    {
      direction: 'outgoing',
      stamp: { status: 'ticket' },
      expected: 'Calculated using reply ticket',
    },
  ] satisfies Array<{
    direction: ChatMessageDirection;
    stamp: ChatMessageStamp;
    expected: string;
  }>)('shows “$expected” for a $direction message', ({ direction, stamp, expected }) => {
    render(MessageDetailsDialog, {
      message: {
        id: 'identity:message',
        identityId: 'identity',
        messageId: 'a'.repeat(64),
        sourceHash: 'b'.repeat(32),
        destinationHash: 'c'.repeat(32),
        title: '',
        content: 'Details',
        verification: direction === 'incoming' && stamp.status === 'notEvaluatedSourceUnknown'
          ? 'unverified'
          : 'valid',
        direction,
        receivedAt: '2026-07-28T12:00:00.000Z',
        stamp,
      },
      onclose: vi.fn(),
    });

    const details = within(screen.getByRole('dialog', { name: 'Message details' }));
    expect(details.getByText(expected)).toBeInTheDocument();
  });
});
