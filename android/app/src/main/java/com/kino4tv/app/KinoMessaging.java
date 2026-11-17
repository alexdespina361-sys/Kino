package com.kino4tv.app;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Task;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

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

    /**
     * Each turn on (`fetchToken`) or off (`stop`) of the phone's registration is a new turn: what comes back of an older one is let go (the judge, 17 Nov: a token
     * asked for just before the notifications were turned off came back after, and kept the phone registered). Both are called on the main thread, and what
     * Firebase answers comes there too.
     */
    private static final AtomicInteger turn = new AtomicInteger();
    /** The last turn off, while Firebase is letting go of the phone: a turn on waits for it, so the token it is given is never one being let go. */
    private static Task<Void> lettingGo;

    /** Ask Firebase for this phone's token (kept, and the page told, when it comes), and listen to the news of new versions: only while notifications are on. */
    static void fetchToken(Context context) {
        if (!available(context) || !Notices.enabled(context)) return;
        Context app = context.getApplicationContext();
        int mine = turn.incrementAndGet();
        Prefs.of(app).edit().putBoolean(Prefs.FIREBASE_OFF, false).apply();
        Runnable ask = () -> {
            if (turn.get() != mine) return;
            FirebaseMessaging messaging = FirebaseMessaging.getInstance();
            messaging.setAutoInitEnabled(true);
            messaging.getToken().addOnSuccessListener(token -> {
                if (turn.get() != mine || !Notices.enabled(app)) return;
                keep(app, token);
                FirebaseMessaging.getInstance().subscribeToTopic(UPDATE_TOPIC);
            });
        };
        Task<Void> before = lettingGo;
        if (before != null && !before.isComplete()) before.addOnCompleteListener(done -> ask.run());
        else ask.run();
    }

    /**
     * The notifications are off: Firebase lets go of the phone (its token, and the news of new versions), whether or not a token was kept here (one may have been
     * on its way), and the page is told (it tells the site to forget the phone too). Once Firebase has, it is not asked again until they have been on.
     */
    static void stop(Context context) {
        if (!available(context)) return;
        Context app = context.getApplicationContext();
        boolean had = !Prefs.of(app).getString(Prefs.PUSH_TOKEN, "").isEmpty();
        if (!had && Prefs.of(app).getBoolean(Prefs.FIREBASE_OFF, false)) return;
        int mine = turn.incrementAndGet();
        Prefs.of(app).edit().remove(Prefs.PUSH_TOKEN).apply();
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(false);
        lettingGo = messaging.unsubscribeFromTopic(UPDATE_TOPIC)
                .continueWithTask(unsubscribed -> FirebaseMessaging.getInstance().deleteToken())
                .addOnCompleteListener(deleted -> {
                    if (deleted.isSuccessful() && turn.get() == mine) Prefs.of(app).edit().putBoolean(Prefs.FIREBASE_OFF, true).apply();
                });
        if (had) told(app);
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
