<script lang="ts">
  import MicronParser from 'micron-parser';
  import { onMount } from 'svelte';
  import { nomadLinkFragment, type NomadRequestData } from '../../domain/nomadnet';
  import { t } from '../../i18n';

  interface Props {
    markup: string;
    onlink: (target: string, requestData: NomadRequestData) => void;
  }

  let { markup, onlink }: Props = $props();
  let pageElement: HTMLElement;

  function usesDarkTheme(): boolean {
    const preference = document.documentElement.dataset.theme;
    return preference === 'dark'
      || (preference !== 'light'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function renderMarkup(): void {
    const parser = new MicronParser(usesDarkTheme(), false);
    // The parser's fragment path sanitizes raw Micron lines before parsing and
    // therefore mistakes Micron input fields for HTML tags. Its HTML path
    // parses first and sanitizes the generated HTML, preserving those fields.
    const template = document.createElement('template');
    template.innerHTML = parser.convertMicronToHtml(markup);
    const fragment = template.content;
    for (const link of fragment.querySelectorAll<HTMLAnchorElement>('a[data-action="openNode"]')) {
      // Micron links are application navigation, never browser or script navigation.
      link.href = '#';
    }
    const container = fragment.firstElementChild;
    if (container) {
      const usedIds = new Set<string>();
      for (const element of Array.from(container.children)) {
        // Link labels often repeat the heading they point to. They must not claim
        // that heading's generated ID before the real destination is rendered.
        if (element.querySelector('a[data-action="openNode"]')) continue;
        const id = pageAnchorId(element.textContent ?? '');
        if (!id || usedIds.has(id)) continue;
        element.id = id;
        usedIds.add(id);
      }
    }
    pageElement.replaceChildren(fragment);
  }

  function pageAnchorId(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function scrollToFragment(fragment: string): void {
    const anchor = Array.from(pageElement.querySelectorAll<HTMLElement>('[id]'))
      .filter((element) => !element.querySelector('a[data-action="openNode"]'))
      .find((element) => element.id === fragment || pageAnchorId(element.textContent ?? '') === pageAnchorId(fragment));
    if (!anchor) return;
    anchor.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[data-action="openNode"]')
      : undefined;
    if (!target || !pageElement.contains(target)) return;
    event.preventDefault();
    const destination = target.dataset.destination;
    if (!destination) return;
    const fragment = nomadLinkFragment(destination);
    if (fragment) scrollToFragment(fragment);
    else onlink(destination, submittedFields(target));
  }

  function submittedFields(link: HTMLAnchorElement): NomadRequestData {
    const fieldSpec = link.dataset.fields;
    if (!fieldSpec) return {};
    const allFields = fieldSpec === '*';
    const selectedFields = new Set(fieldSpec.split('|').filter(Boolean));
    const requestData: NomadRequestData = {};
    for (const input of pageElement.querySelectorAll<HTMLInputElement>('input[name]')) {
      if (!allFields && !selectedFields.has(input.name)) continue;
      if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) continue;
      const key = `field_${input.name}`;
      if (input.type === 'checkbox' && requestData[key]) requestData[key] += `,${input.value}`;
      else requestData[key] = input.value;
    }
    return requestData;
  }

  $effect(() => {
    markup;
    if (pageElement) renderMarkup();
  });

  onMount(() => {
    pageElement.addEventListener('click', handleClick);
    return () => pageElement.removeEventListener('click', handleClick);
  });
</script>

<article
  class="micron-page"
  bind:this={pageElement}
  aria-label={$t('nomadnet.page.content')}
></article>

<style>
  .micron-page {
    position: relative;
    z-index: 1;
    min-width: 0;
    min-height: 100%;
    padding: clamp(18px, 3vw, 34px);
    overflow: auto;
    color: var(--text);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: .82rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .micron-page :global(> div) {
    min-height: 100%;
  }

  .micron-page :global(a[data-action="openNode"]) {
    cursor: pointer;
    text-underline-offset: 3px;
  }

  .micron-page :global(a[data-action="openNode"]:focus-visible) {
    border-radius: 3px;
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .micron-page :global(input) {
    max-width: 100%;
    min-height: 30px;
    margin-block: 2px;
    padding: 4px 7px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
  }
</style>
