import type { CapacitorConfig } from '@capacitor/cli';
import { config as loadEnv } from 'dotenv';

loadEnv();

const appTarget = String(process.env.APP_TARGET || 'driver').trim().toLowerCase();
const isDriverTarget = appTarget !== 'full';

const defaultAppId = isDriverTarget ? 'com.sel.driver' : 'com.sel.full';
const defaultAppName = isDriverTarget ? 'SEL Driver' : 'SEL Live';
const defaultStartPath = isDriverTarget ? '/driver-management/mobile-hub' : '/';

const appId = (process.env.CAPACITOR_APP_ID || defaultAppId).trim();
const appName = (process.env.CAPACITOR_APP_NAME || defaultAppName).trim();
const startPath = (
  process.env.CAPACITOR_START_PATH ||
  process.env.CAPACITOR_DRIVER_START_PATH ||
  defaultStartPath
).trim();
const liveBaseUrl = (process.env.CAPACITOR_LIVE_URL || '').trim();

const resolveMobileUrl = (baseUrl: string, path: string) => {
  if (!baseUrl) return '';
  const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalizedPath, normalizedBaseUrl).toString();
};

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: 'public/mobile-shell',
  android: {
    useLegacyBridge: true,
  },
  ...(liveBaseUrl
    ? {
        server: {
          url: resolveMobileUrl(liveBaseUrl, startPath),
          cleartext: /^http:\/\//i.test(liveBaseUrl),
        },
      }
    : {}),
};

export default config;
