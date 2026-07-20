import type { InterfaceMode } from '../../domain/settings';

export type LeviculumInterfaceMode =
  | 'full'
  | 'pointtopoint'
  | 'access_point'
  | 'roaming'
  | 'boundary'
  | 'gateway';

/** Translate Retivum's persisted values to Leviculum's Python-compatible config strings. */
export function leviculumInterfaceMode(mode: InterfaceMode): LeviculumInterfaceMode {
  if (mode === 'pointToPoint') return 'pointtopoint';
  if (mode === 'accessPoint') return 'access_point';
  return mode;
}
