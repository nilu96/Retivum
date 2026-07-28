<script lang="ts">
  import {
    chatMessageDirection,
    type ChatMessage,
  } from '../../domain/chat';
  import { createDateFormatter, locale, t, type MessageKey } from '../../i18n';
  import Icon from '../../lib/components/Icon.svelte';
  import ModalDialog from '../../lib/components/ModalDialog.svelte';

  let {
    message,
    onclose,
  }: {
    message: ChatMessage;
    onclose: () => void;
  } = $props();

  const timestampFormatter = $derived(createDateFormatter($locale, { timeStyle: 'medium' }));
  const direction = $derived(chatMessageDirection(message));
  const verificationKeys: Record<string, MessageKey> = {
    valid: 'chat.message.details.validation.verified',
    verified: 'chat.message.details.validation.verified',
    invalid: 'chat.message.verification.invalid',
    unverified: 'chat.message.verification.unverified',
  };
  function formattedTimestamp(timestamp: number | undefined): { display: string; iso: string } | undefined {
    if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
    const date = new Date(timestamp * 1_000);
    if (!Number.isFinite(date.getTime())) return undefined;
    return { display: timestampFormatter.format(date), iso: date.toISOString() };
  }

  function formattedIsoTimestamp(timestamp: string | undefined): { display: string; iso: string } | undefined {
    if (!timestamp) return undefined;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return undefined;
    return { display: timestampFormatter.format(date), iso: date.toISOString() };
  }

  const senderTimestamp = $derived(formattedTimestamp(message.timestamp));
  const receiverTimestamp = $derived(direction === 'incoming'
    ? formattedIsoTimestamp(message.receivedAt)
    : undefined);
  const pathHops = $derived(message.path
    ? $t(message.path.hops === 1 ? 'announce.hops.one' : 'announce.hops.other', {
      count: message.path.hops,
    })
    : undefined);

  function stampDescription(): string {
    if (!message.stamp) return $t('chat.message.details.unavailable');
    if (message.stamp.status === 'requiredAccepted') {
      return $t('chat.message.details.stamp.requiredAccepted', { cost: message.stamp.cost ?? 0 });
    }
    if (message.stamp.status === 'ticket') {
      return $t(direction === 'incoming'
        ? 'chat.message.details.stamp.ticketAccepted'
        : 'chat.message.details.stamp.ticketCalculated');
    }
    if (message.stamp.status === 'notRequired') {
      return $t('chat.message.details.stamp.notRequired');
    }
    if (message.stamp.status === 'notEvaluatedSourceUnknown') {
      return $t('chat.message.details.stamp.notEvaluatedSourceUnknown');
    }
    return $t(message.stamp.status === 'calculated'
      ? 'chat.message.details.stamp.calculated'
      : 'chat.message.details.stamp.calculating', { cost: message.stamp.cost ?? 0 });
  }

  function pathInterfaceDescription(): string {
    const name = message.path?.interfaceName ?? message.path?.interfaceId;
    if (!name) return $t('chat.message.details.unavailable');
    return message.path?.interfaceType
      ? `${name} (${$t(`status.interface.type.${message.path.interfaceType}`)})`
      : name;
  }
</script>

<ModalDialog
  titleId="chat-message-details-title"
  className="interface-editor message-details-dialog"
  {onclose}
>
  <header>
    <div class="section-icon"><Icon name="info" size={21} /></div>
    <div>
      <h2 id="chat-message-details-title">{$t('chat.message.details.title')}</h2>
      <p>{$t('chat.message.details.description')}</p>
    </div>
  </header>

  <div class="message-details-content">
    <dl class="message-details-list">
      <div class="message-details-wide">
        <dt>{$t('chat.message.details.messageId')}</dt>
        <dd><code>{message.messageId}</code></dd>
      </div>
      <div class="message-details-hash">
        <dt>{$t('chat.message.details.sourceHash')}</dt>
        <dd><code>{message.sourceHash}</code></dd>
      </div>
      <div class="message-details-hash">
        <dt>{$t('chat.message.details.destinationHash')}</dt>
        <dd><code>{message.destinationHash}</code></dd>
      </div>
      <div>
        <dt>{$t('chat.message.details.senderTimestamp')}</dt>
        <dd>
          {#if senderTimestamp}
            <time datetime={senderTimestamp.iso}>
              <span>{senderTimestamp.display}</span>
              <code>{senderTimestamp.iso}</code>
            </time>
          {:else}
            <span class="message-details-unavailable">{$t('chat.message.details.unavailable')}</span>
          {/if}
        </dd>
      </div>
      <div>
        <dt>{$t('chat.message.details.receiverTimestamp')}</dt>
        <dd>
          {#if receiverTimestamp}
            <time datetime={receiverTimestamp.iso}>
              <span>{receiverTimestamp.display}</span>
              <code>{receiverTimestamp.iso}</code>
            </time>
          {:else}
            <span class="message-details-unavailable">
              {$t(direction === 'outgoing'
                ? 'chat.message.details.receiverTimestampOutgoing'
                : 'chat.message.details.unavailable')}
            </span>
          {/if}
        </dd>
      </div>
      <div>
        <dt>{$t('chat.message.details.method')}</dt>
        <dd>{message.method
          ? $t(({
            direct: 'chat.message.details.method.direct',
            opportunistic: 'chat.message.details.method.opportunistic',
            propagated: 'chat.message.details.method.propagated',
            paper: 'chat.message.details.method.paper',
          } as Record<string, MessageKey>)[message.method] ?? 'chat.message.details.method.unknown')
          : $t('chat.message.details.unavailable')}</dd>
      </div>
      <div>
        <dt>{$t('chat.message.details.direction')}</dt>
        <dd>{$t(direction === 'incoming'
          ? 'chat.message.details.direction.incoming'
          : 'chat.message.details.direction.outgoing')}</dd>
      </div>
      <div class="message-details-wide">
        <dt>{$t('chat.message.details.pathInterface')}</dt>
        <dd>{pathInterfaceDescription()}</dd>
      </div>
      <div class="message-details-pair">
        <dt>{$t('chat.message.details.pathHops')}</dt>
        <dd>{pathHops ?? $t('chat.message.details.unavailable')}</dd>
      </div>
      <div class="message-details-pair">
        <dt>{$t('chat.message.details.attempts')}</dt>
        <dd>{direction === 'outgoing' && message.attempts !== undefined
          ? $t(message.attempts === 1
            ? 'chat.message.details.attempts.one'
            : 'chat.message.details.attempts.other', { count: message.attempts })
          : $t('chat.message.details.unavailable')}</dd>
      </div>
      <div class="message-details-pair">
        <dt>{$t('chat.message.details.signature')}</dt>
        <dd>{$t(direction === 'outgoing'
          ? 'chat.message.details.signature.signedLocally'
          : message.verification
            ? verificationKeys[message.verification] ?? 'chat.message.verification.unverified'
            : 'chat.message.details.unavailable')}</dd>
      </div>
      <div class="message-details-pair">
        <dt>{$t('chat.message.details.stamp')}</dt>
        <dd>{stampDescription()}</dd>
      </div>
    </dl>
  </div>
</ModalDialog>
