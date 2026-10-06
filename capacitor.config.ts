import type { CapacitorConfig } from '@capacitor/cli';

// Changing the identity/origin can orphan local IndexedDB records. Keep stable.
const config: CapacitorConfig = {
  appId: 'ca.on.teacher.assessment',
  appName: 'Ontario Teacher Assessment',
  webDir: 'dist',
  loggingBehavior: 'none',
  server: { hostname: 'localhost', iosScheme: 'capacitor', allowNavigation: [] },
  ios: { webContentsDebuggingEnabled: false },
  plugins: { CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false } }
};
export default config;
