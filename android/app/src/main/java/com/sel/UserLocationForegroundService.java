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
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.EventListener;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;
import com.google.firebase.firestore.SetOptions;
import com.google.firebase.firestore.WriteBatch;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

public class UserLocationForegroundService extends Service {

    private static final String ACTION_START = "com.sel.action.START_USER_LOCATION";
    private static final String ACTION_STOP = "com.sel.action.STOP_USER_LOCATION";
    private static final String EXTRA_USER_ID = "userId";
    private static final String PREFS_NAME = "sel_native_user_location";
    private static final String PREF_USER_ID = "userId";
    private static final String PREF_LAST_FETCH_REQUEST = "lastFetchRequestId";
    private static final String CHANNEL_ID = "sel_background_location";
    private static final int NOTIFICATION_ID = 28412;
    private static final long DEFAULT_INTERVAL_MS = 60_000L;
    private static final long MIN_INTERVAL_MS = 30_000L;
    private static final long MAX_INTERVAL_MS = 3_600_000L;

    private FirebaseFirestore firestore;
    private FusedLocationProviderClient fusedLocationClient;
    private ListenerRegistration settingsRegistration;
    private LocationCallback locationCallback;
    private SharedPreferences preferences;
    private String userId = "";
    private String lastHandledFetchRequestId = "";
    private long activeIntervalMs = DEFAULT_INTERVAL_MS;
    private long lastWriteMs = 0L;
    private boolean trackingEnabled = false;

    public static Intent createStartIntent(Context context, String userId) {
        return new Intent(context, UserLocationForegroundService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_USER_ID, userId);
    }

    public static void stop(Context context) {
        context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .remove(PREF_USER_ID)
            .apply();
        context.stopService(new Intent(context, UserLocationForegroundService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        firestore = FirebaseFirestore.getInstance();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTrackingAndSelf();
            return START_NOT_STICKY;
        }

        String requestedUserId = intent == null ? "" : intent.getStringExtra(EXTRA_USER_ID);
        if (requestedUserId != null && !requestedUserId.trim().isEmpty()) {
            userId = requestedUserId.trim();
            preferences.edit().putString(PREF_USER_ID, userId).apply();
        } else {
            userId = preferences.getString(PREF_USER_ID, "");
        }

        startForeground(NOTIFICATION_ID, buildNotification("Background location capture is active."));

        if (
            userId == null ||
            userId.trim().isEmpty() ||
            FirebaseAuth.getInstance().getCurrentUser() == null
        ) {
            stopTrackingAndSelf();
            return START_NOT_STICKY;
        }

        lastHandledFetchRequestId = preferences.getString(PREF_LAST_FETCH_REQUEST, "");
        attachSettingsListener();
        return START_STICKY;
    }

    private void attachSettingsListener() {
        if (settingsRegistration != null) {
            settingsRegistration.remove();
        }

        settingsRegistration = firestore
            .collection("userLocationSettings")
            .document(userId)
            .addSnapshotListener((snapshot, error) -> {
                if (error != null || snapshot == null) {
                    return;
                }

                Boolean enabled = snapshot.getBoolean("enabled");
                if (!snapshot.exists() || !Boolean.TRUE.equals(enabled)) {
                    stopTrackingAndSelf();
                    return;
                }

                trackingEnabled = true;
                Long intervalSeconds = snapshot.getLong("intervalSeconds");
                long nextIntervalMs = clampInterval(intervalSeconds) * 1000L;
                if (locationCallback == null || nextIntervalMs != activeIntervalMs) {
                    activeIntervalMs = nextIntervalMs;
                    restartLocationUpdates();
                }

                String fetchRequestId = snapshot.getString("fetchRequestId");
                if (
                    fetchRequestId != null &&
                    !fetchRequestId.trim().isEmpty() &&
                    !fetchRequestId.equals(lastHandledFetchRequestId)
                ) {
                    captureRequestedLocation(fetchRequestId);
                }
            });
    }

    private long clampInterval(@Nullable Long intervalSeconds) {
        long value = intervalSeconds == null ? DEFAULT_INTERVAL_MS / 1000L : intervalSeconds;
        return Math.max(MIN_INTERVAL_MS / 1000L, Math.min(MAX_INTERVAL_MS / 1000L, value));
    }

    private boolean hasLocationPermissions() {
        boolean foregroundGranted =
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED ||
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (!foregroundGranted) return false;

        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void restartLocationUpdates() {
        removeLocationUpdates();
        if (!trackingEnabled || !hasLocationPermissions()) {
            updateNotification("Allow location all the time to continue background capture.");
            return;
        }

        LocationRequest request = new LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            activeIntervalMs
        )
            .setMinUpdateIntervalMillis(Math.max(10_000L, activeIntervalMs / 2L))
            .setMaxUpdateDelayMillis(activeIntervalMs)
            .setMinUpdateDistanceMeters(0f)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location location = result.getLastLocation();
                if (location != null) {
                    persistLocation(location, false, null, "background");
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback,
                Looper.getMainLooper()
            );
            updateNotification("Background location capture is active.");
        } catch (SecurityException error) {
            updateNotification("Background location permission is required.");
        }
    }

