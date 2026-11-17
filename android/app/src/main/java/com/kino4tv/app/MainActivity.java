package com.kino4tv.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.UiModeManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * The app: the site in a WebView, full screen (docs/android-app.md). Only the site's own pages are shown here; any other address opens in the phone's browser,
 * and "Continue with Google" goes out to it as well (Google signs nobody in from a WebView: see GoogleTrip). A video's full screen is the phone's, Back is the
 * page's (a phone goes back a page, a TV's remote is told to the page as its Back key), files can be picked for stickers, and the code scanner may use the camera.
 */
public class MainActivity extends ComponentActivity {
    /** Whether the app is on the screen: then the friends' notifications are not shown (the site shows its own). */
    static volatile boolean onScreen;
    /** The one that is open, for the messaging service to tell of a new token. */
    static volatile MainActivity open;
    /** How the site's pages and the app talk (nothing on a WebView too old for it). */
    private Bridge bridge;
    /** The folder the page's next file chooser opens in (Bridge `pickFrom`), for a few seconds. */
    private String nextFolder;
    private long nextFolderAt;
    private static final long FOLDER_MS = 10_000L;

    private WebView web;
    private FrameLayout root;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenDone;
    private ValueCallback<Uri[]> picked;
    private PermissionRequest cameraAsked;
    private boolean tv;

    private ActivityResultLauncher<Intent> pickFiles;
    private ActivityResultLauncher<String> askCamera;
    private ActivityResultLauncher<String> askNotifications;

