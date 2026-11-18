package com.kino4tv.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

/** The notifications: the friends' (one for each friend, the newest in its place) and the news that an update is ready to install. */
final class Notices {
    private Notices() {}

    static final String FRIENDS = "friends";
    static final String UPDATES = "updates";
    private static final int UPDATE_ID = 1;

    /** The words the site gave (in the profile's language), else English. */
    static String word(Context context, String kind, String english) {
        try {
            String said = new JSONObject(Prefs.of(context).getString(Prefs.WORDS, "{}")).optString(kind, "");
            return said.isEmpty() ? english : said;
        } catch (Exception broken) {
            return english;
        }
    }

    private static String english(String kind) {
        switch (kind) {
            case "chat": return "{name} sent you a message";
            case "recommend": return "{name} sent you something to watch";
            case "party": return "{name} invites you to their watch party";
            case "together": return "{name} wants to watch together";
            case "plan": return "{name} asks when you can watch together";
            case "planYes": return "{name} said yes to your plan";
            case "planNo": return "{name} can't make your plan";
            // (Not from a friend: something new of a title the profile watches. The site never says which.)
            case "title": return "Something you watch has a new episode or film";
            default: return "";
        }
    }

    static void channels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.createNotificationChannel(new NotificationChannel(FRIENDS, word(context, "channel", "Friends"), NotificationManager.IMPORTANCE_HIGH));
        manager.createNotificationChannel(new NotificationChannel(UPDATES, "Kino", NotificationManager.IMPORTANCE_DEFAULT));
    }

    private static boolean allowed(Context context) {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Whether the friends' notifications can be shown: the app may notify (Android 13 and later ask; before, it is a switch in the phone's settings), and their
     * channel is not turned off. While they cannot, the phone is not registered with Firebase at all (KinoMessaging), and the site is told of no phone.
     */
    static boolean enabled(Context context) {
        if (!allowed(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel friends = manager == null ? null : manager.getNotificationChannel(FRIENDS);
        return friends == null || friends.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private static PendingIntent openApp(Context context, Intent intent, int code) {
        return PendingIntent.getActivity(context, code, intent.setClass(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void friend(Context context, String kind, String name, String friend) {
        // (A kind this version has no words for is shown in the site's words, when the site gave some: a kind added to the site later needs no new app.
        // One that neither knows is not shown.)
        String words = word(context, kind, english(kind));
        if (words.isEmpty() || !allowed(context)) return;
        channels(context);
        String who = name == null || name.trim().isEmpty() ? "Kino" : name.trim();
        String text = words.replace("{name}", who);
        // (One notification for each friend's messages and one for what each sent; one for everything that is from nobody, by its kind.)
        String tag = friend == null || friend.isEmpty() ? kind : friend + (kind.equals("chat") ? ":chat" : ":inbox");
        NotificationCompat.Builder built = new NotificationCompat.Builder(context, FRIENDS)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(who)
                .setContentText(text)
                .setAutoCancel(true)
                .setCategory(kind.equals("chat") ? NotificationCompat.CATEGORY_MESSAGE : NotificationCompat.CATEGORY_SOCIAL)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(openApp(context, new Intent(), tag.hashCode()));
        try {
            NotificationManagerCompat.from(context).notify(tag, 0, built.build());
        } catch (SecurityException notAllowed) {
            // (the person took the permission back)
        }
    }

    static void updateReady(Context context) {
        if (!allowed(context)) return;
        channels(context);
        NotificationCompat.Builder built = new NotificationCompat.Builder(context, UPDATES)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(word(context, "updateReady", "A new version of Kino is ready"))
                .setContentText(word(context, "updateInstall", "Install"))
                .setAutoCancel(true)
                .setContentIntent(openApp(context, new Intent().putExtra(Updates.EXTRA_INSTALL, true), UPDATE_ID));
        try {
            NotificationManagerCompat.from(context).notify(UPDATE_ID, built.build());
        } catch (SecurityException notAllowed) {
            // (the person took the permission back)
        }
    }
}