    private void captureRequestedLocation(String fetchRequestId) {
        if (!trackingEnabled || !hasLocationPermissions()) return;

        CancellationTokenSource cancellationToken = new CancellationTokenSource();
        try {
            fusedLocationClient
                .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellationToken.getToken())
                .addOnSuccessListener(location -> {
                    if (location != null) {
                        persistLocation(location, true, fetchRequestId, "requested");
                    } else {
                        fusedLocationClient.getLastLocation().addOnSuccessListener(lastLocation -> {
                            if (lastLocation != null) {
                                persistLocation(lastLocation, true, fetchRequestId, "requested");
                            }
                        });
                    }
                });
        } catch (SecurityException ignored) {
            updateNotification("Background location permission is required.");
        }
    }

    private synchronized void persistLocation(
        Location location,
        boolean force,
        @Nullable String fetchRequestId,
        String captureType
    ) {
        if (!trackingEnabled || userId == null || userId.isEmpty()) return;
        long now = System.currentTimeMillis();
        if (!force && now - lastWriteMs < activeIntervalMs) return;
        lastWriteMs = now;

        DocumentReference latestRef = firestore.collection("userLocations").document(userId);
        DocumentReference historyRef = latestRef.collection("history").document();
        String capturedAtIso = isoTimestamp(now);

        Map<String, Object> payload = new HashMap<>();
        payload.put("userId", userId);
        payload.put("latitude", location.getLatitude());
        payload.put("longitude", location.getLongitude());
        payload.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 0d);
        payload.put("heading", location.hasBearing() ? location.getBearing() : null);
        payload.put("speed", location.hasSpeed() ? location.getSpeed() : null);
        payload.put("platform", "android");
        payload.put("captureType", captureType);

        Map<String, Object> latestPayload = new HashMap<>(payload);
        latestPayload.put("lastHistoryId", historyRef.getId());
        latestPayload.put("updatedAt", FieldValue.serverTimestamp());
        latestPayload.put("updatedAtIso", capturedAtIso);
        if (fetchRequestId != null && !fetchRequestId.isEmpty()) {
            latestPayload.put("lastFetchRequestId", fetchRequestId);
        }

        Map<String, Object> historyPayload = new HashMap<>(payload);
        historyPayload.put("capturedAt", FieldValue.serverTimestamp());
        historyPayload.put("capturedAtIso", capturedAtIso);
        if (fetchRequestId != null && !fetchRequestId.isEmpty()) {
            historyPayload.put("fetchRequestId", fetchRequestId);
        }

        WriteBatch batch = firestore.batch();
        batch.set(latestRef, latestPayload, SetOptions.merge());
        batch.set(historyRef, historyPayload);
        batch.commit()
            .addOnSuccessListener(unused -> {
                if (fetchRequestId != null && !fetchRequestId.isEmpty()) {
                    lastHandledFetchRequestId = fetchRequestId;
                    preferences.edit()
                        .putString(PREF_LAST_FETCH_REQUEST, fetchRequestId)
                        .apply();
                }
            })
            .addOnFailureListener(error -> {
                if (force) {
                    lastWriteMs = 0L;
                }
            });
    }

    private String isoTimestamp(long timestampMs) {
        SimpleDateFormat format = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(timestampMs));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.background_location_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows when approved background location capture is active.");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String message) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.background_location_notification_title))
            .setContentText(message)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .build();
    }

    private void updateNotification(String message) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(message));
        }
    }

    private void removeLocationUpdates() {
        if (locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
    }

    private void stopTrackingAndSelf() {
        trackingEnabled = false;
        removeLocationUpdates();
        if (settingsRegistration != null) {
            settingsRegistration.remove();
            settingsRegistration = null;
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        removeLocationUpdates();
        if (settingsRegistration != null) {
            settingsRegistration.remove();
            settingsRegistration = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
