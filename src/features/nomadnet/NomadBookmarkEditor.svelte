<script lang="ts">
  import { t } from '../../i18n';
  import BookmarkEditor from '../../lib/components/BookmarkEditor.svelte';

  let {
    address,
    currentName = '',
    currentIdentifyBeforeLoad = false,
    mode = 'add',
    oncancel,
    onsave,
  }: {
    address: string;
    currentName?: string;
    currentIdentifyBeforeLoad?: boolean;
    mode?: 'add' | 'edit';
    oncancel: () => void;
    onsave: (name: string, identifyBeforeLoad: boolean) => Promise<boolean>;
  } = $props();

</script>

<BookmarkEditor
  {address}
  title={$t(mode === 'add' ? 'nomadnet.bookmark.editor.addTitle' : 'nomadnet.bookmark.editor.editTitle')}
  description={$t('nomadnet.bookmark.editor.description')}
  addressLabel={$t('nomadnet.bookmark.address')}
  nameLabel={$t('nomadnet.bookmark.name')}
  namePlaceholder={$t('nomadnet.bookmark.name.placeholder')}
  nameHelp={$t('nomadnet.bookmark.name.help')}
  saveErrorKey="nomadnet.bookmark.saveError"
  {currentName}
  {currentIdentifyBeforeLoad}
  identifyLabel={$t('nomadnet.bookmark.identifyBeforeLoad')}
  identifyHelp={$t('nomadnet.bookmark.identifyBeforeLoad.help')}
  {oncancel}
  {onsave}
/>
