<script lang="ts">
  import {
    provisioningFieldFlags,
    provisioningFieldTypes,
    type ProvisioningField,
    type ProvisioningValue,
  } from '../../domain/provisioning';
  import { t } from '../../i18n';
  import {
    parseProvisioningBytes,
    parseProvisioningBytesList,
    provisioningDisplayListValue,
    provisioningDisplayValue,
    provisioningFieldIsReadOnly,
    provisioningFieldIsSecret,
    provisioningFieldIsWriteOnly,
  } from './provisioning-editor';

  let {
    namespaceId,
    field,
    value,
    validationError,
    idPrefix = 'provisioning',
    onupdate,
    onvalidation,
    oncommand,
  }: {
    namespaceId: number;
    field: ProvisioningField;
    value: ProvisioningValue | undefined;
    validationError?: string;
    idPrefix?: string;
    onupdate: (value: ProvisioningValue) => void;
    onvalidation: (error?: string) => void;
    oncommand: () => void;
  } = $props();

  const validationId = $derived(`${idPrefix}-field-error-${namespaceId}-${field.id}`);

  function numericInputError(rawValue: string): string | undefined {
    if (rawValue.trim() === '') return $t('provisioning.field.validation.number');
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return $t('provisioning.field.validation.number');
    if (field.type === provisioningFieldTypes.integer && !Number.isInteger(parsed)) {
      return $t('provisioning.field.validation.integer');
    }
    const minimum = field.type === provisioningFieldTypes.integer ? field.minInteger : field.minFloat;
    const maximum = field.type === provisioningFieldTypes.integer ? field.maxInteger : field.maxFloat;
    if (minimum !== undefined && parsed < minimum) {
      return $t('provisioning.field.validation.minimum', { minimum });
    }
    if (maximum !== undefined && parsed > maximum) {
      return $t('provisioning.field.validation.maximum', { maximum });
    }
    return undefined;
  }

  function numericInputStep(): number | 'any' {
    if (field.type === provisioningFieldTypes.integer) return 1;
    return field.minFloat !== undefined
      && field.maxFloat !== undefined
      && field.minFloat >= 0
      && field.maxFloat <= 1
      ? 0.1
      : 'any';
  }

  function normalizedHexInput(rawValue: string): string | undefined {
    const normalized = rawValue.replace(/[\s,:-]/g, '');
    return /^[0-9a-f]*$/i.test(normalized) ? normalized : undefined;
  }

  function bytesInputError(rawValue: string): string | undefined {
    const normalized = normalizedHexInput(rawValue);
    if (normalized === undefined || normalized.length % 2 !== 0) {
      return $t('provisioning.field.bytesInvalid');
    }
    if (field.maxLength !== undefined && normalized.length / 2 > field.maxLength) {
      return $t('provisioning.field.validation.maxBytes', { maximum: field.maxLength });
    }
    return undefined;
  }

  function bytesListInputError(rawValue: string): string | undefined {
    const entries = rawValue.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
    if (field.maxCount !== undefined && field.maxCount > 0 && entries.length > field.maxCount) {
      return $t('provisioning.field.validation.maxEntries', { maximum: field.maxCount });
    }
    for (const entry of entries) {
      const normalized = normalizedHexInput(entry);
      if (normalized === undefined || normalized.length % 2 !== 0) {
        return $t('provisioning.field.bytesInvalid');
      }
      if (field.elementSize !== undefined && field.elementSize > 0
        && normalized.length / 2 !== field.elementSize) {
        return $t('provisioning.field.validation.elementBytes', { count: field.elementSize });
      }
    }
    return undefined;
  }

  function stringInputError(rawValue: string): string | undefined {
    return field.maxLength !== undefined && field.maxLength > 0 && rawValue.length > field.maxLength
      ? $t('provisioning.field.validation.maxCharacters', { maximum: field.maxLength })
      : undefined;
  }
</script>

<label
  class="field provisioning-field"
  class:read-only={provisioningFieldIsReadOnly(field)}
  class:invalid={Boolean(validationError)}
