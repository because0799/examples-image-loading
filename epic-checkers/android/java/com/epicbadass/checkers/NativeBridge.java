package com.epicbadass.checkers;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * window.AndroidBridge — the JS interface (see src/platform/native.js and ARCHITECTURE.md §7).
 *
 * Methods are invoked on WebView's private JavaBridge thread, never on the UI thread, so
 * anything touching the window is posted to the UI thread. Every method swallows errors:
 * a failing haptic or TTS call must never surface as a JS exception in the middle of a combo.
 */
final class NativeBridge {
    static final String NAME = "AndroidBridge";
    private static final String TAG = "EpicCheckers";

    private final MainActivity activity;
    private final Haptics haptics;
    private final Speaker speaker;

    NativeBridge(MainActivity activity, Haptics haptics, Speaker speaker) {
        this.activity = activity;
        this.haptics = haptics;
        this.speaker = speaker;
    }

    /** @param jsonPatternOrMs "40" or "[40,30,80]" (web convention: starts with vibration). */
    @JavascriptInterface
    public void vibrate(String jsonPatternOrMs) {
        try {
            haptics.vibrate(jsonPatternOrMs);
        } catch (RuntimeException e) {
            Log.w(TAG, "bridge.vibrate", e);
        }
    }

    /**
     * Same as vibrate() with a vibration strength 1..255 (the "light" haptics setting). Phones
     * without amplitude control play the pattern at the default strength.
     */
    @JavascriptInterface
    public void vibrateLevel(String jsonPatternOrMs, int amplitude) {
        try {
            haptics.vibrate(jsonPatternOrMs, amplitude);
        } catch (RuntimeException e) {
            Log.w(TAG, "bridge.vibrateLevel", e);
        }
    }

    @JavascriptInterface
    public boolean hasVibrator() {
        return haptics.available();
    }

    @JavascriptInterface
    public void speak(String text, String lang, float pitch, float rate) {
        try {
            speaker.speak(text, lang, pitch, rate);
        } catch (RuntimeException e) {
            Log.w(TAG, "bridge.speak", e);
        }
    }

    @JavascriptInterface
    public void stopSpeaking() {
        try {
            speaker.stop();
        } catch (RuntimeException e) {
            Log.w(TAG, "bridge.stopSpeaking", e);
        }
    }

    @JavascriptInterface
    public boolean hasTts() {
        try {
            return speaker.isAvailable();
        } catch (RuntimeException e) {
            return false;
        }
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (!activity.isFinishing()) activity.finishAndRemoveTask();
            }
        });
    }

    @JavascriptInterface
    public void keepScreenOn(final boolean on) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (activity.isFinishing() || activity.isDestroyed()) return;
                if (on) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            }
        });
    }

    /** JSON with app/device facts, e.g. for an "About" line in settings. */
    @JavascriptInterface
    @SuppressWarnings("deprecation")
    public String getInfo() {
        JSONObject o = new JSONObject();
        try {
            o.put("platform", "android");
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("release", Build.VERSION.RELEASE);
            o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            o.put("locale", Locale.getDefault().toLanguageTag());
            try {
                PackageInfo pi = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                o.put("versionName", pi.versionName);
                o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : (long) pi.versionCode);
            } catch (PackageManager.NameNotFoundException e) {
                // cannot happen for our own package
            }
            o.put("vibrator", haptics.available());
        } catch (JSONException e) {
            Log.w(TAG, "bridge.getInfo", e);
        }
        return o.toString();
    }
}
