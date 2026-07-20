<script lang="ts">
  import Icon from './Icon.svelte';

  let { label, onclick }: { label: string; onclick: () => void } = $props();
</script>

<button class="icon-button modal-close-button" type="button" aria-label={label} title={label} {onclick}>
  <Icon name="close" size={20} />
</button>
