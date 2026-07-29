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
  it('suppresses all implicit announces before Retivum creates an enriched announce', async () => {
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
      const output = node.setInterfaceOnline(runtimeId, true) as {
        actions: Array<{
          packet: {
            packetType?: string;
            destinationHash?: Uint8Array | number[];
          };
        }>;
      };
      const deliveryHash = Buffer.from(lxmf.deliveryDestinationHash).toString('hex');
      const propagationHash = Buffer.from(lxmf.propagationDestinationHash).toString('hex');
      const actionsByHash = new Map(output.actions.map((action) => [
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
});
