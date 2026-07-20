import { describe, expect, it } from 'vitest';
import { interfaceModes } from '../../domain/settings';
import { leviculumInterfaceMode } from './interface-mode';

describe('Leviculum interface mode mapping', () => {
  it('maps every Retivum mode to a Python-compatible Leviculum config string', () => {
    expect(interfaceModes.map((mode) => [mode, leviculumInterfaceMode(mode)])).toEqual([
      ['full', 'full'],
      ['pointToPoint', 'pointtopoint'],
      ['accessPoint', 'access_point'],
      ['roaming', 'roaming'],
      ['boundary', 'boundary'],
      ['gateway', 'gateway'],
    ]);
  });
});
