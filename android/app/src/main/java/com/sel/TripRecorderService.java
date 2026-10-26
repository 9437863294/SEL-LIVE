package com.sel;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationAvailability;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.util.List;

/**
 * Records a trip's GPS route independently of the WebView: a location-type foreground service
 * (stopWithTask=false, START_STICKY) that filters fixes and buffers them in {@link TripPointStore}.
 * The app drains the buffer through {@link TripRecorderPlugin}. The active trip's config and health
 * live in SharedPreferences, so a system restart after a kill resumes the same trip.
 */
public class TripRecorderService extends Service {

    private static final String TAG = "TripRecorder";

    private static final String ACTION_START = "com.sel.action.START_TRIP_RECORDER";
    private static final String ACTION_STOP = "com.sel.action.STOP_TRIP_RECORDER";
    private static final String EXTRA_TRIP_ID = "tripId";

    static final String ERROR_NOT_AUTHORIZED = "NOT_AUTHORIZED";
    static final String ERROR_FOREGROUND_START_FAILED = "FOREGROUND_START_FAILED";
    static final String ERROR_LOCATION_UPDATES_FAILED = "LOCATION_UPDATES_FAILED";
    static final String ERROR_STORAGE_FAILED = "STORAGE_FAILED";

    static final long DEFAULT_INTERVAL_MS = 5_000L;
    static final float DEFAULT_DISTANCE_FILTER_M = 30f;
    static final float DEFAULT_MAX_ACCURACY_M = 50f;

    // Every key belongs to the active trip; stopping a trip clears the whole file.
    private static final String PREFS_NAME = "sel_trip_recorder";
    private static final String KEY_TRIP_ID = "tripId";
    private static final String KEY_KIND = "kind";
    private static final String KEY_TITLE = "title";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_INTERVAL_MS = "intervalMs";
    private static final String KEY_DISTANCE_FILTER_M = "distanceFilterM";
    private static final String KEY_MAX_ACCURACY_M = "maxAccuracyM";
    private static final String KEY_STARTED_AT = "startedAt";
    private static final String KEY_LAST_POINT_AT = "lastPointAt";
    private static final String KEY_LAST_POINT_LAT = "lastPointLatBits";
    private static final String KEY_LAST_POINT_LNG = "lastPointLngBits";
    private static final String KEY_LAST_FIX_AT = "lastFixAt";
    private static final String KEY_LAST_ACCURACY = "lastAccuracy";
    private static final String KEY_LAST_ALIVE_AT = "lastAliveAt";
    private static final String KEY_GPS_AVAILABLE = "gpsAvailable";
    private static final String KEY_CONSECUTIVE_ERRORS = "consecutiveErrors";
    private static final String KEY_LAST_ERROR_CODE = "lastErrorCode";
    private static final String KEY_LAST_ERROR_MESSAGE = "lastErrorMessage";
    private static final String KEY_LAST_ERROR_AT = "lastErrorAt";

    private static final String RECORDING_CHANNEL_ID = "sel_trip_recording";
    private static final String ALERT_CHANNEL_ID = "sel_trip_alerts";
    private static final int RECORDING_NOTIFICATION_ID = 28413;
    private static final int ALERT_NOTIFICATION_ID = 28414;

    private static final long HEARTBEAT_MS = 60_000L;
    private static final long GAP_THRESHOLD_MS = 5L * 60_000L;
    private static final float JITTER_DISTANCE_M = 5f;
    private static final long JITTER_TIME_MS = 5_000L;

    /** Receives recorder events on the main thread; {@link TripRecorderPlugin} registers in load(). */
    public interface Listener {
        void onTripFix(String tripId, long pointId, long recordedAt);

        void onTripError(@Nullable String tripId, String code, String message, int consecutive);

        void onTripStatusChanged();
    }

    private interface ListenerCall {
        void deliver(Listener target);
    }

