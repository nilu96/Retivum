<script lang="ts">
  import type {
    ProvisioningField,
    ProvisioningNamespace,
    ProvisioningValue,
  } from '../../domain/provisioning';
  import ProvisioningFieldEditor from './ProvisioningFieldEditor.svelte';
  import {
    provisioningNamespaceDepth,
    provisioningNamespaceTree,
  } from './provisioning-editor';

  let {
    namespaces,
    rootId,
    showRootHeading = false,
    idPrefix = 'provisioning',
    getvalue,
    getvalidation,
    onupdate,
    onvalidation,
    oncommand,
  }: {
    namespaces: readonly ProvisioningNamespace[];
    rootId: number;
    showRootHeading?: boolean;
    idPrefix?: string;
    getvalue: (namespaceId: number, field: ProvisioningField) => ProvisioningValue | undefined;
    getvalidation: (namespaceId: number, field: ProvisioningField) => string | undefined;
    onupdate: (namespaceId: number, field: ProvisioningField, value: ProvisioningValue) => void;
    onvalidation: (namespaceId: number, field: ProvisioningField, error?: string) => void;
    oncommand: (namespaceId: number, field: ProvisioningField) => void;
  } = $props();

  const visibleNamespaces = $derived(provisioningNamespaceTree(namespaces, rootId));
</script>

{#each visibleNamespaces as namespace (namespace.id)}
  {@const depth = Math.min(provisioningNamespaceDepth(namespaces, rootId, namespace.id), 3)}
  <section
    class="provisioning-namespace-section"
    class:depth-0={depth === 0}
    class:depth-1={depth === 1}
    class:depth-2={depth === 2}
    class:depth-3={depth >= 3}
  >
    {#if depth === 0 && showRootHeading}
      <h2 id={`${idPrefix}-namespace-${namespace.id}`}>{namespace.name}</h2>
    {:else if depth === 1}
      <h2 id={`${idPrefix}-namespace-${namespace.id}`}>{namespace.name}</h2>
    {:else if depth === 2}
      <h3 id={`${idPrefix}-namespace-${namespace.id}`}>{namespace.name}</h3>
    {:else if depth >= 3}
      <h4 id={`${idPrefix}-namespace-${namespace.id}`}>{namespace.name}</h4>
    {/if}
    {#if namespace.fields.length > 0}
      <div
        class="provisioning-namespace-fields"
        role="group"
        aria-label={depth === 0 ? namespace.name : undefined}
        aria-labelledby={depth === 0 ? undefined : `${idPrefix}-namespace-${namespace.id}`}
      >
        <div class="provisioning-field-grid">
          {#each namespace.fields as field (field.id)}
            <ProvisioningFieldEditor
              namespaceId={namespace.id}
              {field}
              value={getvalue(namespace.id, field)}
              validationError={getvalidation(namespace.id, field)}
              {idPrefix}
              onupdate={(value) => onupdate(namespace.id, field, value)}
              onvalidation={(error) => onvalidation(namespace.id, field, error)}
              oncommand={() => oncommand(namespace.id, field)}
            />
          {/each}
        </div>
      </div>
    {/if}
  </section>
{/each}
