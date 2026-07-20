import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'branding', 'icon.svg');
const source = await readFile(sourcePath);

const androidDensities = {
  mdpi: { legacy: 48, foreground: 108 },
  hdpi: { legacy: 72, foreground: 162 },
  xhdpi: { legacy: 96, foreground: 216 },
  xxhdpi: { legacy: 144, foreground: 324 },
  xxxhdpi: { legacy: 192, foreground: 432 },
};

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function write(path, data) {
  await ensureParent(path);
  await writeFile(path, data);
}

async function renderMark(size) {
  return sharp(source, { density: 384 })
    .resize(size, size, { fit: 'fill' })
    .png()
    .toBuffer();
}

async function renderOpaqueSquare(size) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: await renderMark(size), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function renderAdaptiveForeground(size) {
  const markSize = Math.round(size * 0.72);
  const offset = Math.floor((size - markSize) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: '#00000000' },
  })
    .composite([{ input: await renderMark(markSize), left: offset, top: offset }])
    .png()
    .toBuffer();
}

async function renderRound(size) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>` +
    '</svg>',
  );
  return sharp(await opaqueSquare(size))
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function macTileSvg(artwork = '') {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000" flood-opacity="0.20"/>
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.16"/>
        </filter>
        <clipPath id="tile-mask">
          <rect x="64" y="56" width="896" height="896" rx="208"/>
        </clipPath>
      </defs>
      <rect x="64" y="56" width="896" height="896" rx="208"
            fill="#fff" filter="url(#shadow)"/>
      ${artwork}
    </svg>
  `;
}

async function renderMacIcon() {
  const embeddedSource = `data:image/svg+xml;base64,${source.toString('base64')}`;
  const artwork =
    `<image href="${embeddedSource}" x="64" y="56" width="896" height="896" ` +
    'clip-path="url(#tile-mask)"/>';
  return sharp(Buffer.from(macTileSvg(artwork)), { density: 96 })
    .png()
    .toBuffer();
}

function createIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

function createIcns(images) {
  const entries = images.map(({ type, data }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}

const opaqueSquareCache = new Map();
async function opaqueSquare(size) {
  if (!opaqueSquareCache.has(size)) {
    opaqueSquareCache.set(size, renderOpaqueSquare(size));
  }
  return opaqueSquareCache.get(size);
}

await Promise.all([
  write(
    join(root, 'branding', 'icon-macos.svg'),
    Buffer.from(
      macTileSvg(
        '<image href="icon.svg" x="64" y="56" width="896" height="896" clip-path="url(#tile-mask)"/>',
      ),
    ),
  ),
  write(join(root, 'public', 'favicon-32x32.png'), await renderMark(32)),
  write(join(root, 'public', 'apple-touch-icon.png'), await opaqueSquare(180)),
  write(join(root, 'public', 'icon-192.png'), await renderMark(192)),
  write(join(root, 'public', 'icon-512.png'), await renderMark(512)),
  write(join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'), await opaqueSquare(1024)),
  write(join(root, 'electron', 'assets', 'icon.png'), await renderMark(512)),
]);

const faviconSizes = [16, 32, 48];
await write(
  join(root, 'public', 'favicon.ico'),
  createIco(await Promise.all(faviconSizes.map(async (size) => ({ size, data: await renderMark(size) })))),
);

for (const [density, sizes] of Object.entries(androidDensities)) {
  const directory = join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
  await Promise.all([
    write(join(directory, 'ic_launcher.png'), await opaqueSquare(sizes.legacy)),
    write(join(directory, 'ic_launcher_round.png'), await renderRound(sizes.legacy)),
    write(join(directory, 'ic_launcher_foreground.png'), await renderAdaptiveForeground(sizes.foreground)),
  ]);
}

const windowsSizes = [16, 24, 32, 48, 64, 128, 256];
await write(
  join(root, 'electron', 'assets', 'icon.ico'),
  createIco(await Promise.all(windowsSizes.map(async (size) => ({ size, data: await renderMark(size) })))),
);

const mac1024 = await renderMacIcon();
const macSizes = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
];
const macImages = await Promise.all(macSizes.map(async ([type, size]) => ({
  type,
  data: size === 1024 ? mac1024 : await sharp(mac1024).resize(size, size).png().toBuffer(),
})));
await Promise.all([
  write(join(root, 'electron', 'assets', 'icon-macos.png'), await sharp(mac1024).resize(512, 512).png().toBuffer()),
  write(join(root, 'electron', 'assets', 'icon.icns'), createIcns(macImages)),
]);

console.log('Generated Retivum icons from branding/icon.svg');
