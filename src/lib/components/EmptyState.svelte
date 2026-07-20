<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  let {
    icon = 'inbox',
    title,
    body,
    hint,
  }: {
    icon?: IconName;
    title: string;
    body: string;
    hint?: string;
  } = $props();
</script>

<div class="empty-state">
  <div class="empty-icon"><Icon name={icon} size={26} /></div>
  <h2>{title}</h2>
  <p>{body}</p>
  {#if hint}<p class="empty-hint">{hint}</p>{/if}
</div>
