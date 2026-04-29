import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position, type PositionOptions } from '@capacitor/geolocation';
import { openAndroidAppSettings, openAndroidLocationSettings } from '@/lib/native-android-settings';

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

const hasGrantedPermission = (permissionStatus: Record<string, unknown>) =>
  permissionStatus.location === 'granted' || permissionStatus.coarseLocation === 'granted';

export const isNativeDriverApp = () => Capacitor.isNativePlatform();
export const isNativeAndroidDriverApp = () => isNativeDriverApp() && Capacitor.getPlatform() === 'android';

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
  options: PositionOptions,
  onSuccess: (position: DriverGeoPosition) => void,
  onError?: (error: DriverGeoError) => void
): Promise<DriverGeoWatchId> => {
  await ensureDriverGeolocation();

  if (isNativeDriverApp()) {
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
  if (typeof watchId === 'string') {
    await Geolocation.clearWatch({ id: watchId });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
};
