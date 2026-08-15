<script lang="ts">
  import { onMount, tick } from 'svelte';

  let {
    revertLabel,
    saveLabel,
    revertDisabled = false,
    saveDisabled = false,
    sticky = false,
    onrevert,
    onsave,
  }: {
    revertLabel: string;
    saveLabel: string;
    revertDisabled?: boolean;
    saveDisabled?: boolean;
    sticky?: boolean;
    onrevert: () => void | Promise<void>;
    onsave: () => void | Promise<void>;
  } = $props();

  let anchor: HTMLDivElement;
  let actions: HTMLDivElement;
  let docked = $state(false);

  onMount(() => {
    if (!sticky) return;
    let intersectionObserver: IntersectionObserver | undefined;
    let positionAnimation: Animation | undefined;
    let transitionSequence = 0;
    const setDocked = (nextDocked: boolean) => {
      if (docked === nextDocked) return;
      const previousBounds = actions.getBoundingClientRect();
      docked = nextDocked;
      const sequence = ++transitionSequence;
      void tick().then(() => {
        if (sequence !== transitionSequence || window.innerWidth >= 700) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const nextBounds = actions.getBoundingClientRect();
        const horizontalOffset = previousBounds.left - nextBounds.left;
        if (Math.abs(horizontalOffset) < 0.5 || typeof actions.animate !== 'function') return;
        positionAnimation?.cancel();
        positionAnimation = actions.animate([
          { transform: `translateX(${horizontalOffset}px)` },
          { transform: 'translateX(0)' },
        ], { duration: 180, easing: 'ease' });
      });
    };
    const updateHorizontalAnchor = () => {
      const bounds = anchor.getBoundingClientRect();
      anchor.style.setProperty('--provisioning-save-center', `${bounds.left + (bounds.width / 2)}px`);
      anchor.style.setProperty('--provisioning-save-width', `${bounds.width}px`);
      const editor = anchor.closest<HTMLElement>('.provisioning-editor-card');
      const bottomInset = editor && window.innerWidth >= 700
        ? Math.max(12, window.innerHeight - editor.getBoundingClientRect().bottom + 12)
        : 12;
      anchor.style.setProperty('--provisioning-save-bottom', `${bottomInset}px`);
    };
    const observeDockingPosition = () => {
      const actionBounds = actions.getBoundingClientRect();
      anchor.style.setProperty('--provisioning-save-height', `${actionBounds.height}px`);
      const bottomInset = Math.max(0, window.innerHeight - actionBounds.bottom);
      intersectionObserver?.disconnect();
      intersectionObserver = typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
          setDocked(entry.isIntersecting && entry.intersectionRatio >= 0.999);
        }, {
          rootMargin: `0px 0px -${bottomInset}px 0px`,
          threshold: [0, 1],
        });
      intersectionObserver?.observe(anchor);
    };
    const updateFloatingGeometry = () => {
      updateHorizontalAnchor();
      if (!docked) observeDockingPosition();
    };
    updateFloatingGeometry();
    window.addEventListener('resize', updateFloatingGeometry);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(updateFloatingGeometry);
    resizeObserver?.observe(anchor);
    return () => {
      window.removeEventListener('resize', updateFloatingGeometry);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      positionAnimation?.cancel();
    };
  });
</script>

<div
  bind:this={anchor}
  class:provisioning-save-anchor={sticky}
  class:is-docked={sticky && docked}
  class:is-floating={sticky && !docked}
>
  <div
    bind:this={actions}
    class="provisioning-status-actions provisioning-namespace-actions"
    class:provisioning-save-actions={sticky}
  >
    <button
      class="button secondary compact"
      type="button"
      disabled={revertDisabled}
      onclick={onrevert}
    >{revertLabel}</button>
    <button
      class="button primary compact"
      type="button"
      disabled={saveDisabled}
      onclick={onsave}
    >{saveLabel}</button>
  </div>
</div>
