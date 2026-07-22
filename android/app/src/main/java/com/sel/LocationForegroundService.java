package com.sel;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.SetOptions;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

public class LocationForegroundService extends Service {

    private static final String TAG = "LocationFgService";
    private static final String CHANNEL_ID = "sel_location_tracking";
    private static final int NOTIFICATION_ID = 1001;

    static final String ACTION_START = "ACTION_START";
    static final String ACTION_STOP = "ACTION_STOP";
    static final String EXTRA_USER_ID = "userId";

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private FirebaseFirestore firestore;
    private String userId;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        firestore = FirebaseFirestore.getInstance();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restarted by OS after kill — re-read userId from SharedPreferences
            userId = getSharedPreferences("LocationPlugin", MODE_PRIVATE)
                .getString("userId", null);
            if (userId == null || userId.isEmpty()) {
                stopSelf();
                return START_NOT_STICKY;
            }
            startForeground(NOTIFICATION_ID, buildNotification());
            startLocationUpdates();
            return START_STICKY;
        }

        if (ACTION_STOP.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        userId = intent.getStringExtra(EXTRA_USER_ID);
        if (userId == null || userId.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification());
        startLocationUpdates();
        return START_STICKY;
    }

    private void startLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            2 * 60 * 1000L
        )
        .setMinUpdateIntervalMillis(60 * 1000L)
        .setMinUpdateDistanceMeters(30f)
        .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null || userId == null) return;
                Location location = result.getLastLocation();
                if (location != null) persistLocation(location);
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            );
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted", e);
            stopSelf();
        }
    }

    private void persistLocation(Location location) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        String isoTime = sdf.format(new Date(location.getTime()));

        Map<String, Object> data = new HashMap<>();
        data.put("userId", userId);
        data.put("latitude", location.getLatitude());
        data.put("longitude", location.getLongitude());
        data.put("accuracy", (double) location.getAccuracy());
        data.put("heading", location.hasBearing() ? (double) location.getBearing() : null);
        data.put("speed", location.hasSpeed() ? (double) location.getSpeed() : null);
        data.put("platform", "android");
        data.put("updatedAt", FieldValue.serverTimestamp());
        data.put("updatedAtIso", isoTime);

        firestore.collection("userLocations")
            .document(userId)
            .set(data, SetOptions.merge())
            .addOnFailureListener(e -> Log.w(TAG, "Firestore write failed", e));
    }

    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SEL Live")
            .setContentText("Your location is being shared with your organisation.")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Location Tracking",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps location tracking active in the background");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