    private static final Object STATE_LOCK = new Object();
    private static final Object LISTENER_LOCK = new Object();
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static Listener listener;
    private static volatile boolean recording = false;

    private SharedPreferences preferences;
    private TripPointStore store;
    private FusedLocationProviderClient fusedLocationClient;
    private HandlerThread workerThread;
    private volatile Handler worker;
    private LocationCallback locationCallback;
    private int latestStartId;
    private final Runnable heartbeat = this::runHeartbeat;

    // Recording state, guarded by "this".
    private TripConfig config;
    private boolean hasLastPoint = false;
    private long lastPointAt = 0L;
    private double lastPointLat = 0d;
    private double lastPointLng = 0d;

    // Plugin-facing API -----------------------------------------------------------------------

    public static void setListener(@Nullable Listener next) {
        synchronized (LISTENER_LOCK) {
            listener = next;
        }
    }

    public static void clearListener(Listener current) {
        synchronized (LISTENER_LOCK) {
            if (listener == current) {
                listener = null;
            }
        }
    }

    public static boolean isRecording() {
        return recording;
    }

    @Nullable
    public static String activeTripId(Context context) {
        String tripId = prefs(context).getString(KEY_TRIP_ID, null);
        return tripId == null || tripId.isEmpty() ? null : tripId;
    }

    /**
     * Saves a new trip (an already active same trip keeps its saved state) and starts the service.
     * @return false when a different trip is active; nothing is changed then.
     */
    public static boolean startTrip(
        Context context,
        String tripId,
        String kind,
        String title,
        String message,
        long intervalMs,
        float distanceFilterM,
        float maxAccuracyM
    ) {
        Context app = context.getApplicationContext();
        synchronized (STATE_LOCK) {
            SharedPreferences prefs = prefs(app);
            String active = activeTripId(app);
            if (active != null && !active.equals(tripId)) return false;

            boolean fresh = active == null;
            if (fresh) {
                prefs.edit()
                    .clear()
                    .putString(KEY_TRIP_ID, tripId)
                    .putString(KEY_KIND, kind)
                    .putString(KEY_TITLE, title)
                    .putString(KEY_MESSAGE, message)
                    .putLong(KEY_INTERVAL_MS, intervalMs)
                    .putFloat(KEY_DISTANCE_FILTER_M, distanceFilterM)
                    .putFloat(KEY_MAX_ACCURACY_M, maxAccuracyM)
                    .putLong(KEY_STARTED_AT, System.currentTimeMillis())
                    .commit();
            }

            try {
                ContextCompat.startForegroundService(app, startIntent(app, tripId));
            } catch (RuntimeException error) {
                if (fresh) {
                    prefs.edit().clear().commit();
                }
                throw error;
            }
            return true;
        }
    }

    /** Restarts the service for the saved trip when it is not running. */
    public static boolean resumeTrip(Context context) {
        Context app = context.getApplicationContext();
        synchronized (STATE_LOCK) {
            String active = activeTripId(app);
            if (active == null || recording) return false;
            ContextCompat.startForegroundService(app, startIntent(app, active));
            return true;
        }
    }

    /**
     * Ends the active trip: clears its saved state (the DB rows stay) and stops the service.
     * A null tripId stops whatever is active.
     * @return true when a trip was active and has been stopped.
     */
    public static boolean stopTrip(Context context, @Nullable String tripId) {
        Context app = context.getApplicationContext();
        synchronized (STATE_LOCK) {
            String active = activeTripId(app);
            if (tripId != null && active != null && !tripId.equals(active)) return false;

            prefs(app).edit().clear().commit();
            if (active != null || recording) {
                Intent stop = new Intent(app, TripRecorderService.class).setAction(ACTION_STOP);
                try {
                    // Delivered after any start still queued, so startForeground() has run first
                    // (stopping a service before that crashes the app).
                    app.startService(stop);
                } catch (RuntimeException notAllowed) {
                    // Background start refused: the service is not in the foreground, so a plain
                    // stop is safe.
                    app.stopService(stop);
                }
            }
            return active != null;
        }
    }

