package com.kino4tv.app;

import android.webkit.JavascriptInterface;

/**
 * `window.KinoApp`, what the site's pages ask the app (client/app/kinoApp.ts): its version, where Firebase reaches this phone, and the words of the notifications
 * in the profile's language. It answers only while the page is one of the site's own (the app shows no other, and the site has no frames of other sites).
 */
final class Bridge {
    private final MainActivity activity;

    Bridge(MainActivity activity) {
        this.activity = activity;
    }

    private boolean own() {
        return activity.pageHost != null;
    }

    @JavascriptInterface
    public String version() {
        return own() ? BuildConfig.VERSION_NAME : "";
    }

    /** The token, or "" until Firebase has given one (the page hears `kinoapp:push-token` when it does). Asking is a sign somebody is signed in: the phone asks once whether the app may notify. */
    @JavascriptInterface
    public String pushToken() {
        if (!own()) return "";
        activity.askForNotificationsOnce();
        KinoMessaging.fetchToken(activity);
        return Prefs.of(activity).getString(Prefs.PUSH_TOKEN, "");
    }

    /** The words of the notifications (a JSON object of the kinds), `{name}` where the friend's name goes. */
    @JavascriptInterface
    public void setStrings(String json) {
        if (!own() || json == null || json.length() > 8000) return;
        Prefs.of(activity).edit().putString(Prefs.WORDS, json).apply();
        Notices.channels(activity);
    }

    /** The ticket for a round trip to Google that needs the session of this WebView (GoogleTrip). */
    @JavascriptInterface
    public void googleTicket(String ticket) {
        if (!own()) return;
        activity.runOnUiThread(() -> GoogleTrip.withTicket(activity, ticket));
    }
}
