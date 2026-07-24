import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeUserLocationPlugin = {
  start: (options: { userId: string }) => Promise<{ started: boolean }>;
  stop: () => Promise<{ stopped: boolean }>;
};

const NativeUserLocation = registerPlugin<NativeUserLocationPlugin>('NativeUserLocation');

export const isNativeAndroidUserLocationAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const startNativeAndroidUserLocation = async (userId: string) => {
  if (!isNativeAndroidUserLocationAvailable()) return false;
  await NativeUserLocation.start({ userId });
  return true;
};

export const stopNativeAndroidUserLocation = async () => {
  if (!isNativeAndroidUserLocationAvailable()) return false;
  await NativeUserLocation.stop();
  return true;
};
