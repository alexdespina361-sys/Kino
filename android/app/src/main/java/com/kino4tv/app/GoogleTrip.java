package com.kino4tv.app;

import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import androidx.browser.customtabs.CustomTabsIntent;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

/**
 * "Continue with Google" from the app (src/server/accounts/google.ts, `AppTrip`): Google signs nobody in from a WebView, so the trip goes out to the phone's browser
 * (a Custom Tab) with the hash of a secret only this app knows, and comes back as kino4tv://google?code=... (an intent for this app's package alone: no other app is
 * given it); the WebView then brings the code and the secret to the site, which signs the WebView in. Connecting Google to the account, or confirming who is here,
 * needs the WebView's own session: the WebView asks the site for a ticket first, the browser starts with that, and the site connects or confirms only when this
 * same WebView brings the code back.
 */
final class GoogleTrip {
    private GoogleTrip() {}

    private static final long TRIP_MS = 10 * 60_000L;
    private static final SecureRandom RANDOM = new SecureRandom();

    private static String base64url(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String challengeOf(String verifier) {
        try {
            return base64url(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** A new secret for a trip that starts at `origin` (kept until the app comes back, ten minutes at most). */
    private static String newChallenge(MainActivity activity, String origin) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String verifier = base64url(bytes);
        Prefs.of(activity).edit()
                .putString(Prefs.GOOGLE_VERIFIER, verifier)
                .putString(Prefs.GOOGLE_ORIGIN, origin)
                .putLong(Prefs.GOOGLE_AT, System.currentTimeMillis())
                .apply();
        return challengeOf(verifier);
    }

    /** The page's start without an `app=` of its own (only the app's secret goes): the other parameters as they were. */
    private static Uri.Builder without(Uri start, String name) {
        Uri.Builder clean = start.buildUpon().clearQuery();
        for (String key : start.getQueryParameterNames()) {
            if (key.equals(name)) continue;
            for (String value : start.getQueryParameters(key)) clean.appendQueryParameter(key, value);
        }
        return clean;
    }

    /** The page went to `/api/auth/google/start?...`: out to the browser, signing in with the app's secret, or after asking for a ticket. */
    static void start(MainActivity activity, Uri start) {
        String origin = Site.originOf(start);
        String mode = start.getQueryParameter("mode");
        if (mode == null || mode.equals("signin")) {
            String challenge = newChallenge(activity, origin);
            openTab(activity, without(start, "app").appendQueryParameter("app", challenge).build());
            return;
        }
        // (Connecting or confirming needs the WebView's own session: its ticket comes back by the bridge, which a WebView too old for it does not have.)
        if (!activity.bridged()) {
            activity.web().loadUrl(origin + ("/tv".equals(start.getQueryParameter("next")) ? "/tv" : "/") + "?google=failed");
            return;
        }
        String challenge = newChallenge(activity, origin);
        String device = start.getQueryParameter("device");
        String next = start.getQueryParameter("next");
        String body = "{\"mode\":" + quote(mode) + ",\"challenge\":" + quote(challenge) + ",\"device\":" + quote(device == null ? "browser" : device)
                + ",\"next\":" + quote("/tv".equals(next) ? "/tv" : "/") + "}";
        String script = "fetch('/api/auth/google/app-ticket',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:" + quote(body) + "})"
                + ".then(function(r){return r.ok?r.json():{}},function(){return {}})"
                + ".then(function(j){KinoApp.postMessage(JSON.stringify({call:'googleTicket',ticket:(j&&j.ticket)||''}))})";
        activity.web().evaluateJavascript(script, null);
    }

    static void withTicket(MainActivity activity, String ticket) {
        String origin = Prefs.of(activity).getString(Prefs.GOOGLE_ORIGIN, BuildConfig.SITE);
        if (ticket == null || !ticket.matches("[A-Za-z0-9_-]{43}")) {
            activity.web().loadUrl(origin + "/?google=failed");
            return;
        }
        openTab(activity, Uri.parse(origin + "/api/auth/google/start").buildUpon().appendQueryParameter("ticket", ticket).build());
    }

    private static void openTab(MainActivity activity, Uri uri) {
        try {
            new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, uri);
        } catch (RuntimeException noBrowser) {
            activity.openOutside(uri);
        }
    }

    /** How much of the secret's hash the way back brings (src/server/accounts/google.ts `APP_TRIP_LENGTH`). */
    private static final int TRIP_LENGTH = 16;

    /**
     * Where the WebView goes with the code it came back with (once: the secret is used up), or nothing for a code this app did not ask for just now. The way back
     * says the start of the secret's hash (`trip`): one that does not is not this trip's, and leaves the secret as it was (another app can open this one with a
     * made-up code; it cannot know the hash, so it cannot spoil the trip on its way: the judge, 17 Nov).
     */
    static String claimUrl(MainActivity activity, Uri back) {
        SharedPreferences prefs = Prefs.of(activity);
        String verifier = prefs.getString(Prefs.GOOGLE_VERIFIER, null);
        String origin = prefs.getString(Prefs.GOOGLE_ORIGIN, null);
        long at = prefs.getLong(Prefs.GOOGLE_AT, 0);
        String code = back.getQueryParameter("code");
        String trip = back.getQueryParameter("trip");
        if (verifier == null || origin == null || code == null || !code.matches("[A-Za-z0-9_-]{43}")) return null;
        if (trip == null || !trip.equals(challengeOf(verifier).substring(0, TRIP_LENGTH))) return null;
        prefs.edit().remove(Prefs.GOOGLE_VERIFIER).remove(Prefs.GOOGLE_ORIGIN).remove(Prefs.GOOGLE_AT).apply();
        if (System.currentTimeMillis() - at > TRIP_MS) return null;
        return Uri.parse(origin + "/api/auth/google/app-claim").buildUpon().appendQueryParameter("code", code).appendQueryParameter("verifier", verifier).build().toString();
    }

    /** A JavaScript string of `text`. */
    private static String quote(String text) {
        StringBuilder out = new StringBuilder("\"");
        for (char letter : text.toCharArray()) {
            if (letter == '"' || letter == '\\') out.append('\\').append(letter);
            else if (letter < 0x20 || letter == '<' || letter == '>' || letter == '\'' || letter > 0x7e) out.append(String.format("\\u%04x", (int) letter));
            else out.append(letter);
        }
        return out.append('"').toString();
    }
}
