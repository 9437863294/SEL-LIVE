import type { CapacitorConfig } from '@capacitor/cli';
import { config as loadEnv } from 'dotenv';

loadEnv();

const appId = (process.env.CAPACITOR_APP_ID || 'com.sel.driver').trim();
const appName = (process.env.CAPACITOR_APP_NAME || 'SEL Driver').trim();
const startPath = (process.env.CAPACITOR_DRIVER_START_PATH || '/driver-management/mobile-hub').trim();
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
  ...(liveBaseUrl
    ? {
        server: {
          url: resolveMobileUrl(liveBaseUrl, startPath),
          cleartext: /^http:\/\//i.test(liveBaseUrl),
          androidScheme: 'https',
          allowNavigation: [new URL(resolveMobileUrl(liveBaseUrl, '/')).host],
        },
      }
    : {}),
};

export default config;
