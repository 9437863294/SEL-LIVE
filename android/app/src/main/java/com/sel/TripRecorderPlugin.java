package com.sel;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.util.List;

/**
 * Bridge to {@link TripRecorderService} and its {@link TripPointStore} buffer. The service records
 * whether or not this plugin (the WebView) is alive; JS drains unsynced points with getPoints /
 * markSynced. Contract: docs/BACKGROUND-TRACKING-PLAN.md section 4.
 */
@CapacitorPlugin(
    name = "TripRecorder",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class TripRecorderPlugin extends Plugin implements TripRecorderService.Listener {

    private static final String TAG = "TripRecorderPlugin";

    static final String CODE_NOT_AUTHORIZED = "NOT_AUTHORIZED";
    static final String CODE_ANOTHER_TRIP_ACTIVE = "ANOTHER_TRIP_ACTIVE";
    static final String CODE_INVALID_ARGUMENT = "INVALID_ARGUMENT";
    static final String CODE_START_FAILED = "START_FAILED";
    static final String CODE_STORAGE_FAILED = "STORAGE_FAILED";

    private static final int DEFAULT_POINT_LIMIT = 200;
    private static final int MAX_POINT_LIMIT = 500;
    private static final int DEFAULT_PURGE_DAYS = 7;
    // A permission result faster than this means the system showed nothing (asked too often).
    private static final long NO_UI_THRESHOLD_MS = 1_000L;

    private volatile long permissionRequestedAt = 0L;

    @Override
    public void load() {
        TripRecorderService.setListener(this);
        execute(() -> {
            try {
                TripPointStore.get(getContext()).purgeSynced(DEFAULT_PURGE_DAYS, System.currentTimeMillis());
            } catch (Exception error) {
                Log.w(TAG, "Could not purge synced trip points", error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        TripRecorderService.clearListener(this);
        super.handleOnDestroy();
    }

    // Permissions -----------------------------------------------------------------------------

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @PluginMethod
    public void requestLocationPermission(PluginCall call) {
        if (isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.resolve(permissionStatus());
            return;
        }
        // Also asked when only approximate is granted: Android 12+ then offers "precise".
        requestPermissionForAlias("location", call, "locationPermissionResult");
    }

    @PluginMethod
    public void requestBackgroundLocationPermission(PluginCall call) {
        // Android ignores a background request without foreground location, so skip it.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasBackgroundLocation() || !hasLocation()) {
            call.resolve(permissionStatus());
            return;
        }
        // API 29 shows a dialog; API 30+ opens the system's location-permission page for the app.
        permissionRequestedAt = SystemClock.elapsedRealtime();
        requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionResult");
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (notificationsEnabled()) {
            call.resolve(permissionStatus());
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionRequestedAt = SystemClock.elapsedRealtime();
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        openSettingsForResult(call, notificationSettingsIntent());
    }

    @PermissionCallback
    private void locationPermissionResult(PluginCall call) {
        if (call == null) return;
        call.resolve(permissionStatus());
    }

    @PermissionCallback
    private void backgroundPermissionResult(PluginCall call) {
        if (call == null) return;
        if (!hasBackgroundLocation() && systemShowedNothing()) {
            openSettingsForResult(call, appDetailsIntent());
            return;
        }
        call.resolve(permissionStatus());
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        if (call == null) return;
        if (!notificationsEnabled() && systemShowedNothing()) {
            openSettingsForResult(call, notificationSettingsIntent());
            return;
        }
        call.resolve(permissionStatus());
    }

    @ActivityCallback
    private void settingsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(permissionStatus());
    }

    // Recording -------------------------------------------------------------------------------

    @PluginMethod
    public void start(PluginCall call) {
        String tripId = trimmed(call.getString("tripId"));
        if (tripId == null) {
            call.reject("tripId is required.", CODE_INVALID_ARGUMENT);
            return;
        }
        String kind = trimmed(call.getString("kind"));
        if (!"fleet".equals(kind) && !"own".equals(kind)) {
            call.reject("kind must be 'fleet' or 'own'.", CODE_INVALID_ARGUMENT);
            return;
        }
        String title = orDefault(trimmed(call.getString("title")), "Trip recording");
        String message = orDefault(trimmed(call.getString("message")), "Recording your trip route.");
        long intervalMs = clamp(
            readLong(call, "intervalMs", TripRecorderService.DEFAULT_INTERVAL_MS), 1_000L, 300_000L);
        float distanceFilterM = (float) clamp(
            readDouble(call, "distanceFilterM", TripRecorderService.DEFAULT_DISTANCE_FILTER_M), 0d, 1_000d);
        float maxAccuracyM = (float) clamp(
            readDouble(call, "maxAccuracyM", TripRecorderService.DEFAULT_MAX_ACCURACY_M), 1d, 10_000d);

        if (!hasLocation()) {
            call.reject("Location permission is required to record a trip.", CODE_NOT_AUTHORIZED);
            return;
        }

        try {
            boolean started = TripRecorderService.startTrip(
                getContext(), tripId, kind, title, message, intervalMs, distanceFilterM, maxAccuracyM);
            if (!started) {
                call.reject("Another trip is already being recorded.", CODE_ANOTHER_TRIP_ACTIVE);
                return;
            }
        } catch (Exception error) {
            call.reject("Unable to start trip recording.", CODE_START_FAILED, error);
            return;
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String tripId = trimmed(call.getString("tripId"));
        Context context = getContext();
        String countFor = tripId != null ? tripId : TripRecorderService.activeTripId(context);
        try {
            boolean stopped = TripRecorderService.stopTrip(context, tripId);
            long pending = countFor == null ? 0L : store().counts(countFor).unsynced;
            JSObject result = new JSObject();
            result.put("stopped", stopped);
            result.put("pending", pending);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to stop trip recording.", CODE_STORAGE_FAILED, error);
        }
    }

    @PluginMethod
    public void resume(PluginCall call) {
        Context context = getContext();
        String activeTripId = TripRecorderService.activeTripId(context);
        boolean resumed = false;
        // Without location permission the service could not run; the status shows why.
        if (activeTripId != null && !TripRecorderService.isRecording() && hasLocation()) {
            try {
                resumed = TripRecorderService.resumeTrip(context);
            } catch (Exception error) {
                call.reject("Unable to resume trip recording.", CODE_START_FAILED, error);
                return;
            }
        }
        JSObject result = new JSObject();
        result.put("resumed", resumed);
        result.put("tripId", orNull(activeTripId));
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        try {
            call.resolve(buildStatus(trimmed(call.getString("tripId"))));
        } catch (Exception error) {
            call.reject("Unable to read trip recording status.", CODE_STORAGE_FAILED, error);
        }
    }

    // Buffer ----------------------------------------------------------------------------------

    @PluginMethod
    public void getPoints(PluginCall call) {
        String tripId = trimmed(call.getString("tripId"));
        if (tripId == null) {
            call.reject("tripId is required.", CODE_INVALID_ARGUMENT);
            return;
        }
        int limit = (int) clamp(readLong(call, "limit", DEFAULT_POINT_LIMIT), 1L, MAX_POINT_LIMIT);
        try {
            List<TripPointStore.Point> points = store().unsyncedPoints(tripId, limit);
            JSArray array = new JSArray();
            for (TripPointStore.Point point : points) {
                JSObject item = new JSObject();
                item.put("id", point.id);
                item.put("clientPointId", point.clientPointId);
                item.put("lat", point.lat);
                item.put("lng", point.lng);
                item.put("accuracy", orNull(point.accuracy));
                item.put("speed", orNull(point.speed));
                item.put("bearing", orNull(point.bearing));
                item.put("altitude", orNull(point.altitude));
                item.put("recordedAt", point.recordedAt);
                array.put(item);
            }
            JSObject result = new JSObject();
            result.put("points", array);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read trip points.", CODE_STORAGE_FAILED, error);
        }
    }

    @PluginMethod
    public void markSynced(PluginCall call) {
        String tripId = trimmed(call.getString("tripId"));
        Long upToId = readLongOrNull(call, "upToId");
        if (tripId == null || upToId == null) {
            call.reject("tripId and upToId are required.", CODE_INVALID_ARGUMENT);
            return;
        }
        try {
            int marked = store().markSynced(tripId, upToId, System.currentTimeMillis());
            JSObject result = new JSObject();
            result.put("marked", marked);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to mark trip points synced.", CODE_STORAGE_FAILED, error);
        }
    }

    @PluginMethod
    public void getGaps(PluginCall call) {
        String tripId = trimmed(call.getString("tripId"));
        if (tripId == null) {
            call.reject("tripId is required.", CODE_INVALID_ARGUMENT);
            return;
        }
        try {
            JSArray array = new JSArray();
            for (TripPointStore.Gap gap : store().unsyncedGaps(tripId)) {
                JSObject item = new JSObject();
                item.put("id", gap.id);
                item.put("fromMs", gap.fromMs);
                item.put("toMs", gap.toMs);
                array.put(item);
            }
            JSObject result = new JSObject();
            result.put("gaps", array);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read tracking gaps.", CODE_STORAGE_FAILED, error);
        }
    }

    @PluginMethod
    public void markGapsSynced(PluginCall call) {
        String tripId = trimmed(call.getString("tripId"));
        Long upToId = readLongOrNull(call, "upToId");
        if (tripId == null || upToId == null) {
            call.reject("tripId and upToId are required.", CODE_INVALID_ARGUMENT);
            return;
        }
        try {
            int marked = store().markGapsSynced(tripId, upToId, System.currentTimeMillis());
            JSObject result = new JSObject();
            result.put("marked", marked);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to mark tracking gaps synced.", CODE_STORAGE_FAILED, error);
        }
    }

    @PluginMethod
    public void purge(PluginCall call) {
        int days = (int) clamp(readLong(call, "olderThanDays", DEFAULT_PURGE_DAYS), 0L, 3_650L);
        try {
            int deleted = store().purgeSynced(days, System.currentTimeMillis());
            JSObject result = new JSObject();
            result.put("deleted", deleted);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to purge synced trip points.", CODE_STORAGE_FAILED, error);
        }
    }

    // Service events (main thread) --------------------------------------------------------------
    // Re-posted to the plugin thread, where addListener runs and the status queries belong.

    @Override
    public void onTripFix(String tripId, long pointId, long recordedAt) {
        execute(() -> {
            JSObject data = new JSObject();
            data.put("tripId", tripId);
            data.put("id", pointId);
            data.put("recordedAt", recordedAt);
            notifyListeners("fix", data);
        });
    }

    @Override
    public void onTripError(@Nullable String tripId, String code, String message, int consecutive) {
        execute(() -> {
            JSObject data = new JSObject();
            data.put("tripId", orNull(tripId));
            data.put("code", code);
            data.put("message", message);
            data.put("consecutive", consecutive);
            notifyListeners("trackingError", data);
        });
    }

    @Override
    public void onTripStatusChanged() {
        execute(() -> {
            try {
                notifyListeners("status", buildStatus(null));
            } catch (Exception error) {
                Log.w(TAG, "Could not build trip status", error);
            }
        });
    }

    // Helpers ---------------------------------------------------------------------------------

    private JSObject buildStatus(@Nullable String requestedTripId) {
        Context context = getContext();
        TripRecorderService.Snapshot state = TripRecorderService.snapshot(context);
        String tripId = requestedTripId != null ? requestedTripId : state.tripId;

        long accepted = 0L;
        long pending = 0L;
        long gapsPending = 0L;
        if (tripId != null) {
            TripPointStore store = store();
            TripPointStore.Counts counts = store.counts(tripId);
            accepted = counts.accepted;
            pending = counts.unsynced;
            gapsPending = store.countUnsyncedGaps(tripId);
        }

        JSObject status = new JSObject();
        status.put("activeTripId", orNull(state.tripId));
        status.put("kind", orNull(state.kind));
        status.put("startedAt", positiveOrNull(state.tripId != null ? state.startedAt : 0L));
        status.put("running", state.running);
        status.put("lastFixAt", positiveOrNull(state.lastFixAt));
        status.put("lastAccuracy", Float.isNaN(state.lastAccuracy)
            ? JSONObject.NULL
            : (Object) TripRecorderService.cleanDouble(state.lastAccuracy));
        status.put("accepted", accepted);
        status.put("pending", pending);
        status.put("lastAliveAt", positiveOrNull(state.lastAliveAt));
        status.put("consecutiveErrors", state.consecutiveErrors);
        if (state.lastErrorCode != null) {
            JSObject lastError = new JSObject();
            lastError.put("code", state.lastErrorCode);
            lastError.put("message", state.lastErrorMessage != null ? state.lastErrorMessage : "");
            lastError.put("at", state.lastErrorAt);
            status.put("lastError", lastError);
        } else {
            status.put("lastError", JSONObject.NULL);
        }
        status.put("gapsPending", gapsPending);
        // Additive: false after the provider reports no location (the UI's "No GPS fix").
        status.put("locationAvailable", state.gpsAvailable);
        return status;
    }

    private JSObject permissionStatus() {
        boolean fine = isGranted(Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = isGranted(Manifest.permission.ACCESS_COARSE_LOCATION);
        JSObject status = new JSObject();
        status.put("location", fine || coarse);
        status.put("precise", fine);
        status.put("background", hasBackgroundLocation());
        status.put("notifications", notificationsEnabled());
        status.put("locationServices", locationServicesEnabled());
        status.put("sdkInt", Build.VERSION.SDK_INT);
        return status;
    }

    private TripPointStore store() {
        return TripPointStore.get(getContext());
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasLocation() {
        return isGranted(Manifest.permission.ACCESS_FINE_LOCATION) ||
            isGranted(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private boolean hasBackgroundLocation() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean notificationsEnabled() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return isGranted(Manifest.permission.POST_NOTIFICATIONS);
        }
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    private boolean locationServicesEnabled() {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return manager.isLocationEnabled();
        }
        try {
            return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception error) {
            return false;
        }
    }

    private boolean systemShowedNothing() {
        return SystemClock.elapsedRealtime() - permissionRequestedAt < NO_UI_THRESHOLD_MS;
    }

    // Resolves with the permission status when the driver comes back from the settings page.
    private void openSettingsForResult(PluginCall call, Intent intent) {
        try {
            startActivityForResult(call, intent, "settingsResult");
        } catch (Exception error) {
            try {
                startActivityForResult(call, appDetailsIntent(), "settingsResult");
            } catch (Exception fallbackError) {
                call.resolve(permissionStatus());
            }
        }
    }

    private Intent appDetailsIntent() {
        return new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null)
        );
    }

    private Intent notificationSettingsIntent() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        }
        return appDetailsIntent();
    }

    @Nullable
    private static String trimmed(@Nullable String value) {
        if (value == null) return null;
        String result = value.trim();
        return result.isEmpty() ? null : result;
    }

    private static String orDefault(@Nullable String value, String fallback) {
        return value != null ? value : fallback;
    }

    private static Object orNull(@Nullable Object value) {
        return value != null ? value : JSONObject.NULL;
    }

    private static Object positiveOrNull(long value) {
        return value > 0L ? (Object) value : JSONObject.NULL;
    }

    // JS numbers arrive as Integer, Long or Double; PluginCall.getLong only accepts Long.
    @Nullable
    private static Long readLongOrNull(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        if (value instanceof Number) {
            double number = ((Number) value).doubleValue();
            if (!Double.isNaN(number) && !Double.isInfinite(number)) {
                return ((Number) value).longValue();
            }
        }
        return null;
    }

    private static long readLong(PluginCall call, String key, long fallback) {
        Long value = readLongOrNull(call, key);
        return value != null ? value : fallback;
    }

    private static double readDouble(PluginCall call, String key, double fallback) {
        Object value = call.getData().opt(key);
        if (value instanceof Number) {
            double number = ((Number) value).doubleValue();
            if (!Double.isNaN(number) && !Double.isInfinite(number)) return number;
        }
        return fallback;
    }

    private static long clamp(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
