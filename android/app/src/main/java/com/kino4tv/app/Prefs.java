package com.kino4tv.app;

import android.content.Context;
import android.content.SharedPreferences;

/** What the app keeps for itself (none of it is the person's: the site keeps their things, in its cookies and storage). */
final class Prefs {
    private Prefs() {}

    static final String PUSH_TOKEN = "push.token";
    static final String WORDS = "push.words";
    static final String ASKED_NOTIFICATIONS = "push.asked";
    /** A page asked for the token (somebody is signed in): it is asked for again when the notifications are turned on. */
    static final String WANTS_PUSH = "push.wanted";
    /** Firebase was told to forget this phone, and has (KinoMessaging.stop): it is not told again until the notifications have been on. */
    static final String FIREBASE_OFF = "push.firebaseOff";
    static final String GOOGLE_VERIFIER = "google.verifier";
    static final String GOOGLE_ORIGIN = "google.origin";
    static final String GOOGLE_AT = "google.at";
    static final String UPDATE_CHECKED_AT = "update.checkedAt";
    static final String UPDATE_READY = "update.ready";
    /** An update handed to Android's installer, waiting for what it says (UpdateReceiver): its session, and since when. */
    static final String INSTALL_SESSION = "update.session";
    static final String INSTALL_AT = "update.sessionAt";

    static SharedPreferences of(Context context) {
        return context.getApplicationContext().getSharedPreferences("kino", Context.MODE_PRIVATE);
    }
}
