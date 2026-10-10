package com.epicbadass.checkers;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * EPIC ШАШКИ — the whole native side: a full-screen immersive WebView that runs the bundled
 * web game from assets/www (see AssetWebViewClient) plus the window.AndroidBridge interface.
 *
 * Plain android.app.Activity, no AndroidX. Every API newer than minSdk 24 is behind a
 * Build.VERSION.SDK_INT check.
 */
public final class MainActivity extends Activity implements AssetWebViewClient.Host {
    private static final String TAG = "EpicCheckers";
    private static final String JS_TAG = "EpicCheckersJS";

    private static final String BACK_JS =
            "(function(){try{return window.__androidBack?String(window.__androidBack()):'false'}catch(e){return 'false'}})()";
    private static final String PAUSE_JS =
            "(function(){try{if(window.__androidPause)window.__androidPause()}catch(e){}})()";
    private static final String RESUME_JS =
            "(function(){try{if(window.__androidResume)window.__androidResume()}catch(e){}})()";

    /** A second back press while the page has not answered for this long exits anyway. */
    private static final long BACK_STUCK_MS = 1200L;
    /** Renderer crash-loop guard: give up after this many crashes inside the window. */
    private static final int MAX_RENDERER_RESTARTS = 3;
    private static final long RENDERER_RESTART_WINDOW_MS = 60000L;

    private FrameLayout root;
    private WebView webView;
    private Haptics haptics;
    private Speaker speaker;
    private NativeBridge bridge;

    private long backPendingSince;
    private int rendererRestarts;
    private long firstRendererRestartAt;
    private boolean started;
    private boolean recreateWhenStarted;

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Hardware volume keys control the game's (media) volume, not the ringer.
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applyImmersive();

        haptics = new Haptics(this);
        speaker = new Speaker(this);
        bridge = new NativeBridge(this, haptics, speaker);