    public static Snapshot snapshot(Context context) {
        return new Snapshot(prefs(context));
    }

    /** Float to double without binary noise (12.4f becomes 12.4, not 12.399999618530273). */
    static double cleanDouble(float value) {
        return Double.parseDouble(Float.toString(value));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
    }

    private static Intent startIntent(Context context, String tripId) {
        return new Intent(context, TripRecorderService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_TRIP_ID, tripId);
    }

    private static void dispatch(ListenerCall call) {
        MAIN_HANDLER.post(() -> {
            Listener target;
            synchronized (LISTENER_LOCK) {
                target = listener;
            }
            // No listener: the WebView is gone and the rows wait in SQLite.
            if (target == null) return;
            try {
                call.deliver(target);
            } catch (RuntimeException error) {
                Log.w(TAG, "Trip recorder listener failed", error);
            }
        });
    }

    private static void dispatchStatus() {
        dispatch(Listener::onTripStatusChanged);
    }

    // Service lifecycle -----------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        preferences = prefs(this);
        store = TripPointStore.get(this);
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        latestStartId = startId;
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // stopTrip() already cleared the trip; a start queued behind this keeps the service.
            teardown();
            cancelAlert();
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        // A null intent is the system restarting us after a kill. Any other start came through
        // startForegroundService() and must reach startForeground() even when it then stops.
        boolean startedByApp = intent != null;
        TripConfig saved = TripConfig.load(preferences);
        String requestedTripId = intent == null ? null : intent.getStringExtra(EXTRA_TRIP_ID);
        if (saved == null || (requestedTripId != null && !requestedTripId.equals(saved.tripId))) {
            if (startedByApp) promoteQuietly(saved);
            teardown();
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        if (!hasLocationPermission()) {
            if (startedByApp) promoteQuietly(saved);
            fail(saved.tripId, ERROR_NOT_AUTHORIZED,
                "Location permission is off. Open SEL and allow location to keep recording this trip.");
            return START_NOT_STICKY;
        }

        try {
            startForegroundCompat(buildRecordingNotification(saved, null));
        } catch (RuntimeException error) {
            // Android 12+: ForegroundServiceStartNotAllowedException for a background (re)start.
            // Android 14+: SecurityException when the location type's permission is missing.
            Log.w(TAG, "startForeground refused", error);
            fail(saved.tripId, ERROR_FOREGROUND_START_FAILED,
                "Android stopped trip recording from running in the background. Open SEL to resume it.");
            return START_NOT_STICKY;
        }

        TripConfig current;
        synchronized (this) {
            current = config;
        }
        if (recording && current != null && current.tripId.equals(saved.tripId)) {
            // Same trip again: already recording. Put the status line back on the notification.
            Handler handler = worker;
            if (handler != null) handler.post(() -> refreshNotification(current));
            return START_STICKY;
        }

        beginRecording(saved);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        teardown();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // Recording -------------------------------------------------------------------------------

    private void beginRecording(TripConfig next) {
        teardownRecordingOnly();
        ensureWorker();
        synchronized (this) {
            config = next;
            hasLastPoint = false;
        }
        recording = true;

        // Queued before any fix: restores the filter state and records a gap if we were dead.
        worker.post(() -> restoreTripState(next));
        if (!requestLocationUpdates(next)) return;

        cancelAlert();
        worker.post(heartbeat);
        dispatchStatus();
    }

    private void restoreTripState(TripConfig c) {
        long now = System.currentTimeMillis();
        long restoredAt = preferences.getLong(KEY_LAST_POINT_AT, 0L);
        double restoredLat = Double.longBitsToDouble(preferences.getLong(KEY_LAST_POINT_LAT, 0L));
        double restoredLng = Double.longBitsToDouble(preferences.getLong(KEY_LAST_POINT_LNG, 0L));
        try {
            // prefs are written with apply(); after a hard kill the DB can be newer.
            TripPointStore.LastPoint stored = store.lastPoint(c.tripId);
            if (stored != null && stored.recordedAt > restoredAt) {
                restoredAt = stored.recordedAt;
                restoredLat = stored.lat;
                restoredLng = stored.lng;
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not read the last stored point", error);
        }
        synchronized (this) {
            if (config == c) {
                hasLastPoint = restoredAt > 0L;
                lastPointAt = restoredAt;
                lastPointLat = restoredLat;
                lastPointLng = restoredLng;
            }
        }

        long lastAliveAt = preferences.getLong(KEY_LAST_ALIVE_AT, 0L);
        if (lastAliveAt > 0L && now - lastAliveAt > GAP_THRESHOLD_MS) {
            try {
                store.insertGap(c.tripId, lastAliveAt, now);
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not record a tracking gap", error);
            }
        }
        preferences.edit()
            .putLong(KEY_LAST_ALIVE_AT, now)
            .putBoolean(KEY_GPS_AVAILABLE, true)
            .apply();
    }

    private boolean requestLocationUpdates(TripConfig c) {
        removeLocationUpdates();
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, c.intervalMs)
            .setMinUpdateIntervalMillis(Math.max(1_000L, c.intervalMs / 2L))
            .setMinUpdateDistanceMeters(c.distanceFilterM)
            .build();

        LocationCallback callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                // A batched result can carry several fixes; keep every one, oldest first.
                List<Location> locations = result.getLocations();
                for (Location location : locations) {
                    if (location != null) handleLocation(c, location);
                }
            }

            @Override
            public void onLocationAvailability(@NonNull LocationAvailability availability) {
                handleAvailability(c, availability.isLocationAvailable());
            }
        };
        locationCallback = callback;

