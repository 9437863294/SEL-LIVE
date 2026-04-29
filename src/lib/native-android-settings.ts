import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeSettingsPlugin = {
  openAppSettings: () => Promise<void>;
  openLocationSettings: () => Promise<void>;
};

const NativeSettings = registerPlugin<NativeSettingsPlugin>('NativeSettings');

const isNativeAndroid = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const openAndroidAppSettings = async () => {
  if (!isNativeAndroid()) return false;
  try {
    await NativeSettings.openAppSettings();
    return true;
  } catch (error) {
    console.error('Failed to open Android app settings', error);
    return false;
  }
};

export const openAndroidLocationSettings = async () => {
  if (!isNativeAndroid()) return false;
  try {
    await NativeSettings.openLocationSettings();
    return true;
  } catch (error) {
    console.error('Failed to open Android location settings', error);
    return false;
  }
};
