import { describe, expect, it } from 'vitest';
import { parseMacUsbDevices, parseWindowsUsbDevices } from './serial-device-enumeration.mjs';

describe('desktop serial-device enumeration', () => {
  it('extracts USB product names and identifiers from macOS system information', () => {
    expect(parseMacUsbDevices({
      SPUSBDataType: [{
        _name: 'USB31Bus',
        _items: [{ _name: 'NRF52 DK', vendor_id: '0x239a', product_id: '0x8029' }],
      }],
    })).toEqual([{ name: 'NRF52 DK', vendorId: '239a', productId: '8029' }]);
  });

  it('extracts USB product names and identifiers from Windows PnP records', () => {
    expect(parseWindowsUsbDevices({
      Name: 'NRF52 DK (COM3)',
      PNPDeviceID: 'USB\\VID_239A&PID_8029\\EBDFF592974E6ABB',
    })).toEqual([{ name: 'NRF52 DK (COM3)', vendorId: '239a', productId: '8029' }]);
  });
});
