import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.nilu96.retivum',
  appName: 'Retivum',
  webDir: 'dist',
  backgroundColor: '#0b0f0c',
  bundledWebRuntime: false,
  loggingBehavior: 'none',
  android: {
    zoomEnabled: false,
  },
  ios: {
    zoomEnabled: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
};

export default config;
