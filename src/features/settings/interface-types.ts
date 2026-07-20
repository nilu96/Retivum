import type { InterfaceType } from '../../domain/settings';
import type { MessageKey } from '../../i18n';
import type { IconName } from '../../lib/components/Icon.svelte';

export interface InterfaceTypeDescriptor {
  type: InterfaceType;
  title: MessageKey;
  description: MessageKey;
  icon: IconName;
}

export const interfaceTypeDescriptors: readonly InterfaceTypeDescriptor[] = [
  {
    type: 'websocket',
    title: 'settings.interfaces.type.websocket',
    description: 'settings.interfaces.type.websocket.description',
    icon: 'interface',
  },
  {
    type: 'rnode',
    title: 'settings.interfaces.type.rnode',
    description: 'settings.interfaces.type.rnode.description',
    icon: 'radio',
  },
  {
    type: 'tcp',
    title: 'settings.interfaces.type.tcp',
    description: 'settings.interfaces.type.tcp.description',
    icon: 'network',
  },
  {
    type: 'udp',
    title: 'settings.interfaces.type.udp',
    description: 'settings.interfaces.type.udp.description',
    icon: 'network',
  },
];
