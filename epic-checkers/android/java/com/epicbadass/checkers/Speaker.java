package com.epicbadass.checkers;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.util.Log;

import java.util.List;
import java.util.Locale;

/**
 * Lazily initialised TextToSpeech for the EPIC-mode announcer ("COMBO!", "K.O.!").
 *
 * Every engine call happens on the main thread (JS bridge calls arrive on a binder thread and
 * are posted here). If the engine is still binding, the latest utterance is kept and spoken as
 * soon as initialisation succeeds (queue-flush semantics: only the newest line matters).
 * When no engine is installed or it fails to start, every call is a silent no-op.
 */
final class Speaker implements TextToSpeech.OnInitListener {
    private static final String TAG = "EpicCheckers";

    private static final int IDLE = 0;
    private static final int INITIALIZING = 1;
    private static final int READY = 2;
    private static final int FAILED = 3;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());

    private TextToSpeech tts;            // main thread only
    private volatile int state = IDLE;
    private volatile boolean shutDown;
    private Boolean enginePresent;       // cached package query (main or binder thread)
    private Utterance pending;           // main thread only
    private Locale currentLocale;        // main thread only
    private int utteranceSeq;

    private static final class Utterance {
        final String text;
        final String lang;
        final float pitch;
        final float rate;

        Utterance(String text, String lang, float pitch, float rate) {
            this.text = text;
            this.lang = lang;
            this.pitch = pitch;
            this.rate = rate;
        }
    }

    Speaker(Context context) {
        this.context = context.getApplicationContext();
    }

    /**
     * Synchronous best guess used by the web UI to decide whether to offer the announcer:
     * true once the engine is ready, or while it is (or could be) starting and a TTS engine is
     * installed; false after a failed initialisation or when no engine exists.
     */
    boolean isAvailable() {
        int s = state;
        if (s == READY) return true;
        if (s == FAILED || shutDown) return false;
        if (s == IDLE) prewarm();
        return hasEngine();
    }

    /** Starts binding the engine early so the first announcement is not delayed. */
    void prewarm() {
        main.post(new Runnable() {
            @Override
            public void run() {
                ensureInit();
            }
        });
    }

    void speak(final String text, final String lang, final float pitch, final float rate) {
        if (text == null || shutDown) return;
        final String trimmed = text.trim();
        if (trimmed.length() == 0) return;
        main.post(new Runnable() {
            @Override
            public void run() {
                if (shutDown) return;
                Utterance u = new Utterance(trimmed, lang, pitch, rate);
                ensureInit();
                if (state == READY) {
                    say(u);
                } else if (state == INITIALIZING) {
                    pending = u;
                }
            }
        });
    }

    void stop() {
        main.post(new Runnable() {
            @Override
            public void run() {
                pending = null;
                if (tts != null && state == READY) {
                    try {
                        tts.stop();
                    } catch (RuntimeException e) {
                        Log.w(TAG, "tts.stop failed", e);
                    }
                }
            }
        });
    }

    /** Must be called on the main thread (Activity.onDestroy). */
    void shutdown() {
        shutDown = true;
        pending = null;
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (RuntimeException e) {
                Log.w(TAG, "tts.shutdown failed", e);
            }
            tts = null;
        }
        state = FAILED;
    }

    private void ensureInit() {
        if (state != IDLE || shutDown) return;
        if (!hasEngine()) {
            state = FAILED;
            return;
        }
        state = INITIALIZING;
        TextToSpeech created;
        try {
            created = new TextToSpeech(context, this);
        } catch (RuntimeException e) {
            Log.w(TAG, "TextToSpeech unavailable", e);
            state = FAILED;
            return;
        }
        if (state == FAILED || shutDown) {
            // onInit(ERROR) can be delivered synchronously from inside the constructor
            // (no engine could be bound): release the half-built instance.
            try {
                created.shutdown();
            } catch (RuntimeException ignored) {
                // nothing bound
            }
            return;
        }
        tts = created;
        if (state == READY) onReady();
    }

    @Override
    public void onInit(int status) {
        // Delivered on the main thread, normally after ensureInit() returned.
        if (shutDown) return;
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "TextToSpeech init failed: " + status);
            state = FAILED;
            pending = null;
            if (tts != null) {
                try {
                    tts.shutdown();
                } catch (RuntimeException ignored) {
                    // engine already gone
                }
                tts = null;
            }
            return;
        }
        state = READY;
        if (tts != null) onReady();
    }

    private void onReady() {
        try {
            tts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
        } catch (RuntimeException e) {
            Log.w(TAG, "tts.setAudioAttributes failed", e);
        }
        Utterance u = pending;
        pending = null;
        if (u != null) say(u);
    }

    private void say(Utterance u) {
        if (tts == null) return;
        try {
            applyLocale(u.lang);
            tts.setPitch(clamp(u.pitch, 0.25f, 4f, 1f));
            tts.setSpeechRate(clamp(u.rate, 0.25f, 4f, 1f));
            String text = u.text;
            int max = TextToSpeech.getMaxSpeechInputLength();
            if (text.length() > max) text = text.substring(0, max);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "epic-" + (++utteranceSeq));
        } catch (RuntimeException e) {
            Log.w(TAG, "tts.speak failed", e);
        }
    }

    private void applyLocale(String lang) {
        Locale wanted = parseLocale(lang);
        if (wanted == null || wanted.equals(currentLocale)) return;
        Locale chosen = null;
        if (tts.isLanguageAvailable(wanted) >= TextToSpeech.LANG_AVAILABLE) {
            chosen = wanted;
        } else {
            Locale base = new Locale(wanted.getLanguage());
            if (tts.isLanguageAvailable(base) >= TextToSpeech.LANG_AVAILABLE) chosen = base;
        }
        if (chosen != null) {
            int r = tts.setLanguage(chosen);
            if (r >= TextToSpeech.LANG_AVAILABLE) currentLocale = wanted;
        } else {
            // Unsupported language: keep the engine default rather than failing silently.
            currentLocale = wanted;
            Log.i(TAG, "TTS language not available: " + lang);
        }
    }

    private boolean hasEngine() {
        Boolean cached = enginePresent;
        if (cached != null) return cached.booleanValue();
        boolean present;
        try {
            Intent probe = new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE);
            List<ResolveInfo> services = context.getPackageManager().queryIntentServices(probe, 0);
            present = services != null && !services.isEmpty();
        } catch (RuntimeException e) {
            present = true; // cannot tell: let TextToSpeech itself decide
        }
        enginePresent = Boolean.valueOf(present);
        return present;
    }

    static Locale parseLocale(String lang) {
        if (lang == null) return null;
        String tag = lang.trim().replace('_', '-');
        if (tag.length() == 0) return null;
        Locale l = Locale.forLanguageTag(tag);
        return l.getLanguage().length() == 0 ? null : l;
    }

    private static float clamp(float v, float lo, float hi, float fallback) {
        if (Float.isNaN(v) || v <= 0f) return fallback;
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
