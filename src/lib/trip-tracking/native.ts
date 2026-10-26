import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { NativeGap, NativePermissions, NativePoint, NativeStatus } from './rules';

/**
 * The SEL Driver app's own trip recorder (android/app/src/main/java/com/sel/TripRecorder*.java,
 * contract in docs/BACKGROUND-TRACKING-PLAN.md §4): a foreground service that records fixes into
 * SQLite on the phone whether or not this WebView is alive.
 */
export interface TripRecorderPlugin {
  getPermissionStatus(): Promise<NativePermissions>;
  requestLocationPermission(): Promise<NativePermissions>;
  requestBackgroundLocationPermission(): Promise<NativePermissions>;
  requestNotificationPermission(): Promise<NativePermissions>;
  start(options: { tripId: string; kind: 'fleet' | 'own'; title: string; message: string; intervalMs?: number; distanceFilterM?: number; maxAccuracyM?: number }): Promise<{ started: boolean }>;
  stop(options: { tripId: string }): Promise<{ stopped: boolean; pending: number }>;
  resume(): Promise<{ resumed: boolean; tripId: string | null }>;
  getStatus(options?: { tripId?: string }): Promise<NativeStatus>;
  getPoints(options: { tripId: string; limit?: number }): Promise<{ points: NativePoint[] }>;
  markSynced(options: { tripId: string; upToId: number }): Promise<{ marked: number }>;
  getGaps(options: { tripId: string }): Promise<{ gaps: NativeGap[] }>;
  markGapsSynced(options: { tripId: string; upToId: number }): Promise<{ marked: number }>;
  purge(options?: { olderThanDays?: number }): Promise<{ deleted: number }>;
  addListener(event: 'fix', listener: (event: { tripId: string; id: number; recordedAt: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'trackingError', listener: (event: { tripId: string; code: string; message: string; consecutive: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'status', listener: (event: NativeStatus) => void): Promise<PluginListenerHandle>;
}

export interface BatteryOptimizationPlugin {
  isIgnoring(): Promise<{ ignoring: boolean }>;
  requestIgnore(): Promise<void>;
  openAppInfo(): Promise<void>;
  openOemSettings(): Promise<{ opened: 'oem' | 'appInfo'; component?: string }>;
}

export const TripRecorder = registerPlugin<TripRecorderPlugin>('TripRecorder');
export const BatteryOptimization = registerPlugin<BatteryOptimizationPlugin>('BatteryOptimization');

/**
 * True in an Android build that carries the recorder. The web code is shared by every installed APK,
 * so an older APK (and iOS, and the browser) answers false and keeps the in-app watcher.
 */
export const nativeTrackingAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('TripRecorder');

export const batteryPluginAvailable = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BatteryOptimization');
