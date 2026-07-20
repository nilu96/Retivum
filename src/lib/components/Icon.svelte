<script lang="ts">
  export type IconName =
    | 'chat'
    | 'nomadnet'
    | 'settings'
    | 'search'
    | 'plus'
    | 'arrow-left'
    | 'arrow-right'
    | 'chevron-down'
    | 'identity'
    | 'fingerprint'
    | 'network'
    | 'route'
    | 'route-off'
    | 'block'
    | 'interface'
    | 'radio'
    | 'send'
    | 'bookmark'
    | 'history'
    | 'shield'
    | 'palette'
    | 'info'
    | 'edit'
    | 'download'
    | 'upload'
    | 'check'
    | 'announce'
    | 'qr'
    | 'qr-scan'
    | 'copy'
    | 'inbox'
    | 'trash'
    | 'home'
    | 'sync'
    | 'paperclip'
    | 'image'
    | 'microphone'
    | 'stop'
    | 'file'
    | 'close';

  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'chat'}
    <path d="M7 18.5 3.5 21v-5A8.5 8.5 0 1 1 7 18.5Z" />
    <path d="M7.5 10h7M8.5 14h5" />
  {:else if name === 'nomadnet'}
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z" />
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3" />
    <path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.8-1.8l.9-1.9L15 4l-1.9.9a7 7 0 0 0-1.8-.8l-.8-2h-3l-.7 2a7 7 0 0 0-1.8.8L3.1 4 1 6.1 1.9 8a7 7 0 0 0-.8 1.8l-2 .7v3l2 .7A7 7 0 0 0 1.9 16L1 17.9 3.1 20l1.9-.9a7 7 0 0 0 1.8.8l.7 2h3l.8-2a7 7 0 0 0 1.8-.8l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .8-1.8l2-.7Z" transform="translate(3.81 1.08) scale(.91)" />
  {:else if name === 'search'}
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'arrow-left'}
    <path d="M19 12H5m5-5-5 5 5 5" />
  {:else if name === 'arrow-right'}
    <path d="M5 12h14m-5-5 5 5-5 5" />
  {:else if name === 'chevron-down'}
    <path d="m7 9 5 5 5-5" />
  {:else if name === 'identity'}
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  {:else if name === 'fingerprint'}
    <path d="M12 10a2 2 0 0 0-2 2c0 1-.1 2.5-.3 4" />
    <path d="M14 13.1c0 2.4 0 6.4-1 8.9" />
    <path d="M17.3 21c.1-.6.4-2.3.5-3" />
    <path d="M2 12A10 10 0 0 1 20 6" />
    <path d="M2 16h.01" />
    <path d="M21.8 16c.2-2 .1-5.4 0-6" />
    <path d="M5 19.5c.5-1.5 1-4 1-7.5A7 7 0 0 1 18 7.1" />
    <path d="M8.7 22c.2-.7.4-1.3.5-2" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  {:else if name === 'network'}
    <circle cx="12" cy="5" r="2" />
    <circle cx="5" cy="18" r="2" />
    <circle cx="19" cy="18" r="2" />
    <path d="m11 7-5 9m7-9 5 9M7 18h10" />
  {:else if name === 'route'}
    <circle cx="4" cy="19" r="2.7" />
    <circle cx="12" cy="12" r="2.7" />
    <circle cx="20" cy="5" r="2.7" />
    <path d="M6.7 19h1.8c1.9 0 3.5-1.6 3.5-3.5v-.8M12 9.3v-.8C12 6.6 13.6 5 15.5 5h1.8" />
  {:else if name === 'route-off'}
    <circle cx="4" cy="19" r="2.7" />
    <circle cx="12" cy="12" r="2.7" />
    <circle cx="20" cy="5" r="2.7" />
    <path d="M6.7 19h1.8c1.9 0 3.5-1.6 3.5-3.5v-.8M12 9.3v-.8C12 6.6 13.6 5 15.5 5h1.8M4 4l16 16" />
  {:else if name === 'block'}
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  {:else if name === 'interface'}
    <path d="M8 4v5m8-5v5M6 9h12v3a6 6 0 0 1-6 6v3m0-3a6 6 0 0 1-6-6V9Z" />
  {:else if name === 'radio'}
    <path d="M5 19 19 5M8 16h8M6 12a6 6 0 0 0 6 6m0-12a6 6 0 0 1 6 6" />
    <circle cx="12" cy="12" r="2" />
  {:else if name === 'send'}
    <path d="m3 11 18-8-8 18-2.5-7.5L3 11Z" />
    <path d="M10.5 13.5 21 3" />
  {:else if name === 'bookmark'}
    <path d="M6 3h12v18l-6-4-6 4V3Z" />
  {:else if name === 'history'}
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5m4-1v5l3 2" />
  {:else if name === 'shield'}
    <path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-5" />
  {:else if name === 'palette'}
    <path d="M12 3a9 9 0 0 0 0 18h1.5a1.8 1.8 0 0 0 0-3.6h-1a1.5 1.5 0 0 1 0-3h2.1A6.4 6.4 0 0 0 21 8c0-2.8-4-5-9-5Z" />
    <circle cx="7.5" cy="9" r=".8" fill="currentColor" /><circle cx="10.5" cy="6.5" r=".8" fill="currentColor" /><circle cx="15" cy="7" r=".8" fill="currentColor" />
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6m0-10h.01" />
  {:else if name === 'edit'}
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  {:else if name === 'download'}
    <path d="M12 3v12m-5-5 5 5 5-5M4 20h16" />
  {:else if name === 'upload'}
    <path d="M12 16V4m-5 5 5-5 5 5M4 20h16" />
  {:else if name === 'check'}
    <path d="m5 12 4 4L19 6" />
  {:else if name === 'announce'}
    <path d="M4 13V9l12-5v14L4 13Z" />
    <path d="M7 14v4.5a2 2 0 0 0 2 2h1V15m9-8a7 7 0 0 1 0 8" />
  {:else if name === 'qr'}
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zm4 4h3v3h-3zm0-4h3m-7 4v3h3" />
  {:else if name === 'qr-scan'}
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    <rect x="6" y="6" width="4.5" height="4.5" rx=".35" />
    <rect x="13.5" y="6" width="4.5" height="4.5" rx=".35" />
    <rect x="6" y="13.5" width="4.5" height="4.5" rx=".35" />
    <rect x="13.5" y="13.5" width="4.5" height="4.5" rx=".35" />
    <rect x="14.95" y="14.95" width="1.6" height="1.6" rx=".15" fill="currentColor" stroke="none" />
  {:else if name === 'copy'}
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  {:else if name === 'inbox'}
    <path d="M4 5h16l2 10v4H2v-4L4 5Z" />
    <path d="M2 15h6l1.5 2h5l1.5-2h6" />
  {:else if name === 'trash'}
    <path d="M4 7h16M9 7V4h6v3" />
    <path d="m18 7-1 14H7L6 7m4 4v6m4-6v6" />
  {:else if name === 'home'}
    <path d="m3 11 9-8 9 8" />
    <path d="M5 10v11h14V10M9 21v-7h6v7" />
  {:else if name === 'sync'}
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M8 16H3v5" />
  {:else if name === 'paperclip'}
    <path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.5 9.5a2 2 0 0 1-2.8-2.8l8.8-8.8" />
  {:else if name === 'image'}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9" r="1.5" />
    <path d="m4 17 5-5 4 4 2-2 5 5" />
  {:else if name === 'microphone'}
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
  {:else if name === 'stop'}
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  {:else if name === 'file'}
    <path d="M6 2h8l4 4v16H6V2Z" />
    <path d="M14 2v5h5" />
  {:else if name === 'close'}
    <path d="m6 6 12 12M18 6 6 18" />
  {/if}
</svg>
