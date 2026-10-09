package com.epicbadass.checkers;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import org.json.JSONArray;

/**
 * Vibration helper used by the JS bridge.
 *
 * Input uses the Web Vibration API convention: either a single duration in ms ("40") or a JSON
 * array that starts with a vibration segment and alternates vibrate/pause ("[40,30,80]").
 * "0", "[]" or an empty string cancel the current vibration. Thread-safe (Vibrator is).
 */
final class Haptics {
    private static final String TAG = "EpicCheckers";
    private static final int MAX_SEGMENTS = 64;
    private static final long MAX_SEGMENT_MS = 5000L;
    private static final long MAX_TOTAL_MS = 10000L;

    private final Vibrator vibrator;

    @SuppressWarnings("deprecation")
    Haptics(Context context) {
        Vibrator v = null;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm != null) v = vm.getDefaultVibrator();
            } else {
                v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "Vibrator unavailable", e);
        }
        vibrator = v;
    }

    boolean available() {
        try {
            return vibrator != null && vibrator.hasVibrator();
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** @param spec "40" or "[40,30,80]" (web convention: first entry vibrates). */
    void vibrate(String spec) {
        if (!available()) return;
        long[] web = parse(spec);
        if (web == null) return;
        long total = 0;
        boolean anyOn = false;
        for (int i = 0; i < web.length; i++) {
            total += web[i];
            if (i % 2 == 0 && web[i] > 0) anyOn = true;
        }
        if (!anyOn || total <= 0) {
            cancel();
            return;
        }
        try {
            if (web.length == 1) {
                vibrateOnce(web[0]);
            } else {
                // Android waveform timings start with an OFF segment: prepend a 0 ms delay.
                long[] timings = new long[web.length + 1];
                timings[0] = 0L;
                System.arraycopy(web, 0, timings, 1, web.length);
                vibrateWaveform(timings);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "vibrate failed: " + spec, e);
        }
    }

    void cancel() {
        if (vibrator == null) return;
        try {
            vibrator.cancel();
        } catch (RuntimeException ignored) {
            // Some OEM vibrator services throw when nothing is playing.
        }
    }

    @SuppressWarnings("deprecation")
    private void vibrateOnce(long ms) {
        if (Build.VERSION.SDK_INT >= 26) {
            dispatch(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(ms, gameAudioAttributes());
        }
    }

    @SuppressWarnings("deprecation")
    private void vibrateWaveform(long[] timings) {
        if (Build.VERSION.SDK_INT >= 26) {
            dispatch(VibrationEffect.createWaveform(timings, -1));
        } else {
            vibrator.vibrate(timings, -1, gameAudioAttributes());
        }
    }

    @SuppressWarnings("deprecation")
    private void dispatch(VibrationEffect effect) {
        if (Build.VERSION.SDK_INT >= 33) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA));
        } else {
            vibrator.vibrate(effect, gameAudioAttributes());
        }
    }

    private static AudioAttributes gameAudioAttributes() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
    }

    /** Parses the bridge argument into clamped web-style segments, or null when malformed. */
    static long[] parse(String spec) {
        if (spec == null) return new long[0];
        String s = spec.trim();
        if (s.length() == 0 || "null".equals(s) || "undefined".equals(s)) return new long[0];
        try {
            if (s.charAt(0) == '[') {
                JSONArray arr = new JSONArray(s);
                int n = Math.min(arr.length(), MAX_SEGMENTS);
                long[] out = new long[n];
                long total = 0;
                for (int i = 0; i < n; i++) {
                    long v = clamp(Math.round(arr.optDouble(i, 0d)));
                    if (total + v > MAX_TOTAL_MS) v = Math.max(0L, MAX_TOTAL_MS - total);
                    out[i] = v;
                    total += v;
                }
                return out;
            }
            return new long[] { clamp(Math.round(Double.parseDouble(s))) };
        } catch (Exception e) {
            Log.w(TAG, "bad vibration pattern: " + spec);
            return null;
        }
    }

    private static long clamp(long v) {
        if (v < 0L) return 0L;
        return v > MAX_SEGMENT_MS ? MAX_SEGMENT_MS : v;
    }
}
