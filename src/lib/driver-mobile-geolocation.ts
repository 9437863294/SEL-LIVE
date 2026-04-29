import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation, type Position, type PositionOptions } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { Camera } from '@capacitor/camera';
import { Filesystem } from '@capacitor/filesystem';
import type {
  BackgroundGeolocationPlugin,
  CallbackError as BackgroundGeolocationError,
  Location as BackgroundLocation,
} from '@capacitor-community/background-geolocation';
import {
  openAndroidAppSettings,
  openAndroidBatteryOptimizationSettings,
  openAndroidLocationSettings,
} from '@/lib/native-android-settings';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export type DriverGeoPosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
};

export type DriverGeoError = {
  code?: string | number;
  message: string;
};

export type DriverGeoWatchId = string | number;

export type DriverGeoWatchOptions = PositionOptions & {
  backgroundMessage?: string;
  backgroundTitle?: string;
  distanceFilterMeters?: number;
  forceForegroundWatcher?: boolean;
};

const toNumberOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizePosition = (position: Position | GeolocationPosition): DriverGeoPosition => ({
  coords: {
    latitude: Number(position.coords.latitude),
    longitude: Number(position.coords.longitude),
    accuracy: Number(position.coords.accuracy || 0),
    altitude: toNumberOrNull(position.coords.altitude),
    altitudeAccuracy: toNumberOrNull(position.coords.altitudeAccuracy),
    heading: toNumberOrNull(position.coords.heading),
    speed: toNumberOrNull(position.coords.speed),
  },
  timestamp: Number(position.timestamp || Date.now()),
});

const normalizeBackgroundPosition = (position: BackgroundLocation): DriverGeoPosition => ({
  coords: {
    latitude: Number(position.latitude),
    longitude: Number(position.longitude),
    accuracy: Number(position.accuracy || 0),
    altitude: toNumberOrNull(position.altitude),
    altitudeAccuracy: toNumberOrNull(position.altitudeAccuracy),
    heading: toNumberOrNull(position.bearing),
    speed: toNumberOrNull(position.speed),
  },
  timestamp: Number(position.time || Date.now()),
});

const hasGrantedPermission = (permissionStatus: Record<string, unknown>) =>
  permissionStatus.location === 'granted' || permissionStatus.coarseLocation === 'granted';

export const isNativeDriverApp = () => Capacitor.isNativePlatform();
export const isNativeAndroidDriverApp = () => isNativeDriverApp() && Capacitor.getPlatform() === 'android';

export const ensureDriverConnectivity = async () => {
  if (!isNativeDriverApp()) return;
  const status = await Network.getStatus();
  if (!status.connected) {
    throw new Error('No internet connection detected. Please enable Wi-Fi or mobile data.');
  }
};

const ensureAndroidNotificationPermission = async () => {
  if (!isNativeAndroidDriverApp()) return;
  const checked = await LocalNotifications.checkPermissions();
  if (checked.display === 'granted') return;

  const requested = await LocalNotifications.requestPermissions();
  if (requested.display !== 'granted') {
    throw new Error('Notification permission is required for background trip tracking.');
  }
};

export const ensureDriverGeolocation = async () => {
  if (!isNativeDriverApp()) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('Geolocation is not supported on this device.');
    }
    return;
  }

  const checked = (await Geolocation.checkPermissions()) as unknown as Record<string, unknown>;
  if (hasGrantedPermission(checked)) return;

  const requested = (await Geolocation.requestPermissions()) as unknown as Record<string, unknown>;
  if (!hasGrantedPermission(requested)) {
    throw new Error('Location permission is required to start trip tracking.');
  }
};

export const ensureAndroidAlwaysLocationSetup = async () => {
  if (!isNativeAndroidDriverApp()) return;
  if (typeof window === 'undefined') return;

  const shouldOpenSettings = window.confirm(
    'For continuous trip tracking, set Location permission to "Allow all the time". Tap OK to open phone settings now.'
  );

  if (!shouldOpenSettings) {
    throw new Error('Please enable "Allow all the time" location permission to continue.');
  }

  const openedAppSettings = await openAndroidAppSettings();
  const openedLocationSettings = openedAppSettings ? false : await openAndroidLocationSettings();

  if (!openedLocationSettings && !openedAppSettings) {
    window.alert(
      [
        'Unable to open settings automatically.',
        'Please open phone Settings manually:',
        '1. Apps',
        '2. Select this app',
        '3. Permissions > Location',
        '4. Choose "Allow all the time"',
        'Then return and tap Start Trip again.',
      ].join('\n')
    );
    throw new Error('Open Android settings manually and enable "Allow all the time" location.');
  }

  window.alert(
    [
      'Phone settings opened.',
      'Set Location permission to "Allow all the time", then return and tap Start Trip again.',
    ].join('\n')
  );
  throw new Error('Enable "Allow all the time" location in Android settings, then tap Start Trip again.');
};