        if (isDebuggable()) {
            try {
                WebView.setWebContentsDebuggingEnabled(true);
            } catch (RuntimeException e) {
                Log.w(TAG, "WebView debugging unavailable", e);
            }
        }
        createWebView();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // singleTask: re-launching from the home screen just brings the running game back.
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        started = true;
        if (recreateWhenStarted && webView == null && !isFinishing()) {
            recreateWhenStarted = false;
            createWebView();
        }
        if (webView != null) webView.resumeTimers();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersive();
        backPendingSince = 0L;
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript(RESUME_JS, null);
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            // Let the page pause music / timers first, then pause the WebView.
            webView.evaluateJavascript(PAUSE_JS, null);
            webView.onPause();
        }
        if (speaker != null) speaker.stop();
        if (haptics != null) haptics.cancel();
        super.onPause();
    }

    @Override
    protected void onStop() {
        started = false;
        // Global for all WebViews in the process: stops JS timers while the game is invisible.
        if (webView != null) webView.pauseTimers();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (speaker != null) speaker.shutdown();
        if (haptics != null) haptics.cancel();
        destroyWebView();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView == null) {
            finish();
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (backPendingSince != 0L) {
            // The page has not answered the previous back press yet (busy or hung).
            if (now - backPendingSince > BACK_STUCK_MS) finish();
            return;
        }
        backPendingSince = now;
        final WebView target = webView;
        target.evaluateJavascript(BACK_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                backPendingSince = 0L;
                if (target != webView || isFinishing()) return;
                // evaluateJavascript returns JSON: a JS string "true" arrives as "\"true\"".
                boolean handled = "\"true\"".equals(value) || "true".equals(value);
                if (!handled) finish();
            }
        });
    }

    // ------------------------------------------------------------------ WebView

    private void createWebView() {
        WebView wv;
        try {
            wv = new WebView(this);
        } catch (Throwable t) {
            // Missing / disabled / updating "Android System WebView" package. Do not crash.
            Log.e(TAG, "Cannot create WebView", t);
            showFatal(getString(R.string.webview_missing));
            return;
        }
        configureWebView(wv);
        webView = wv;
        backPendingSince = 0L; // an unanswered back press belonged to the previous WebView
        root.addView(wv, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        wv.loadUrl(AssetWebViewClient.START_URL);
    }

    @SuppressWarnings("deprecation")
    private void configureWebView(WebView wv) {
        wv.setBackgroundColor(Color.BLACK);
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        wv.setVerticalScrollBarEnabled(false);
        wv.setHorizontalScrollBarEnabled(false);
        wv.setHapticFeedbackEnabled(false);
        wv.setLongClickable(false);
        wv.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true; // no text-selection / context menu on long press
            }
        });
        wv.setFocusable(true);
        wv.setFocusableInTouchMode(true);

        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 26) {
            s.setSafeBrowsingEnabled(false); // offline bundled content only
        }
        if (Build.VERSION.SDK_INT >= 33) {
            s.setAlgorithmicDarkeningAllowed(false); // the game draws its own dark UI
        } else if (Build.VERSION.SDK_INT >= 29) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        wv.setWebViewClient(new AssetWebViewClient(getAssets(), this));
        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                String msg = m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")";
                ConsoleMessage.MessageLevel level = m.messageLevel();
                if (level == ConsoleMessage.MessageLevel.ERROR) {
                    Log.e(JS_TAG, msg);
                } else if (level == ConsoleMessage.MessageLevel.WARNING) {
                    Log.w(JS_TAG, msg);
                } else if (level == ConsoleMessage.MessageLevel.DEBUG) {
                    Log.d(JS_TAG, msg);
                } else {
                    Log.i(JS_TAG, msg);
                }
                return true;
            }
        });
        wv.addJavascriptInterface(bridge, NativeBridge.NAME);
    }

    private void destroyWebView() {
        WebView wv = webView;
        webView = null;
        if (wv == null) return;
        try {
            root.removeView(wv);
            wv.removeJavascriptInterface(NativeBridge.NAME);
            wv.stopLoading();
            wv.setWebChromeClient(null);
            wv.destroy();
        } catch (RuntimeException e) {
            Log.w(TAG, "WebView destroy failed", e);
        }
    }

    @Override
    public void onRendererGone(WebView view, boolean crashed) {
        if (view != webView) {
            // A WebView we already replaced: just make sure it is gone.
            try {
                root.removeView(view);
                view.destroy();
            } catch (RuntimeException ignored) {
                // already destroyed
            }
            return;
        }
        destroyWebView();
        if (isFinishing() || isDestroyed()) return;
        if (!started) {
            // Killed to reclaim memory while in the background: rebuild on return instead of
            // loading the whole game invisibly (and probably getting killed again).
            recreateWhenStarted = true;
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (rendererRestarts == 0 || now - firstRendererRestartAt > RENDERER_RESTART_WINDOW_MS) {
            rendererRestarts = 0;
            firstRendererRestartAt = now;
        }
        rendererRestarts++;
        if (rendererRestarts > MAX_RENDERER_RESTARTS) {
            Log.e(TAG, "WebView renderer keeps dying; giving up");
            finish();
            return;
        }
        Log.w(TAG, "Recreating WebView (" + rendererRestarts + "/" + MAX_RENDERER_RESTARTS
                + (crashed ? ", crash)" : ", killed)"));
        createWebView();
    }

    // ------------------------------------------------------------------ window

    /**
     * Hides the status and navigation bars (swipe shows them transiently). The display-cutout mode
     * stays at its default, which keeps the page below a notch / punch hole: see the note in
     * res/values/styles.xml (decision F9).
     */
    @SuppressWarnings("deprecation")
    private void applyImmersive() {
        Window w = getWindow();
        if (w == null) return;
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    private void showFatal(String message) {
        TextView tv = new TextView(this);
        tv.setText(message);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f);
        tv.setGravity(Gravity.CENTER);
        int pad = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 32f,
                getResources().getDisplayMetrics());
        tv.setPadding(pad, pad, pad, pad);
        root.removeAllViews();
        root.addView(tv, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }
}
