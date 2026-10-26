package com.sel;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Battery-optimisation exemption and the OEM "autostart / background activity" pages that
 * otherwise kill {@link TripRecorderService} (MIUI, ColorOS, Funtouch, EMUI, One UI).
 */
@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    @PluginMethod
    public void isIgnoring(PluginCall call) {
        resolveIgnoring(call);
    }

    // Resolves { ignoring } once the driver closes the system dialog or list.
    @PluginMethod
    public void requestIgnore(PluginCall call) {
        if (isIgnoringOptimizations()) {
            resolveIgnoring(call);
            return;
        }
        String packageName = getContext().getPackageName();
        try {
            Intent request = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            request.setData(Uri.parse("package:" + packageName));
            startActivityForResult(call, request, "ignoreResult");
            return;
        } catch (Exception ignored) {
            // Some OEM builds remove the request dialog; fall back to the full list.
        }
        try {
            startActivityForResult(
                call,
                new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                "ignoreResult"
            );
        } catch (Exception error) {
            call.reject("Unable to open battery optimisation settings.", "UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void ignoreResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        resolveIgnoring(call);
    }

    @PluginMethod
    public void openAppInfo(PluginCall call) {
        try {
            startNewTask(appDetailsIntent());
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open app info.", "UNAVAILABLE", error);
        }
    }

    // Tries the maker's autostart / battery page; any that is missing or not exported throws and
    // the next is tried. No <queries> entry is needed because nothing is resolved up front.
    @PluginMethod
    public void openOemSettings(PluginCall call) {
        for (Intent intent : oemIntents()) {
            try {
                startNewTask(intent);
                JSObject result = new JSObject();
                result.put("opened", "oem");
                result.put("component", intent.getComponent().flattenToString());
                call.resolve(result);
                return;
            } catch (Exception ignored) {
                // Not on this ROM version; try the next one.
            }
        }
        try {
            startNewTask(appDetailsIntent());
            // No "component" key here: the TS binding types it as optional.
            JSObject result = new JSObject();
            result.put("opened", "appInfo");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open app settings.", "UNAVAILABLE", error);
        }
    }

    private List<Intent> oemIntents() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        String packageName = getContext().getPackageName();
        List<Intent> intents = new ArrayList<>();

        if (maker.contains("xiaomi") || maker.contains("redmi") || maker.contains("poco")) {
            // MIUI / HyperOS: Security > Autostart, then the per-app battery saver.
            intents.add(component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
            intents.add(component("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity")
                .putExtra("package_name", packageName)
                .putExtra("package_label", appLabel()));
        } else if (maker.contains("oppo") || maker.contains("realme")) {
            addColorOs(intents);
        } else if (maker.contains("oneplus")) {
            // OxygenOS before 12, then the ColorOS pages it merged into.
            intents.add(component("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"));
            addColorOs(intents);
        } else if (maker.contains("vivo") || maker.contains("iqoo")) {
            // Funtouch OS / OriginOS background start-up manager.
            intents.add(component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
            intents.add(component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"));
            intents.add(component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"));
        } else if (maker.contains("huawei") || maker.contains("honor")) {
            // EMUI app launch manager (9+), older protected apps, then Honor's MagicOS rename.
            intents.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
            intents.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"));
            intents.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"));
            intents.add(component("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
        } else if (maker.contains("samsung")) {
            // One UI Device care > Battery (background usage limits live there).
            intents.add(component("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"));
            intents.add(component("com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity"));
        }
        return intents;
    }

    // ColorOS (Oppo, Realme, newer OnePlus): startup manager, then the power usage page.
    private static void addColorOs(List<Intent> intents) {
        intents.add(component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
        intents.add(component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"));
        intents.add(component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"));
        intents.add(component("com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity"));
    }

    private static Intent component(String packageName, String className) {
        return new Intent().setComponent(new ComponentName(packageName, className));
    }

    private void startNewTask(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private Intent appDetailsIntent() {
        return new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null)
        );
    }

    private String appLabel() {
        Context context = getContext();
        try {
            return context.getApplicationInfo().loadLabel(context.getPackageManager()).toString();
        } catch (Exception error) {
            return "SEL";
        }
    }

    private boolean isIgnoringOptimizations() {
        PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private void resolveIgnoring(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ignoring", isIgnoringOptimizations());
        call.resolve(result);
    }
}
