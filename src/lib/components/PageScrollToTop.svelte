<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../i18n';
  import Icon from './Icon.svelte';

  let marker: HTMLSpanElement;
  let scrollContainer: HTMLElement | undefined;
  let visible = $state(false);

  onMount(() => {
    scrollContainer = marker.closest<HTMLElement>('main') ?? undefined;
    const updateVisibility = (): void => {
      visible = currentPageScrollTop() > 0;
    };
    scrollContainer?.addEventListener('scroll', updateVisibility, { passive: true });
    window.addEventListener('scroll', updateVisibility, { passive: true });
    const initialUpdateFrame = window.requestAnimationFrame(updateVisibility);
    return () => {
      window.cancelAnimationFrame(initialUpdateFrame);
      scrollContainer?.removeEventListener('scroll', updateVisibility);
      window.removeEventListener('scroll', updateVisibility);
      scrollContainer = undefined;
    };
  });

  function currentPageScrollTop(): number {
    return Math.max(
      scrollContainer?.scrollTop ?? 0,
      window.scrollY,
      document.documentElement.scrollTop,
      document.body.scrollTop,
    );
  }

  function scrollToTop(): void {
    visible = false;
    scrollContainer?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    if (window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }
  }
</script>

<span hidden aria-hidden="true" bind:this={marker}></span>
{#if visible}
  <button
    class="icon-button message-scroll-latest page-scroll-top"
    type="button"
    title={$t('common.scrollToTop')}
    aria-label={$t('common.scrollToTop')}
    onclick={scrollToTop}
  ><Icon name="chevron-up" size={20} /></button>
{/if}
