package com.kino4tv.app;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * What Firebase brings (src/server/push/push.ts): a friend wrote, or put something in the inbox (shown as a notification, one for each friend, unless the app is on
 * the screen: the site shows its own then), or a new version of the app is out (checked and downloaded: Updates). A build without Firebase's file has none of it.
 */
public class KinoMessaging extends FirebaseMessagingService {

    /** Firebase is set up in this build. */
    static boolean available(Context context) {
        return BuildConfig.FIREBASE && !FirebaseApp.getApps(context).isEmpty();
    }

    /** Ask Firebase for this phone's token (kept, and the page told, when it comes), and listen to the news of new versions. */
    static void fetchToken(Context context) {
        if (!available(context)) return;
        Context app = context.getApplicationContext();
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> keep(app, token));
        FirebaseMessaging.getInstance().subscribeToTopic("app-updates");
    }

    private static void keep(Context context, String token) {
        if (token == null || token.equals(Prefs.of(context).getString(Prefs.PUSH_TOKEN, ""))) return;
        Prefs.of(context).edit().putString(Prefs.PUSH_TOKEN, token).apply();
        MainActivity open = MainActivity.open;
        if (open != null) open.tokenChanged();
    }

    @Override
    public void onNewToken(@NonNull String token) {
        keep(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String kind = data.get("kind");
        if (kind == null) return;
        if (kind.equals("update")) {
            Updates.checkNow(this, true);
            return;
        }
        if (MainActivity.onScreen) return;
        Notices.friend(this, kind, data.get("name"), data.get("friend"));
    }
}
