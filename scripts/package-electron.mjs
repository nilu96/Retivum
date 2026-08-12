import {
  buildRenderer,
  rebuildElectronNoble,
  runPackageBinary,
} from './electron-build-helpers.mjs';

const builderArguments = process.argv.slice(2);
const targetPlatform = builderArguments.includes('--mac')
  ? 'darwin'
  : builderArguments.includes('--win')
    ? 'win32'
    : builderArguments.includes('--linux')
      ? 'linux'
      : process.platform;

if (targetPlatform !== process.platform) {
  throw new Error('Desktop packages must be built on their target platform');
}

await rebuildElectronNoble(targetPlatform);
await buildRenderer();
await runPackageBinary('electron-builder', 'electron-builder', [
  ...builderArguments,
  '--publish',
  'never',
], {
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
  },
});
