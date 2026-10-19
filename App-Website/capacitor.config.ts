import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.greenbiz.app',
  appName: 'GreenBiz',
  webDir: 'dist',
  android: { backgroundColor: '#F3F6F2', allowMixedContent: false },
  server: { androidScheme: 'https' },
};
export default config;
