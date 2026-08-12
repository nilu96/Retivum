import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  buildRenderer,
  projectDirectory,
  rebuildElectronNoble,
  runExecutable,
} from './electron-build-helpers.mjs';

const require = createRequire(import.meta.url);

await rebuildElectronNoble();
await buildRenderer();

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
await runExecutable(
  require('electron'),
  [resolve(projectDirectory(), 'electron/main.mjs')],
  { env: environment },
);
