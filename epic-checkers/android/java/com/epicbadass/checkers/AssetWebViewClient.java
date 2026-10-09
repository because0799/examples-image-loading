package com.epicbadass.checkers;

import android.content.res.AssetManager;
import android.net.Uri;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves the bundled web app from assets/www at https://appassets.androidplatform.net/ (the
 * same reserved host androidx WebViewAssetLoader uses; it never resolves on the internet).
 * Using a real https origin (instead of file://) gives the page a secure context: Blob
 * workers, localStorage, Wake Lock, fonts and fetch all behave like on the web.
 * Any other http(s) host gets an empty 404 — the game is fully offline.
 */
final class AssetWebViewClient extends WebViewClient {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    static final String START_URL = ORIGIN + "/index.html";

    private static final String TAG = "EpicCheckers";
    private static final String ASSET_ROOT = "www/";
    private static final Map<String, String> MIME = new HashMap<String, String>();
    private static final byte[] EMPTY = new byte[0];

    static {
        MIME.put("html", "text/html");
        MIME.put("htm", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("map", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("txt", "text/plain");
        MIME.put("xml", "text/xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
        MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("wav", "audio/wav");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("ogg", "audio/ogg");
        MIME.put("m4a", "audio/mp4");
        MIME.put("mp4", "video/mp4");
        MIME.put("webm", "video/webm");
        MIME.put("wasm", "application/wasm");
    }

    /** Callbacks into the hosting activity (UI thread). */
    interface Host {
        void onRendererGone(WebView view, boolean crashed);
    }

    private final AssetManager assets;
    private final Host host;

    AssetWebViewClient(AssetManager assets, Host host) {
        this.assets = assets;
        this.host = host;
    }

    static boolean isAppUrl(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String scheme = uri == null ? null : uri.getScheme();
        if (scheme == null) return null;
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            return null; // data:, blob:, about: … are handled by Chromium itself
        }
        if (!isAppUrl(uri)) {
            Log.w(TAG, "blocked network request: " + uri);
            return error(404, "Not Found");
        }
        String method = request.getMethod();
        if (method != null && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            return error(405, "Method Not Allowed");
        }
        String path = assetPath(uri.getPath());
        if (path == null) return error(404, "Not Found");
        InputStream in;
        try {
            in = assets.open(ASSET_ROOT + path, AssetManager.ACCESS_STREAMING);
        } catch (IOException e) {
            Log.w(TAG, "404 " + path);
            return error(404, "Not Found");
        }
        String mime = mimeType(path);
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("X-Content-Type-Options", "nosniff");
        String encoding = isText(mime) ? "utf-8" : null;
        return new WebResourceResponse(mime, encoding, 200, "OK", headers, in);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (isAppUrl(uri)) return false; // our own pages load inside the WebView
        Log.w(TAG, "blocked navigation: " + uri);
        return true; // never leave the game, never launch other apps
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
            Log.e(TAG, "main frame error " + error.getErrorCode() + " " + error.getDescription()
                    + " for " + request.getUrl());
        }
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        // Only invoked on API 26+, so RenderProcessGoneDetail is always resolvable here.
        boolean crashed = detail != null && detail.didCrash();
        Log.e(TAG, "WebView renderer gone (" + (crashed ? "crash" : "killed by system") + ")");
        host.onRendererGone(view, crashed);
        return true; // we handled it: the activity recreates the WebView instead of dying
    }

    /** Normalises a request path into an asset path, or null if it tries to escape www/. */
    static String assetPath(String rawPath) {
        String p = rawPath == null ? "" : rawPath;
        while (p.startsWith("/")) p = p.substring(1);
        if (p.length() == 0 || p.endsWith("/")) p = p + "index.html";
        if (p.indexOf('\\') >= 0 || p.indexOf('\0') >= 0) return null;
        String[] parts = p.split("/");
        for (int i = 0; i < parts.length; i++) {
            if (parts[i].length() == 0 || ".".equals(parts[i]) || "..".equals(parts[i])) return null;
        }
        return p;
    }

    static String mimeType(String path) {
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        if (dot < 0 || dot < slash) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String m = MIME.get(ext);
        return m != null ? m : "application/octet-stream";
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json")
                || mime.equals("application/manifest+json") || mime.equals("image/svg+xml");
    }

    private static WebResourceResponse error(int code, String reason) {
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", code, reason, headers,
                new ByteArrayInputStream(EMPTY));
    }
}
