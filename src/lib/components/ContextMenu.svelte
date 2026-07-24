<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';

  let {
    x,
    y,
    autofocus,
    guardOpeningRelease,
    label,
    closeLabel,
    onclose,
    children,
  }: {
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
    label: string;
    closeLabel: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  let menu = $state<HTMLDivElement>();
  let left = $state(12);
  let top = $state(12);
  let dismissalArmed = false;
  const viewportMargin = 12;
  const scrollKeys = new Set([' ', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp']);

  function placeMenu(): void {
    if (!menu) return;
    left = Math.max(viewportMargin, Math.min(x, window.innerWidth - menu.offsetWidth - viewportMargin));
    top = Math.max(viewportMargin, Math.min(y, window.innerHeight - menu.offsetHeight - viewportMargin));
  }

  function dismissFromClick(event: MouseEvent): void {
    if (event.detail === 0 || dismissalArmed) {
      onclose();
      return;
    }
    dismissalArmed = true;
  }

  function armDismissal(): void {
    dismissalArmed = true;
  }

  $effect(() => {
    x;
    y;
    menu;
    void tick().then(placeMenu);
  });

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onclose();
        return;
      }
      const target = event.target;
      const activatesMenuButton = event.key === ' '
        && target instanceof HTMLElement
        && Boolean(target.closest('.context-menu'));
      if (scrollKeys.has(event.key) && !activatesMenuButton) event.preventDefault();
    };
    const handleResize = () => placeMenu();
    const preventBackgroundScroll = (event: Event) => event.preventDefault();
    dismissalArmed = !guardOpeningRelease;
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('wheel', preventBackgroundScroll, { passive: false });
    window.addEventListener('touchmove', preventBackgroundScroll, { passive: false });
    window.visualViewport?.addEventListener('resize', handleResize);
    if (autofocus) {
      void tick().then(() => menu?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus());
    }
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('wheel', preventBackgroundScroll);
      window.removeEventListener('touchmove', preventBackgroundScroll);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  });
</script>

<button
  class="context-menu-dismiss"
  aria-label={closeLabel}
  onpointerdown={armDismissal}
  onclick={dismissFromClick}
></button>
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
