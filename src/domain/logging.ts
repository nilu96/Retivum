export type ReticulumLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface ReticulumLogEntry {
  id: string;
  timestamp: string;
  level: ReticulumLogLevel;
  source: 'runtime' | 'wasm' | 'websocket' | 'persistence';
  code: string;
  details?: Record<string, string | number | boolean>;
}