    /** The page's Back key, for a TV: false when the page took it. */
    private static final String BACK_KEY = "(function(){var t=document.activeElement||document.body;"
            + "return t.dispatchEvent(new KeyboardEvent('keydown',{key:'GoBack',code:'GoBack',bubbles:true,cancelable:true}));})()";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        open = this;
        UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        tv = (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) || !getPackageManager().hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN);

        pickFiles = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (picked == null) return;
            picked.onReceiveValue(chosen(result.getResultCode(), result.getData()));
            picked = null;
        });
        askCamera = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (cameraAsked == null) return;
            if (granted) cameraAsked.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else cameraAsked.deny();
            cameraAsked = null;
        });
        askNotifications = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted) KinoMessaging.fetchToken(this);
            notificationsChanged();
        });

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // (Android 15 draws every app under its bars: the page is kept clear of them, and of the keyboard. A video's full screen takes all of it.)
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            if (fullscreen == null) view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            else view.setPadding(0, 0, 0, 0);
            return WindowInsetsCompat.CONSUMED;
        });
        new WindowInsetsControllerCompat(getWindow(), root).setAppearanceLightStatusBars(false);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " KinoApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        bridge = Bridge.install(this, web);
        web.setWebViewClient(new Pages());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, agent, disposition, type, length) -> openOutside(Uri.parse(url)));

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                back();
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        if (web.copyBackForwardList().getSize() == 0) web.loadUrl(BuildConfig.SITE + "/");
        handle(getIntent());
        Updates.checkSoon(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    /** The way back from Google, or a notification that was tapped. */
    private void handle(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && "kino4tv".equals(data.getScheme()) && "google".equals(data.getHost())) {
            String claim = GoogleTrip.claimUrl(this, data);
            if (claim != null) web.loadUrl(claim);
            return;
        }
        if (intent.getBooleanExtra(Updates.EXTRA_INSTALL, false)) Updates.installDownloaded(this, true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        onScreen = true;
        web.onResume();
        // (The notifications may have been turned off, or on, in the phone's settings meanwhile: the phone is let go of Firebase, or registered again.)
        if (!Notices.enabled(this)) KinoMessaging.stop(this);
        else if (Prefs.of(this).getBoolean(Prefs.WANTS_PUSH, false)) KinoMessaging.fetchToken(this);
        notificationsChanged();
    }

    @Override
    protected void onPause() {
        onScreen = false;
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (open == this) open = null;
        web.destroy();
        super.onDestroy();
    }

    private void back() {
        if (fullscreen != null) {
            leaveFullscreen();
            return;
        }
        if (tv) {
            // (A TV's page hears its remote's Back as a key, and says when it took it; when it did not, Back goes back a page, and out of the app from the first.)
            web.evaluateJavascript(BACK_KEY, untaken -> {
                if (!"true".equals(untaken)) return;
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            });
            return;
        }
        if (web.canGoBack()) web.goBack();
        else finish();
    }

    /** The token, or whether the notifications are on, may have changed: the page is told (it tells the server, or has it forget this phone). */
    void notificationsChanged() {
        runOnUiThread(() -> {
            if (bridge != null) bridge.stateChanged();
        });
    }

    /** The page's next file chooser opens in `folder` (for a few seconds): false for a folder the app does not know. */
    boolean pickNextFrom(String folder) {
        if (!Folders.known(folder)) return false;
        nextFolder = folder;
        nextFolderAt = SystemClock.elapsedRealtime();
        return true;
    }

    /** What was chosen: one file or several (Android says several in its ClipData), or nothing. */
    private static Uri[] chosen(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) return null;
        ClipData clip = data.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            List<Uri> uris = new ArrayList<>();
            for (int at = 0; at < clip.getItemCount(); at++) {
                Uri uri = clip.getItemAt(at).getUri();
                if (uri != null) uris.add(uri);
            }
            if (!uris.isEmpty()) return uris.toArray(new Uri[0]);
        }
        return data.getData() == null ? null : new Uri[] {data.getData()};
    }

    /** Whether the bridge is there (a WebView too old for it has none: then nothing of the app's own can be asked by the page). */
    boolean bridged() {
        return bridge != null;
    }

    /** Asked the first time a page wants the token (somebody is signed in on a profile): Android 13 and later ask the person whether the app may notify. */
    void askForNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        if (Prefs.of(this).getBoolean(Prefs.ASKED_NOTIFICATIONS, false)) return;
        Prefs.of(this).edit().putBoolean(Prefs.ASKED_NOTIFICATIONS, true).apply();
        runOnUiThread(() -> askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS));
    }

    /** Somewhere that is not the site: the phone's browser, or the app that opens it. */
    void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
            // (nothing on this phone opens it)
        }
    }

    WebView web() {
        return web;
    }

    private void leaveFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        web.setVisibility(View.VISIBLE);
        new WindowInsetsControllerCompat(getWindow(), root).show(WindowInsetsCompat.Type.systemBars());
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ViewCompat.requestApplyInsets(root);
        if (fullscreenDone != null) fullscreenDone.onCustomViewHidden();
        fullscreenDone = null;
    }

    private final class Pages extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            if (Site.isOwn(uri)) {
                if ("/api/auth/google/start".equals(uri.getPath())) {
                    GoogleTrip.start(MainActivity.this, uri);
                    return true;
                }
                return false;
            }
            openOutside(uri);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            // (No connection: a page of the app's own says so, and tries again with a press.)
            String again = BuildConfig.SITE + "/";
            view.loadDataWithBaseURL(null, Offline.page(MainActivity.this, again), "text/html", "utf-8", null);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreen != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreen = view;
            fullscreenDone = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.INVISIBLE);
            WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(getWindow(), root);
            bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(WindowInsetsCompat.Type.systemBars());
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            ViewCompat.requestApplyInsets(root);
        }

        @Override
        public void onHideCustomView() {
            leaveFullscreen();
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (picked != null) picked.onReceiveValue(null);
            picked = callback;
            // (The folder the page asked for just now, if it did: once.)
            String folder = nextFolder != null && SystemClock.elapsedRealtime() - nextFolderAt < FOLDER_MS ? nextFolder : null;
            nextFolder = null;
            if (folder != null) {
                try {
                    pickFiles.launch(Folders.chooser(folder, params));
                    return true;
                } catch (ActivityNotFoundException | SecurityException noFiles) {
                    // (no file chooser of Android's own on this phone: the page's as it is)
                }
            }
            try {
                pickFiles.launch(params.createIntent());
            } catch (ActivityNotFoundException error) {
                picked = null;
                return false;
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean camera = false;
            for (String resource : request.getResources()) camera |= PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource);
            if (!camera || !Site.isOwn(request.getOrigin())) {
                request.deny();
                return;
            }
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                return;
            }
            if (cameraAsked != null) cameraAsked.deny();
            cameraAsked = request;
            askCamera.launch(Manifest.permission.CAMERA);
        }
    }
}