export const ensureAndroidBackgroundTrackingSetup = async () => {
  if (!isNativeAndroidDriverApp()) return;

  await ensureAndroidNotificationPermission();
  await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
  try {
    await Filesystem.requestPermissions();
  } catch (error) {
    // Some Android versions do not require explicit FS runtime permission.
  }

  if (typeof window !== 'undefined' && window.localStorage?.getItem('driver_bg_setup_done') === '1') {
    return;
  }

  // Open settings directly (without custom confirmation popup) so user can finish
  // required one-time device setup for background tracking reliability.
  const openedAppSettings = await openAndroidAppSettings();
  const openedLocationSettings = openedAppSettings ? false : await openAndroidLocationSettings();
  const openedBatterySettings = await openAndroidBatteryOptimizationSettings();

  if (!openedAppSettings && !openedLocationSettings && !openedBatterySettings) {
    throw new Error(
      'Unable to open Android settings automatically. Enable always-location and disable battery optimization manually.'
    );
  }
  if (typeof window !== 'undefined') {
    window.localStorage?.setItem('driver_bg_setup_done', '1');
  }
};

export const getCurrentDriverPosition = async (options: PositionOptions = {}) => {
  await ensureDriverGeolocation();

  if (isNativeDriverApp()) {
    const position = await Geolocation.getCurrentPosition(options);
    return normalizePosition(position);
  }

  return new Promise<DriverGeoPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(normalizePosition(position)),
      (error) => reject(error),
      options
    );
  });
};

export const watchDriverPosition = async (
  options: DriverGeoWatchOptions,
  onSuccess: (position: DriverGeoPosition) => void,
  onError?: (error: DriverGeoError) => void
): Promise<DriverGeoWatchId> => {
  await ensureDriverGeolocation();

  if (isNativeDriverApp()) {
    if (options.forceForegroundWatcher) {
      const watchId = await Geolocation.watchPosition(options, (position, error) => {
        if (error) {
          onError?.({
            code: String(error.code || ''),
            message: String(error.message || 'Unable to fetch live location.'),
          });
          return;
        }
        if (!position) return;
        onSuccess(normalizePosition(position));
      });
      return watchId;
    }

    const watcherId = await BackgroundGeolocation.addWatcher(
      {
        requestPermissions: false,
        stale: false,
        distanceFilter: Math.max(0, Number(options.distanceFilterMeters ?? 0)),
        backgroundMessage:
          String(options.backgroundMessage || '').trim() ||
          'Trip tracking is running in background for live driver location.',
        backgroundTitle: String(options.backgroundTitle || '').trim() || 'SEL Driver Trip Tracking',
      },
      (position?: BackgroundLocation, error?: BackgroundGeolocationError) => {
        if (error) {
          onError?.({
            code: String(error.code || ''),
            message: String(error.message || 'Unable to fetch background location.'),
          });
          return;
        }
        if (!position) return;
        onSuccess(normalizeBackgroundPosition(position));
      }
    );
    return watcherId;
  }

  return navigator.geolocation.watchPosition(
    (position) => onSuccess(normalizePosition(position)),
    (error) =>
      onError?.({
        code: error.code,
        message: error.message || 'Unable to fetch live location.',
      }),
    options
  );
};

export const clearDriverPositionWatch = async (watchId: DriverGeoWatchId | null) => {
  if (watchId === null || watchId === undefined) return;

  if (isNativeDriverApp() && typeof watchId === 'string') {
    try {
      await BackgroundGeolocation.removeWatcher({ id: watchId });
      return;
    } catch (error) {
      console.error('Failed removing background watcher, falling back to Geolocation.clearWatch', error);
    }
  }

  if (typeof watchId === 'string') {
    await Geolocation.clearWatch({ id: watchId });
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
};
