<script lang="ts">
  import { t } from '../../i18n';
  import {
    nomadIdentificationPolicies,
    type NomadIdentificationPolicy,
  } from '../../domain/nomadnet';
  import BookmarkEditor from '../../lib/components/BookmarkEditor.svelte';

  let {
    address,
    currentName = '',
    currentIdentificationPolicy = 'never',
    destinationPolicySourceName,
    mode = 'add',
    oncancel,
    onsave,
  }: {
    address: string;
    currentName?: string;
    currentIdentificationPolicy?: NomadIdentificationPolicy;
    destinationPolicySourceName?: string;
    mode?: 'add' | 'edit';
    oncancel: () => void;
    onsave: (address: string, name: string, policy: NomadIdentificationPolicy) => Promise<boolean>;
  } = $props();

  const identificationOptions = $derived(nomadIdentificationPolicies.map((value) => ({
    value,
    label: $t(`nomadnet.bookmark.identification.${value}.label`),
    help: $t(`nomadnet.bookmark.identification.${value}.help`),
  })));

</script>

<BookmarkEditor
  {address}
  title={$t(mode === 'add' ? 'nomadnet.bookmark.editor.addTitle' : 'nomadnet.bookmark.editor.editTitle')}
  description={$t('nomadnet.bookmark.editor.description')}
  addressLabel={$t('nomadnet.bookmark.address')}
  copyAddressLabel={$t('nomadnet.bookmark.copyAddress')}
  nameLabel={$t('nomadnet.bookmark.name')}
  namePlaceholder={$t('nomadnet.bookmark.name.placeholder')}
  nameHelp={$t('nomadnet.bookmark.name.help')}
  saveErrorKey="nomadnet.bookmark.saveError"
  {currentName}
  currentOption={currentIdentificationPolicy}
  optionLabel={$t('nomadnet.bookmark.identification.label')}
  optionNotice={destinationPolicySourceName
    ? $t('nomadnet.bookmark.identification.destinationInherited', {
        name: destinationPolicySourceName,
      })
    : undefined}
  options={identificationOptions}
  {oncancel}
  onsave={(savedAddress, name, policy) => onsave(
    savedAddress,
    name,
    nomadIdentificationPolicies.includes(policy as NomadIdentificationPolicy)
      ? policy as NomadIdentificationPolicy
      : 'never',
  )}
/>
