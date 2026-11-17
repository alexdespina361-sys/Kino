package com.kino4tv.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

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
     * asked for just before the notifications were turned off came back after, and kept the phone registered). Both are called on the main thread, what Firebase
     * answers comes there too, and a token Firebase brings by itself (`onNewToken`, on a thread of the service) is taken there.
     */
    private static final AtomicInteger turn = new AtomicInteger();
    /** The turn of the last turn on (0: none since the app started). */
    private static int turnedOn;
    /**
     * Firebase letting go of the phone: one at a time (another turn off while it is on its way is that one: two could end in either order, and the later delete
     * a token given in between, the judge, 17 Nov); a turn on waits for it, so the token it is given is never one being let go.
     */
    private static Task<Void> lettingGo;

    private static boolean lettingGoNow() {
        return lettingGo != null && !lettingGo.isComplete();
    }

    /** Ask Firebase for this phone's token (kept, and the page told, when it comes), and listen to the news of new versions: only while notifications are on. */
    static void fetchToken(Context context) {
        if (!available(context) || !Notices.enabled(context)) return;
        Context app = context.getApplicationContext();
        int mine = turn.incrementAndGet();
        turnedOn = mine;
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
        if (lettingGoNow()) lettingGo.addOnCompleteListener(done -> ask.run());
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
        turn.incrementAndGet();
        Prefs.of(app).edit().remove(Prefs.PUSH_TOKEN).apply();
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(false);
        if (had) told(app);
        if (lettingGoNow()) return; // (the one on its way lets go of the phone)
        int on = turnedOn;
        lettingGo = messaging.unsubscribeFromTopic(UPDATE_TOPIC)
                .continueWithTask(unsubscribed -> FirebaseMessaging.getInstance().deleteToken())
                .addOnCompleteListener(deleted -> {
                    // (Let go for good, unless the notifications were turned on meanwhile: then the next turn off lets go again.)
                    if (deleted.isSuccessful() && turnedOn == on) Prefs.of(app).edit().putBoolean(Prefs.FIREBASE_OFF, true).apply();
                });
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

    /**
     * Firebase brought a token by itself (it changed one it had): taken on the main thread, and only while the last turn was a turn on, with nothing being let go
     * and Firebase not told to forget the phone (a token of before a turn off, coming late, is not kept).
     */
    @Override
    public void onNewToken(@NonNull String token) {
        Context app = getApplicationContext();
        new Handler(Looper.getMainLooper()).post(() -> {
            if (turnedOn != turn.get() || lettingGoNow() || Prefs.of(app).getBoolean(Prefs.FIREBASE_OFF, false)) return;
            keep(app, token);
        });
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
