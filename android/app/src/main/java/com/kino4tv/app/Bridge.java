package com.kino4tv.app;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * `window.KinoApp`, how the site's pages and the app talk (client/app/kinoApp.ts), by messages. Android gives the object only to pages of the site's own
 * addresses (`Site.origins`), and the app answers only the page itself, never a frame in it (the judge, 17 Nov: given with addJavascriptInterface, every frame of
 * a page had it, a frame of another site too).
 *
 * The page says `hello` when it opens, and is told the app's version, the folders it can open a file chooser in, whether the app's notifications are on, and where
 * Firebase reaches this phone (only while they are on: with them off, the phone is not registered with Google at all). It asks for the token (`pushToken`, the
 * phone may ask the person whether the app may notify), gives the words of the notifications (`setStrings`), asks for a folder for its next file chooser
 * (`pickFrom`, answered `picking`), and brings a ticket for Google (`googleTicket`). The page that said hello last is told whenever the token, or whether the
 * notifications are on, changes (`state`).
 */
final class Bridge implements WebViewCompat.WebMessageListener {
    private final MainActivity activity;
    /** The page that said hello last (its frame: a new page says hello again). */
    private JavaScriptReplyProxy page;
    private String told = "";

    private Bridge(MainActivity activity) {
        this.activity = activity;
    }

    /** The bridge on this WebView, or nothing where the WebView is too old to have it (the site works all the same, without notifications or folders). */
    static Bridge install(MainActivity activity, WebView web) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null;
        Bridge bridge = new Bridge(activity);
        WebViewCompat.addWebMessageListener(web, "KinoApp", Site.origins(), bridge);
        return bridge;
    }

    /** (Android calls it on the main thread.) */
    @Override
    public void onPostMessage(@NonNull WebView view, @NonNull WebMessageCompat message, @NonNull Uri sourceOrigin, boolean isMainFrame, @NonNull JavaScriptReplyProxy reply) {
        if (!isMainFrame || !Site.isOwn(sourceOrigin) || message.getType() != WebMessageCompat.TYPE_STRING) return;
        String data = message.getData();
        if (data == null || data.length() > 16_000) return;
        JSONObject said;
        try {
            said = new JSONObject(data);
        } catch (JSONException broken) {
            return;
        }
        switch (said.optString("call")) {
            case "hello":
                page = reply;
                told = "";
                post(reply, hello());
                break;
            case "pushToken":
                Prefs.of(activity).edit().putBoolean(Prefs.WANTS_PUSH, true).apply();
                activity.askForNotificationsOnce();
                KinoMessaging.fetchToken(activity);
                stateChanged();
                break;
            case "setStrings": {
                String json = said.optString("json", "");
                if (json.length() > 8000) return;
                try {
                    new JSONObject(json);
                } catch (JSONException broken) {
                    return;
                }
                Prefs.of(activity).edit().putString(Prefs.WORDS, json).apply();
                Notices.channels(activity);
                break;
            }
            case "pickFrom": {
                String folder = said.optString("folder", "");
                JSONObject answer = new JSONObject();
                put(answer, "kind", "picking");
                put(answer, "folder", folder);
                put(answer, "known", activity.pickNextFrom(folder));
                post(reply, answer);
                break;
            }
            case "googleTicket":
                GoogleTrip.withTicket(activity, said.optString("ticket", ""));
                break;
            default:
                break;
        }
    }

    /** The token, or whether the notifications are on, may have changed: the page is told if it did. */
    void stateChanged() {
        JavaScriptReplyProxy to = page;
        if (to == null) return;
        JSONObject state = state("state");
        if (state.toString().equals(told)) return;
        post(to, state);
    }

    private JSONObject hello() {
        JSONObject hello = state("hello");
        put(hello, "version", BuildConfig.VERSION_NAME);
        JSONArray folders = new JSONArray();
        for (String folder : Folders.all()) folders.put(folder);
        put(hello, "folders", folders);
        return hello;
    }

    private JSONObject state(String kind) {
        boolean on = Notices.enabled(activity);
        JSONObject state = new JSONObject();
        put(state, "kind", kind);
        put(state, "notify", on);
        put(state, "token", on ? Prefs.of(activity).getString(Prefs.PUSH_TOKEN, "") : "");
        return state;
    }

    @SuppressLint("RequiresFeature") // (a page's proxy exists only where `install` found the feature)
    private void post(JavaScriptReplyProxy to, JSONObject message) {
        String kind = message.optString("kind");
        // (What the page was told of the state last: it is told again only when that changes.)
        if (kind.equals("hello") || kind.equals("state")) told = state("state").toString();
        to.postMessage(message.toString());
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
