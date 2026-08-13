// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import initWasm, {
  ReticulumNode,
} from '../../../leviculum_wasm/leviculum_wasm.js';
import {
  announcePacketDestinationHash,
  shouldSuppressInterfaceOnlineAnnounce,
} from '../../domain/interface-announce';

describe('Leviculum interface-up announcement contract', () => {
  it('reannounces only destinations that were explicitly announced before the interface came online', async () => {
    const wasm = await readFile(new URL('../../../leviculum_wasm/leviculum_wasm_bg.wasm', import.meta.url));
    await initWasm({ module_or_path: wasm });
    const generated = ReticulumNode.generateIdentity() as {
      privateKey: Uint8Array;
    };
    const node = new ReticulumNode({
      identityPrivateKey: generated.privateKey,
      transportEnabled: false,
    });
    try {
      const lxmf = node.enableLxmf({
        enableRatchets: true,
        enablePropagationClient: true,
        inboundStampCost: 0,
      }) as {
        deliveryDestinationHash: Uint8Array;
        propagationDestinationHash: Uint8Array;
      };
      const runtimeId = node.addInterface({ name: 'test', mode: 'full' });
      const initialOutput = node.setInterfaceOnline(runtimeId, true) as {
        actions: Array<{
          packet: {
            packetType?: string;
            destinationHash?: Uint8Array | number[];
          };
        }>;
      };
      const deliveryHash = Buffer.from(lxmf.deliveryDestinationHash).toString('hex');
      const propagationHash = Buffer.from(lxmf.propagationDestinationHash).toString('hex');
      const initialActionsByHash = new Map(initialOutput.actions.map((action) => [
        announcePacketDestinationHash(action.packet),
        action,
      ]));

      expect(initialActionsByHash.has(deliveryHash)).toBe(false);
      expect(initialActionsByHash.has(propagationHash)).toBe(false);

      node.announceLxmf({
        displayName: 'Retivum',
        stampCost: 8,
        compressionSupported: true,
        interfaceIndex: runtimeId,
      });
      node.announce(lxmf.propagationDestinationHash);
      node.setInterfaceOnline(runtimeId, false);
      const reconnectOutput = node.setInterfaceOnline(runtimeId, true) as {
        actions: Array<{
          packet: {
            packetType?: string;
            destinationHash?: Uint8Array | number[];
          };
        }>;
      };
      const actionsByHash = new Map(reconnectOutput.actions.map((action) => [
        announcePacketDestinationHash(action.packet),
        action,
      ]));

      expect(actionsByHash.has(deliveryHash)).toBe(true);
      expect(actionsByHash.has(propagationHash)).toBe(true);
      expect(shouldSuppressInterfaceOnlineAnnounce(
        actionsByHash.get(deliveryHash)!.packet,
      )).toBe(true);
      expect(shouldSuppressInterfaceOnlineAnnounce(
        actionsByHash.get(propagationHash)!.packet,
      )).toBe(true);
    } finally {
      node.free();
    }
  });

  it('emits IFAC-finalized interface bytes that only a matching peer accepts', async () => {
    const wasm = await readFile(new URL('../../../leviculum_wasm/leviculum_wasm_bg.wasm', import.meta.url));
    await initWasm({ module_or_path: wasm });
    const senderIdentity = ReticulumNode.generateIdentity() as { privateKey: Uint8Array };
    const receiverIdentity = ReticulumNode.generateIdentity() as { privateKey: Uint8Array };
    const wrongIdentity = ReticulumNode.generateIdentity() as { privateKey: Uint8Array };
    const sender = new ReticulumNode({ identityPrivateKey: senderIdentity.privateKey });
    const receiver = new ReticulumNode({ identityPrivateKey: receiverIdentity.privateKey });
    const wrongReceiver = new ReticulumNode({ identityPrivateKey: wrongIdentity.privateKey });
    try {
      const matchingIfac = {
        networkName: 'field-network',
        passphrase: 'shared secret',
        interfaceType: 'network',
      };
      const senderInterface = sender.addInterface({ name: 'sender', ifac: matchingIfac });
      const receiverInterface = receiver.addInterface({ name: 'receiver', ifac: matchingIfac });
      const wrongInterface = wrongReceiver.addInterface({
        name: 'wrong',
        ifac: { ...matchingIfac, passphrase: 'wrong secret' },
      });
      sender.setInterfaceOnline(senderInterface, true);
      receiver.setInterfaceOnline(receiverInterface, true);
      wrongReceiver.setInterfaceOnline(wrongInterface, true);
      const destinationHash = sender.registerDestination({
        appName: 'retivum-test',
        aspects: ['ifac'],
      });
      const output = sender.announce(destinationHash) as {
        actions: Array<{ iface: number; data: Uint8Array; packet: { packetType?: string } }>;
      };

      expect(output.actions).toHaveLength(1);
      expect(output.actions[0]?.iface).toBe(senderInterface);
      expect(output.actions[0]!.data[0]! & 0x80).toBe(0x80);
      expect(output.actions[0]?.packet.packetType).toBe('announce');

      const accepted = receiver.receive(receiverInterface, output.actions[0]!.data) as {
        events: Array<{ type?: string }>;
      };
      const rejected = wrongReceiver.receive(wrongInterface, output.actions[0]!.data) as {
        events: Array<{ type?: string }>;
      };
      expect(accepted.events.some((event) => event.type === 'announceReceived')).toBe(true);
      expect(rejected.events.some((event) => event.type === 'announceReceived')).toBe(false);
    } finally {
      sender.free();
      receiver.free();
      wrongReceiver.free();
    }
  });
});
