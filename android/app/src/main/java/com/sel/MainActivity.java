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

import androidx.appcompat.app.AlertDialog;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    // Use request codes far from Capacitor's internal range (9000+)
    private static final int RC_INITIAL_PERMISSIONS = 100;
    private static final int RC_BACKGROUND_LOCATION = 101;
    private static final int RC_BACKGROUND_SETTINGS = 102;
    private static final int RC_BATTERY_OPTIMIZATION = 103;
    private static final String ONBOARDING_PREFS = "sel_permission_onboarding";
    private static final String ONBOARDING_COMPLETE = "completed";

    private boolean permissionFlowRunning = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (!permissionFlowRunning && !isPermissionOnboardingComplete()) {
            permissionFlowRunning = true;
            requestInitialPermissions();
        }
    }

    // Step 1: request every dangerous permission used by the installed app.
    // Permissions that do not exist on the device's Android version are omitted.
    private void requestInitialPermissions() {
        List<String> needed = new ArrayList<>();

        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
            needed.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        addIfMissing(needed, Manifest.permission.CAMERA);
        addIfMissing(needed, Manifest.permission.RECORD_AUDIO);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            addIfMissing(needed, Manifest.permission.POST_NOTIFICATIONS);
            addIfMissing(needed, Manifest.permission.READ_MEDIA_IMAGES);
            addIfMissing(needed, Manifest.permission.READ_MEDIA_VIDEO);
            addIfMissing(needed, Manifest.permission.READ_MEDIA_AUDIO);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                addIfMissing(needed, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
            }
        } else {
            addIfMissing(needed, Manifest.permission.READ_EXTERNAL_STORAGE);
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
                addIfMissing(needed, Manifest.permission.WRITE_EXTERNAL_STORAGE);
            }
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                needed.toArray(new String[0]),
                RC_INITIAL_PERMISSIONS
            );
        } else {
            requestBackgroundLocationIfNeeded();
        }
    }

    // Step 2: background location must be a separate request. Android 11+
    // requires the user to choose "Allow all the time" from app settings.
    private void requestBackgroundLocationIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            requestBatteryOptimizationExemption();
            return;
        }

        boolean hasForegroundLocation =
            hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (!hasForegroundLocation) {
            requestBatteryOptimizationExemption();
            return;
        }

        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{ Manifest.permission.ACCESS_BACKGROUND_LOCATION },
                RC_BACKGROUND_LOCATION
            );
            return;
        }

        new AlertDialog.Builder(this)
            .setTitle("Allow location all the time")
            .setMessage(
                "To support assigned location and trip tracking, open Permissions, select Location, " +
                "then choose Allow all the time. Return to the app when finished."
            )
            .setCancelable(false)
            .setNegativeButton("Not now", (dialog, which) -> requestBatteryOptimizationExemption())
            .setPositiveButton("Open settings", (dialog, which) -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivityForResult(intent, RC_BACKGROUND_SETTINGS);
            })
            .show();
    }

    // Step 3: battery optimisation exemption improves background trip reliability.
    private void requestBatteryOptimizationExemption() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivityForResult(intent, RC_BATTERY_OPTIMIZATION);
            return;
        }
        finishPermissionOnboarding();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        // Always pass to Capacitor first so plugin-level permission callbacks still fire
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == RC_INITIAL_PERMISSIONS) {
            requestBackgroundLocationIfNeeded();
        } else if (requestCode == RC_BACKGROUND_LOCATION) {
            requestBatteryOptimizationExemption();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RC_BACKGROUND_SETTINGS) {
            requestBatteryOptimizationExemption();
        } else if (requestCode == RC_BATTERY_OPTIMIZATION) {
            finishPermissionOnboarding();
        }
    }

    private void addIfMissing(List<String> permissions, String permission) {
        if (!hasPermission(permission) && !permissions.contains(permission)) {
            permissions.add(permission);
        }
    }

    private boolean isPermissionOnboardingComplete() {
        return getSharedPreferences(ONBOARDING_PREFS, MODE_PRIVATE)
            .getBoolean(ONBOARDING_COMPLETE, false);
    }

    private void finishPermissionOnboarding() {
        getSharedPreferences(ONBOARDING_PREFS, MODE_PRIVATE)
            .edit()
            .putBoolean(ONBOARDING_COMPLETE, true)
            .apply();
        permissionFlowRunning = false;
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }
}
