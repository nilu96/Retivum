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
  let viewportFrame: number | undefined;
  const viewportMargin = 12;
  const scrollKeys = new Set([' ', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp']);

  function placeMenu(): void {
    if (!menu) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const minimumLeft = viewportLeft + viewportMargin;
    const minimumTop = viewportTop + viewportMargin;
    const maximumLeft = Math.max(
      minimumLeft,
      viewportLeft + viewportWidth - menu.offsetWidth - viewportMargin,
    );
    const maximumTop = Math.max(
      minimumTop,
      viewportTop + viewportHeight - menu.offsetHeight - viewportMargin,
    );
    left = Math.max(minimumLeft, Math.min(x, maximumLeft));
    top = Math.max(minimumTop, Math.min(y, maximumTop));
  }

  function schedulePlacement(): void {
    if (viewportFrame !== undefined) cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = undefined;
      placeMenu();
    });
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
    const preventBackgroundScroll = (event: Event) => event.preventDefault();
    dismissalArmed = !guardOpeningRelease;
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', schedulePlacement);
    window.addEventListener('wheel', preventBackgroundScroll, { passive: false });
    window.addEventListener('touchmove', preventBackgroundScroll, { passive: false });
    window.visualViewport?.addEventListener('resize', schedulePlacement);
    window.visualViewport?.addEventListener('scroll', schedulePlacement);
    if (autofocus) {
      void tick().then(() => menu?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus());
    }
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('resize', schedulePlacement);
      window.removeEventListener('wheel', preventBackgroundScroll);
      window.removeEventListener('touchmove', preventBackgroundScroll);
      window.visualViewport?.removeEventListener('resize', schedulePlacement);
      window.visualViewport?.removeEventListener('scroll', schedulePlacement);
      if (viewportFrame !== undefined) cancelAnimationFrame(viewportFrame);
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
