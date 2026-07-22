package com.sel;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.content.ContextCompat;

public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) &&
            !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences("LocationPlugin", Context.MODE_PRIVATE);
        String userId = prefs.getString("userId", null);

        if (userId != null && !userId.isEmpty()) {
            Intent serviceIntent = new Intent(context, LocationForegroundService.class);
            serviceIntent.setAction(LocationForegroundService.ACTION_START);
            serviceIntent.putExtra(LocationForegroundService.EXTRA_USER_ID, userId);
            ContextCompat.startForegroundService(context, serviceIntent);
        }
    }
}
