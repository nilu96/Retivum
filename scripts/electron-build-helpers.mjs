import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const projectRoot = dirname(import.meta.dirname);

function packageBinary(packageName, binaryName) {
  const packagePath = resolve(projectRoot, 'node_modules', packageName, 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binaryName];
  if (!relative) throw new Error(`Package ${packageName} does not expose ${binaryName}`);
  return join(dirname(packagePath), relative);
}

export async function runNodeScript(script, args = [], options = {}) {
  return run(process.execPath, [script, ...args], options);
}

export async function runExecutable(executable, args = [], options = {}) {
  return run(executable, args, options);
}

export async function runPackageBinary(packageName, binaryName, args = [], options = {}) {
  return runNodeScript(packageBinary(packageName, binaryName), args, options);
}

export async function buildRenderer() {
  await runNodeScript(resolve(projectRoot, 'scripts/generate-icons.mjs'));
  await runPackageBinary('vite', 'vite', ['build']);
}

export async function rebuildElectronNoble(platform = process.platform) {
  if (platform !== 'darwin' && platform !== 'win32') {
    console.info(`Skipping Noble native rebuild on ${platform}; Retivum uses Noble's JavaScript D-Bus backend.`);
    return;
  }
  await runPackageBinary('@electron/rebuild', 'electron-rebuild', [
    '--force',
    '--build-from-source',
    '--only',
    '@stoprocent/noble',
  ]);
}

export function projectDirectory() {
  return projectRoot;
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}
