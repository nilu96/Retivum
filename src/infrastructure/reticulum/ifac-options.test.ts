import { describe, expect, it } from 'vitest';
import {
  createRNodeInterfaceDraft,
  createTcpInterfaceDraft,
  createUdpInterfaceDraft,
  createWebSocketInterfaceDraft,
  type InterfaceConfig,
} from '../../domain/settings';
import { leviculumIfacOptions } from './ifac-options';

describe('Leviculum IFAC options', () => {
  it('sends only credentials and the interface media class', () => {
    const interfaces: InterfaceConfig[] = [
      createRNodeInterfaceDraft('ble'),
      createWebSocketInterfaceDraft(),
      createTcpInterfaceDraft(),
      createUdpInterfaceDraft(),
    ];
    for (const config of interfaces) {
      config.ifac.networkName = 'field-network';
      config.ifac.passphrase = 'shared secret';
    }

    expect(leviculumIfacOptions(interfaces[0]!)).toEqual({
      ifac: {
        networkName: 'field-network',
        passphrase: 'shared secret',
        interfaceType: 'serial',
      },
    });
    for (const config of interfaces.slice(1)) {
      const options = leviculumIfacOptions(config);
      expect(options).toEqual({
        ifac: {
          networkName: 'field-network',
          passphrase: 'shared secret',
          interfaceType: 'network',
        },
      });
      expect(options.ifac).not.toHaveProperty('sizeBytes');
    }

    interfaces[1]!.ifac.sizeBytes = 31;
    expect(leviculumIfacOptions(interfaces[1]!).ifac).toMatchObject({ sizeBytes: 31 });
  });

  it('omits IFAC options when both credentials are empty', () => {
    expect(leviculumIfacOptions(createWebSocketInterfaceDraft())).toEqual({});
  });
});