        try {
            fusedLocationClient
                .requestLocationUpdates(request, callback, worker.getLooper())
                .addOnFailureListener(error -> {
                    if (locationCallback == callback) {
                        Log.w(TAG, "Location updates failed", error);
                        fail(c.tripId, ERROR_LOCATION_UPDATES_FAILED,
                            "Location updates could not start. Open SEL to resume trip recording.");
                    }
                });
            return true;
        } catch (SecurityException error) {
            locationCallback = null;
            fail(c.tripId, ERROR_NOT_AUTHORIZED,
                "Location permission was refused. Open SEL and allow location to keep recording this trip.");
            return false;
        }
    }

    // Worker thread.
    private void handleLocation(TripConfig c, Location location) {
        if (!recording) return;
        // A stop can land while this fix is in flight: never write into a trip that ended.
        if (!c.tripId.equals(preferences.getString(KEY_TRIP_ID, null))) return;

        long recordedAt = location.getTime();
        double lat = location.getLatitude();
        double lng = location.getLongitude();
        float accuracy = location.hasAccuracy() ? location.getAccuracy() : Float.NaN;

        // Every fix proves the GPS is alive, accepted or not.
        boolean wasUnavailable = !preferences.getBoolean(KEY_GPS_AVAILABLE, true);
        SharedPreferences.Editor health = preferences.edit()
            .putLong(KEY_LAST_FIX_AT, recordedAt)
            .putBoolean(KEY_GPS_AVAILABLE, true);
        if (Float.isNaN(accuracy)) {
            health.remove(KEY_LAST_ACCURACY);
        } else {
            health.putFloat(KEY_LAST_ACCURACY, accuracy);
        }
        health.apply();
        if (wasUnavailable) {
            refreshNotification(c);
            dispatchStatus();
        }

        // Accept rules, in order.
        if (Float.isNaN(accuracy) || accuracy > c.maxAccuracyM) return;
        if (Double.isNaN(lat) || Double.isNaN(lng) || (lat == 0d && lng == 0d)) return;

        long pointId;
        synchronized (this) {
            if (config != c) return;
            if (hasLastPoint) {
                if (recordedAt <= lastPointAt) return;
                float[] distance = new float[1];
                Location.distanceBetween(lastPointLat, lastPointLng, lat, lng, distance);
                if (distance[0] < JITTER_DISTANCE_M && recordedAt - lastPointAt < JITTER_TIME_MS) return;
            }

            try {
                pointId = store.insertPoint(
                    c.tripId,
                    "pt_" + c.tripId + "_" + recordedAt,
                    lat,
                    lng,
                    cleanDouble(accuracy),
                    location.hasSpeed() ? cleanDouble(location.getSpeed()) : null,
                    location.hasBearing() ? cleanDouble(location.getBearing()) : null,
                    location.hasAltitude() ? location.getAltitude() : null,
                    recordedAt
                );
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not store a trip point", error);
                int consecutive = recordError(ERROR_STORAGE_FAILED, "A trip point could not be saved on this phone.");
                dispatch(target -> target.onTripError(
                    c.tripId, ERROR_STORAGE_FAILED, "A trip point could not be saved on this phone.", consecutive));
                return;
            }

            hasLastPoint = true;
            lastPointAt = recordedAt;
            lastPointLat = lat;
            lastPointLng = lng;
        }

        preferences.edit()
            .putLong(KEY_LAST_POINT_AT, recordedAt)
            .putLong(KEY_LAST_POINT_LAT, Double.doubleToRawLongBits(lat))
            .putLong(KEY_LAST_POINT_LNG, Double.doubleToRawLongBits(lng))
            .putInt(KEY_CONSECUTIVE_ERRORS, 0)
            .apply();

        // -1: this clientPointId is already stored (a re-delivered fix); nothing new to drain.
        if (pointId > 0L) {
            dispatch(target -> target.onTripFix(c.tripId, pointId, recordedAt));
        }
    }

    // Worker thread. "No GPS fix" is a status, not an error.
    private void handleAvailability(TripConfig c, boolean available) {
        if (!recording) return;
        boolean previous = preferences.getBoolean(KEY_GPS_AVAILABLE, true);
        if (previous == available) return;
        preferences.edit().putBoolean(KEY_GPS_AVAILABLE, available).apply();
        refreshNotification(c);
        dispatchStatus();
    }

    // Worker thread.
    private void runHeartbeat() {
        TripConfig c;
        synchronized (this) {
            c = config;
        }
        if (!recording || c == null) return;
        preferences.edit().putLong(KEY_LAST_ALIVE_AT, System.currentTimeMillis()).apply();
        refreshNotification(c);
        dispatchStatus();
        Handler handler = worker;
        if (handler != null) {
            handler.postDelayed(heartbeat, HEARTBEAT_MS);
        }
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureWorker() {
        if (workerThread != null) return;
        workerThread = new HandlerThread("TripRecorder", Process.THREAD_PRIORITY_BACKGROUND);
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
    }

    private void removeLocationUpdates() {
        if (locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
    }

    // Stops location updates and the worker; keeps the foreground notification.
    private boolean teardownRecordingOnly() {
        boolean wasRecording;
        synchronized (this) {
            wasRecording = recording;
            recording = false;
            config = null;
        }
        removeLocationUpdates();
        Handler handler = worker;
        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
        }
        if (workerThread != null) {
            workerThread.quitSafely();
            workerThread = null;
            worker = null;
        }
        return wasRecording;
    }

    /** Stops recording and leaves the foreground. Saved trip state is left alone. */
    private boolean teardown() {
        boolean wasRecording = teardownRecordingOnly();
        stopForeground(STOP_FOREGROUND_REMOVE);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(RECORDING_NOTIFICATION_ID);
        }
        if (wasRecording) dispatchStatus();
        return wasRecording;
    }

    /** Records the error, alerts the driver and stops. The trip stays active for resume(). */
    private void fail(@Nullable String tripId, String code, String message) {
        int consecutive = recordError(code, message);
        postAlert(message);
        dispatch(target -> target.onTripError(tripId, code, message, consecutive));
        if (!teardown()) dispatchStatus();
        stopSelfResult(latestStartId);
    }

    private int recordError(String code, String message) {
        if (preferences.getString(KEY_TRIP_ID, null) == null) return 0;
        int consecutive = preferences.getInt(KEY_CONSECUTIVE_ERRORS, 0) + 1;
        preferences.edit()
            .putInt(KEY_CONSECUTIVE_ERRORS, consecutive)
            .putString(KEY_LAST_ERROR_CODE, code)
            .putString(KEY_LAST_ERROR_MESSAGE, message)
            .putLong(KEY_LAST_ERROR_AT, System.currentTimeMillis())
            .apply();
        return consecutive;
    }

    // Notifications ---------------------------------------------------------------------------

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel recordingChannel = new NotificationChannel(
            RECORDING_CHANNEL_ID,
            getString(R.string.trip_recording_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        recordingChannel.setDescription(getString(R.string.trip_recording_channel_description));
        recordingChannel.setShowBadge(false);
        manager.createNotificationChannel(recordingChannel);

        NotificationChannel alertChannel = new NotificationChannel(
            ALERT_CHANNEL_ID,
            getString(R.string.trip_alert_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        alertChannel.setDescription(getString(R.string.trip_alert_channel_description));
        manager.createNotificationChannel(alertChannel);
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(RECORDING_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(RECORDING_NOTIFICATION_ID, notification);
        }
    }

    // Satisfies startForegroundService() before stopping; failure is fine here.
    private void promoteQuietly(@Nullable TripConfig c) {
        try {
            startForegroundCompat(buildRecordingNotification(c, null));
        } catch (RuntimeException ignored) {
            // Nothing to record anyway.
        }
    }

    private Notification buildRecordingNotification(@Nullable TripConfig c, @Nullable String statusLine) {
        String title = c != null && !c.title.isEmpty()
            ? c.title
            : getString(R.string.trip_recording_default_title);
        String message = c != null ? c.message : "";
        String text = statusLine != null ? statusLine : message;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, RECORDING_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openAppIntent(RECORDING_NOTIFICATION_ID))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setOngoing(true);
        if (statusLine != null && !message.isEmpty()) {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(message + "\n" + statusLine));
        }
        if (c != null && c.startedAt > 0L) {
            // Shows the trip's running time.
            builder.setWhen(c.startedAt).setShowWhen(true).setUsesChronometer(true);
        }
        return builder.build();
    }

    // Worker thread. e.g. "Last fix 2 min ago \u00b7 340 points saved" (saved = not yet synced).
    private void refreshNotification(TripConfig c) {
        String line = statusLine(c);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        synchronized (this) {
            // Under the lock teardown() takes first, so a stopped trip never gets its
            // ongoing notification posted back.
            if (!recording || config != c) return;
            manager.notify(RECORDING_NOTIFICATION_ID, buildRecordingNotification(c, line));
        }
    }

    private String statusLine(TripConfig c) {
        long pending = -1L;
        try {
            pending = store.counts(c.tripId).unsynced;
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not count unsynced points", error);
        }

        String fix;
        if (!preferences.getBoolean(KEY_GPS_AVAILABLE, true)) {
            fix = "No GPS fix";
        } else {
            long lastFixAt = preferences.getLong(KEY_LAST_FIX_AT, 0L);
            fix = lastFixAt > 0L
                ? "Last fix " + ago(System.currentTimeMillis() - lastFixAt)
                : "Waiting for GPS fix";
        }
        if (pending < 0L) return fix;
        return fix + " \u00b7 " + pending + (pending == 1L ? " point saved" : " points saved");
    }

    private static String ago(long elapsedMs) {
        long minutes = Math.max(0L, elapsedMs) / 60_000L;
        if (minutes < 1L) return "just now";
        if (minutes < 60L) return minutes + " min ago";
        return (minutes / 60L) + " h " + (minutes % 60L) + " min ago";
    }

    private void postAlert(String message) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        Notification notification = new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.trip_alert_title))
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(openAppIntent(ALERT_NOTIFICATION_ID))
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build();
        try {
            manager.notify(ALERT_NOTIFICATION_ID, notification);
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not post the tracking alert", error);
        }
    }

    private void cancelAlert() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(ALERT_NOTIFICATION_ID);
        }
    }

    private PendingIntent openAppIntent(int requestCode) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            this,
            requestCode,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    // State -----------------------------------------------------------------------------------

    private static final class TripConfig {
        final String tripId;
        final String kind;
        final String title;
        final String message;
        final long intervalMs;
        final float distanceFilterM;
        final float maxAccuracyM;
        final long startedAt;

        private TripConfig(
            String tripId,
            String kind,
            String title,
            String message,
            long intervalMs,
            float distanceFilterM,
            float maxAccuracyM,
            long startedAt
        ) {
            this.tripId = tripId;
            this.kind = kind;
            this.title = title;
            this.message = message;
            this.intervalMs = intervalMs;
            this.distanceFilterM = distanceFilterM;
            this.maxAccuracyM = maxAccuracyM;
            this.startedAt = startedAt;
        }

        @Nullable
        static TripConfig load(SharedPreferences prefs) {
            String tripId = prefs.getString(KEY_TRIP_ID, null);
            if (tripId == null || tripId.isEmpty()) return null;
            return new TripConfig(
                tripId,
                prefs.getString(KEY_KIND, "fleet"),
                prefs.getString(KEY_TITLE, ""),
                prefs.getString(KEY_MESSAGE, ""),
                Math.max(1_000L, prefs.getLong(KEY_INTERVAL_MS, DEFAULT_INTERVAL_MS)),
                Math.max(0f, prefs.getFloat(KEY_DISTANCE_FILTER_M, DEFAULT_DISTANCE_FILTER_M)),
                prefs.getFloat(KEY_MAX_ACCURACY_M, DEFAULT_MAX_ACCURACY_M),
                prefs.getLong(KEY_STARTED_AT, 0L)
            );
        }
    }

    /** Saved recorder state, read by the plugin for getStatus(). 0 / NaN / null = unknown. */
    public static final class Snapshot {
        @Nullable public final String tripId;
        @Nullable public final String kind;
        public final long startedAt;
        public final boolean running;
        public final long lastFixAt;
        public final float lastAccuracy;
        public final long lastAliveAt;
        public final boolean gpsAvailable;
        public final int consecutiveErrors;
        @Nullable public final String lastErrorCode;
        @Nullable public final String lastErrorMessage;
        public final long lastErrorAt;

        private Snapshot(SharedPreferences prefs) {
            String id = prefs.getString(KEY_TRIP_ID, null);
            tripId = id == null || id.isEmpty() ? null : id;
            kind = tripId == null ? null : prefs.getString(KEY_KIND, null);
            startedAt = prefs.getLong(KEY_STARTED_AT, 0L);
            running = recording;
            lastFixAt = prefs.getLong(KEY_LAST_FIX_AT, 0L);
            lastAccuracy = prefs.contains(KEY_LAST_ACCURACY)
                ? prefs.getFloat(KEY_LAST_ACCURACY, Float.NaN)
                : Float.NaN;
            lastAliveAt = prefs.getLong(KEY_LAST_ALIVE_AT, 0L);
            gpsAvailable = prefs.getBoolean(KEY_GPS_AVAILABLE, true);
            consecutiveErrors = prefs.getInt(KEY_CONSECUTIVE_ERRORS, 0);
            lastErrorCode = prefs.getString(KEY_LAST_ERROR_CODE, null);
            lastErrorMessage = prefs.getString(KEY_LAST_ERROR_MESSAGE, null);
            lastErrorAt = prefs.getLong(KEY_LAST_ERROR_AT, 0L);
        }
    }
}
