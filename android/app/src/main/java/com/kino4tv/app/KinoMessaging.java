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
 *
 * The phone is registered with Firebase only while the app's notifications are on (Notices.enabled) and a page asked for it (somebody is signed in): Firebase's
 * own start-up registration is off (AndroidManifest.xml), and turning the notifications off lets the token go, so nothing goes through Google for a phone that
 * shows none (the judge, 17 Nov). The news of new versions then comes only when the app looks for itself (Updates).
 */
public class KinoMessaging extends FirebaseMessagingService {
    private static final String UPDATE_TOPIC = "app-updates";

    /** Firebase is set up in this build. */
    static boolean available(Context context) {
        return BuildConfig.FIREBASE && !FirebaseApp.getApps(context).isEmpty();
    }

    /** Ask Firebase for this phone's token (kept, and the page told, when it comes), and listen to the news of new versions: only while notifications are on. */
    static void fetchToken(Context context) {
        if (!available(context) || !Notices.enabled(context)) return;
        Context app = context.getApplicationContext();
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(true);
        messaging.getToken().addOnSuccessListener(token -> {
            keep(app, token);
            FirebaseMessaging.getInstance().subscribeToTopic(UPDATE_TOPIC);
        });
    }

    /** The notifications were turned off: the token is let go (Firebase forgets this phone), and the page is told (it tells the site to forget it too). */
    static void stop(Context context) {
        if (!available(context)) return;
        boolean had = !Prefs.of(context).getString(Prefs.PUSH_TOKEN, "").isEmpty();
        Prefs.of(context).edit().remove(Prefs.PUSH_TOKEN).apply();
        if (!had) return;
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(false);
        messaging.unsubscribeFromTopic(UPDATE_TOPIC).addOnCompleteListener(done -> FirebaseMessaging.getInstance().deleteToken());
        told(context);
    }

    private static void keep(Context context, String token) {
        if (token == null || !Notices.enabled(context) || token.equals(Prefs.of(context).getString(Prefs.PUSH_TOKEN, ""))) return;
        Prefs.of(context).edit().putString(Prefs.PUSH_TOKEN, token).apply();
        told(context);
    }

    private static void told(Context context) {
        MainActivity open = MainActivity.open;
        if (open != null) open.notificationsChanged();
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
            Updates.checkNow(this);
            return;
        }
        if (MainActivity.onScreen) return;
        Notices.friend(this, kind, data.get("name"), data.get("friend"));
    }
}
