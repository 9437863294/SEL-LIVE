package com.sel;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeUserLocation")
public class NativeUserLocationPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String userId = call.getString("userId", "").trim();
        if (userId.isEmpty()) {
            call.reject("User ID is required for background location tracking.");
            return;
        }

        try {
            Context context = getContext();
            Intent intent = UserLocationForegroundService.createStartIntent(context, userId);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, intent);
            } else {
                context.startService(intent);
            }
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to start Android background location service.", error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            UserLocationForegroundService.stop(getContext());
            JSObject result = new JSObject();
            result.put("stopped", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to stop Android background location service.", error);
        }
    }
}
