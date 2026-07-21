<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';

  let {
    x,
    y,
    label,
    closeLabel,
    onclose,
    children,
  }: {
    x: number;
    y: number;
    label: string;
    closeLabel: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  let menu = $state<HTMLDivElement>();
  let left = $state(12);
  let top = $state(12);
  const viewportMargin = 12;

  function placeMenu(): void {
    if (!menu) return;
    left = Math.max(viewportMargin, Math.min(x, window.innerWidth - menu.offsetWidth - viewportMargin));
    top = Math.max(viewportMargin, Math.min(y, window.innerHeight - menu.offsetHeight - viewportMargin));
  }

  $effect(() => {
    x;
    y;
    menu;
    void tick().then(placeMenu);
  });

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onclose();
    };
    const handleResize = () => placeMenu();
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    void tick().then(() => menu?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus());
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  });
</script>

<button class="context-menu-dismiss" aria-label={closeLabel} onclick={onclose}></button>
<div
  bind:this={menu}
  class="context-menu"
  role="menu"
  aria-label={label}
  style:left={`${left}px`}
  style:top={`${top}px`}
>
  {@render children()}
</div>
