import type { InterfaceConfig } from '../../domain/settings';

export interface LeviculumIfacOptions {
  ifac?: {
    networkName?: string;
    passphrase?: string;
    interfaceType: 'serial' | 'network';
    sizeBytes?: number;
  };
}

export function leviculumIfacOptions(config: InterfaceConfig): LeviculumIfacOptions {
  const networkName = config.ifac.networkName || undefined;
  const passphrase = config.ifac.passphrase || undefined;
  return networkName || passphrase
    ? {
        ifac: {
          networkName,
          passphrase,
          interfaceType: config.type === 'rnode' ? 'serial' : 'network',
          ...(config.ifac.sizeBytes === undefined ? {} : { sizeBytes: config.ifac.sizeBytes }),
        },
      }
    : {};
}
