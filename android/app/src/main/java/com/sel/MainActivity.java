package com.sel;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    // Use request codes far from Capacitor's internal range (9000+)
    private static final int RC_LOCATION_AND_NOTIFY = 100;
    private static final int RC_BACKGROUND_LOCATION = 101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSettingsPlugin.class);
        registerPlugin(LocationPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        requestStartupPermissions();
    }

    // Step 1: foreground location. Notification access is requested by the
    // Capacitor Push Notifications plugin after sign-in so Android retains and
    // reports the user's choice without prompting again on every app start.
    private void requestStartupPermissions() {
        List<String> needed = new ArrayList<>();

        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
            needed.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                needed.toArray(new String[0]),
                RC_LOCATION_AND_NOTIFY
            );
        } else {
            // Already granted — jump to step 2
            requestBackgroundLocationIfNeeded();
        }
    }

    // Step 2: background location (must be a separate dialog on Android 10+)
    private void requestBackgroundLocationIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            !hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {

            ActivityCompat.requestPermissions(
                this,
                new String[]{ Manifest.permission.ACCESS_BACKGROUND_LOCATION },
                RC_BACKGROUND_LOCATION
            );
        } else {
            requestBatteryOptimizationExemption();
        }
    }

    // Step 3: battery optimisation exemption (intent, not a permission dialog)
    private void requestBatteryOptimizationExemption() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        // Always pass to Capacitor first so plugin-level permission callbacks still fire
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == RC_LOCATION_AND_NOTIFY) {
            requestBackgroundLocationIfNeeded();
        } else if (requestCode == RC_BACKGROUND_LOCATION) {
            requestBatteryOptimizationExemption();
        }
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }
}
