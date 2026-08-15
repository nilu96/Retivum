import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CACHE_MILLISECONDS = 2_000;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
let cachedAt = 0;
let cachedDevices = [];

function normalizedUsbId(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{1,4}$/.test(normalized) ? normalized.padStart(4, '0') : undefined;
}

function normalizedName(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, 160);
  return normalized || undefined;
}

export function parseMacUsbDevices(value) {
  const devices = [];
  function visit(candidate) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    const vendorId = normalizedUsbId(candidate.vendor_id);
    const productId = normalizedUsbId(candidate.product_id);
    const name = normalizedName(candidate._name);
    if (vendorId && productId && name) devices.push({ name, vendorId, productId });
    for (const child of Object.values(candidate)) {
      if (child && typeof child === 'object') visit(child);
    }
  }
  visit(value);
  return devices;
}

export function parseWindowsUsbDevices(value) {
  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const devices = [];
  for (const entry of entries) {
    const identifier = typeof entry?.PNPDeviceID === 'string' ? entry.PNPDeviceID : '';
    const match = identifier.match(/^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i);
    const name = normalizedName(entry?.Name);
    if (match && name) devices.push({ name, vendorId: match[1].toLowerCase(), productId: match[2].toLowerCase() });
  }
  return devices;
}

async function enumerateMacUsbDevices() {
  const { stdout } = await execFileAsync(
    '/usr/sbin/system_profiler',
    ['SPUSBDataType', '-json'],
    { encoding: 'utf8', timeout: 3_000, maxBuffer: MAX_COMMAND_OUTPUT_BYTES },
  );
  return parseMacUsbDevices(JSON.parse(stdout));
}

async function enumerateLinuxUsbDevices() {
  const entries = await readdir('/sys/bus/usb/devices', { withFileTypes: true });
  const devices = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = `/sys/bus/usb/devices/${entry.name}`;
    try {
      const [vendorId, productId, name] = await Promise.all([
        readFile(`${directory}/idVendor`, 'utf8'),
        readFile(`${directory}/idProduct`, 'utf8'),
        readFile(`${directory}/product`, 'utf8'),
      ]);
      const normalizedVendor = normalizedUsbId(vendorId);
      const normalizedProduct = normalizedUsbId(productId);
      const normalizedProductName = normalizedName(name);
      return normalizedVendor && normalizedProduct && normalizedProductName
        ? { name: normalizedProductName, vendorId: normalizedVendor, productId: normalizedProduct }
        : undefined;
    } catch {
      return undefined;
    }
  }));
  return devices.filter(Boolean);
}

async function enumerateWindowsUsbDevices() {
  const script = [
    'Get-CimInstance Win32_PnPEntity',
    "Where-Object { $_.Status -eq 'OK' -and $_.PNPDeviceID -match '^USB\\\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}' }",
    'Select-Object Name,PNPDeviceID',
    'ConvertTo-Json -Compress',
  ].join(' | ');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 3_000, maxBuffer: MAX_COMMAND_OUTPUT_BYTES, windowsHide: true },
  );
  const trimmed = stdout.trim();
  return trimmed ? parseWindowsUsbDevices(JSON.parse(trimmed)) : [];
}

export async function enumerateConnectedUsbDevices(platform = process.platform, now = Date.now()) {
  if (now - cachedAt < CACHE_MILLISECONDS) return cachedDevices;
  let devices = [];
  try {
    if (platform === 'darwin') devices = await enumerateMacUsbDevices();
    else if (platform === 'linux') devices = await enumerateLinuxUsbDevices();
    else if (platform === 'win32') devices = await enumerateWindowsUsbDevices();
  } catch {
    devices = [];
  }
  cachedAt = now;
  cachedDevices = devices;
  return devices;
}
