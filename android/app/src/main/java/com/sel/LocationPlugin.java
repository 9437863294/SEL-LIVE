package com.sel;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocationTracking")
public class LocationPlugin extends Plugin {

    private static final String PREFS_NAME = "LocationPlugin";
    private static final String KEY_USER_ID = "userId";

    @PluginMethod
    public void startTracking(PluginCall call) {
        String userId = call.getString("userId");
        if (userId == null || userId.isEmpty()) {
            call.reject("userId is required");
            return;
        }

        Context context = getContext();
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_USER_ID, userId)
            .apply();

        Intent serviceIntent = new Intent(context, LocationForegroundService.class);
        serviceIntent.setAction(LocationForegroundService.ACTION_START);
        serviceIntent.putExtra(LocationForegroundService.EXTRA_USER_ID, userId);
        ContextCompat.startForegroundService(context, serviceIntent);

        call.resolve();
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        Context context = getContext();
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_USER_ID)
            .apply();

        Intent serviceIntent = new Intent(context, LocationForegroundService.class);
        serviceIntent.setAction(LocationForegroundService.ACTION_STOP);
        context.startService(serviceIntent);

        call.resolve();
    }
}