>
  <span>
    {field.name}
    {#if (field.flags & provisioningFieldFlags.rebootRequired) !== 0}
      <small>{$t('provisioning.field.reboot')}</small>
    {/if}
  </span>
  {#if provisioningFieldIsReadOnly(field)}
    <output>{provisioningDisplayValue(value)}</output>
  {:else if field.type === provisioningFieldTypes.boolean}
    <span class="toggle-row compact-toggle">
      <span><small>{value === true ? $t('provisioning.value.enabled') : $t('provisioning.value.disabled')}</small></span>
      <input type="checkbox" role="switch" checked={value === true} onchange={(event) => onupdate(event.currentTarget.checked)} />
    </span>
  {:else if field.type === provisioningFieldTypes.enumeration}
    <select value={provisioningDisplayValue(value)} onchange={(event) => {
      const index = field.enumValues?.findIndex((candidate) => provisioningDisplayValue(candidate) === event.currentTarget.value) ?? -1;
      if (index >= 0) onupdate(field.enumValues![index]);
    }}>
      {#each field.enumValues ?? [] as option, index}
        <option value={provisioningDisplayValue(option)}>{field.enumLabels?.[index] ?? provisioningDisplayValue(option)}</option>
      {/each}
    </select>
  {:else if field.type === provisioningFieldTypes.integer || field.type === provisioningFieldTypes.float}
    <input
      type="number"
      min={field.type === provisioningFieldTypes.integer ? field.minInteger : field.minFloat}
      max={field.type === provisioningFieldTypes.integer ? field.maxInteger : field.maxFloat}
      step={numericInputStep()}
      value={Number(value ?? 0)}
      aria-invalid={validationError ? 'true' : undefined}
      aria-describedby={validationError ? validationId : undefined}
      oninput={(event) => {
        const error = numericInputError(event.currentTarget.value);
        onvalidation(error);
        if (!error && Number.isFinite(event.currentTarget.valueAsNumber)) onupdate(event.currentTarget.valueAsNumber);
      }}
    />
  {:else if field.type === provisioningFieldTypes.bytes}
    <input
      value={provisioningDisplayValue(value)}
      aria-invalid={validationError ? 'true' : undefined}
      aria-describedby={validationError ? validationId : undefined}
      oninput={(event) => {
        const error = bytesInputError(event.currentTarget.value);
        onvalidation(error);
        if (!error) onupdate(parseProvisioningBytes(event.currentTarget.value));
      }}
    />
  {:else if field.type === provisioningFieldTypes.bytesList}
    <textarea
      rows="3"
      value={provisioningDisplayListValue(value)}
      aria-invalid={validationError ? 'true' : undefined}
      aria-describedby={validationError ? validationId : undefined}
      oninput={(event) => {
        const error = bytesListInputError(event.currentTarget.value);
        onvalidation(error);
        if (!error) onupdate(parseProvisioningBytesList(event.currentTarget.value));
      }}
    ></textarea>
  {:else if field.type === provisioningFieldTypes.void}
    <button class="button secondary compact" type="button" onclick={() => (
      provisioningFieldIsWriteOnly(field) ? oncommand() : onupdate(null)
    )}>{$t('provisioning.field.trigger')}</button>
  {:else}
    <input
      type={provisioningFieldIsSecret(field) ? 'password' : 'text'}
      maxlength={field.maxLength}
      value={typeof value === 'string' ? value : ''}
      placeholder={provisioningFieldIsSecret(field) ? $t('provisioning.field.secretPlaceholder') : undefined}
      aria-invalid={validationError ? 'true' : undefined}
      aria-describedby={validationError ? validationId : undefined}
      oninput={(event) => {
        const error = stringInputError(event.currentTarget.value);
        onvalidation(error);
        if (!error) onupdate(event.currentTarget.value);
      }}
    />
  {/if}
  {#if provisioningFieldIsWriteOnly(field) && field.type !== provisioningFieldTypes.void}
    <button
      class="button secondary compact provisioning-command-button"
      type="button"
      disabled={Boolean(validationError)}
      onclick={oncommand}
    >{$t('provisioning.command.send')}</button>
  {/if}
  {#if validationError}
    <small class="field-error" id={validationId} role="alert">{validationError}</small>
  {/if}
</label>
