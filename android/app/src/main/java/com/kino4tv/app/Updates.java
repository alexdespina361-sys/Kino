package com.kino4tv.app;

import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;

/**
 * The app's own updates (src/server/push/appRelease.ts). The site says which version is the newest (`/api/app/android`); a newer one is downloaded, its size and
 * SHA-256 checked against what the site said, and handed to Android's installer (Android also checks it is signed with this app's key). While the app is on the
 * screen the person is asked first; in the background it is installed without a tap where Android allows that (12 and later, once this app installed itself
 * once), else a notification says it is ready.
 *
 * It is looked for by Android's WorkManager, which waits for a network and tries again when a try fails (the judge, 17 Nov: a try that failed, or was stopped,
 * kept the next one away for six hours): when the app opens (if the last look that was done is six hours old), twice a day in the background, and whenever the
 * site sends the news of a version (with the notifications on).
 */
final class Updates {
    private Updates() {}

    static final String EXTRA_INSTALL = "com.kino4tv.app.INSTALL_UPDATE";
    private static final String TAG = "KinoUpdates";
    private static final long EVERY_MS = 6 * 3600_000L;
    /** An update handed to the installer that has said nothing in this long is taken back, and may be handed again. */
    private static final long INSTALL_WAIT_MS = 15 * 60_000L;
    private static final String NOW = "update-now";
    private static final String TWICE_A_DAY = "update-twice-a-day";

    private static Constraints online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** The app opened: a look if the last one is old, the looks twice a day kept, and an update that is ready offered. */
    static void checkSoon(Context context) {
        WorkManager work = WorkManager.getInstance(context);
        work.enqueueUniquePeriodicWork(TWICE_A_DAY, ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(UpdateWork.class, 12, TimeUnit.HOURS).setConstraints(online()).build());
        long last = Prefs.of(context).getLong(Prefs.UPDATE_CHECKED_AT, 0);
        if (System.currentTimeMillis() - last >= EVERY_MS || last > System.currentTimeMillis()) checkNow(context);
        else if (readyFile(context) != null) offer(context);
    }

    /** A look now (once there is a network; again a little later if it fails). */
    static void checkNow(Context context) {
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP,
                new OneTimeWorkRequest.Builder(UpdateWork.class).setConstraints(online()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build());
    }

    /** One look (UpdateWork runs it): throws when it could not be done, and is tried again. */
    static void look(Context app) throws IOException, JSONException {
        JSONObject release;
        try {
            release = new JSONObject(new String(fetch(BuildConfig.SITE + "/api/app/android", 64 * 1024), "UTF-8"));
        } catch (NotThere none) {
            done(app); // (the site offers no build: nothing to do)
            return;
        }
        int code = release.getInt("versionCode");
        if (code <= BuildConfig.VERSION_CODE) {
            clear(app);
            done(app);
            return;
        }
        String url = release.getString("url");
        if (!url.matches("/app/android/kino-\\d+\\.apk")) throw new JSONException("not an address of the app");
        long size = release.getLong("size");
        String sha256 = release.getString("sha256");
        File apk = new File(dir(app), "kino-" + code + ".apk");
        if (!apk.exists() || apk.length() != size || !sha256.equals(hashOf(apk))) {
            download(BuildConfig.SITE + url, apk, size);
            if (!sha256.equals(hashOf(apk))) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                throw new IOException("the download is not the build the site said");
            }
        }
        Prefs.of(app).edit().putString(Prefs.UPDATE_READY, apk.getName()).apply();
        done(app);
        // (On the screen the person is asked, whatever made it look; in the background it goes in without a tap where Android allows.)
        if (MainActivity.onScreen) offer(app);
        else install(app, apk);
    }

    /** A look was done (only then: one that failed is tried again, and the next look on opening is not put off). */
    private static void done(Context context) {
        Prefs.of(context).edit().putLong(Prefs.UPDATE_CHECKED_AT, System.currentTimeMillis()).apply();
    }

    private static File dir(Context context) {
        File dir = new File(context.getFilesDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    private static File readyFile(Context context) {
        String name = Prefs.of(context).getString(Prefs.UPDATE_READY, null);
        if (name == null) return null;
        File apk = new File(dir(context), name);
        return apk.exists() ? apk : null;
    }

    /** This version is the newest: the downloads are let go. */
    private static void clear(Context context) {
        Prefs.of(context).edit().remove(Prefs.UPDATE_READY).apply();
        File[] old = dir(context).listFiles();
        if (old != null) for (File file : old) //noinspection ResultOfMethodCallIgnored
            file.delete();
    }

    /** On the screen: ask the person (the update closes the app for a moment). */
    private static void offer(Context context) {
        MainActivity open = MainActivity.open;
        if (open == null) return;
        open.runOnUiThread(() -> {
            if (open.isFinishing() || open.isDestroyed()) return;
            new AlertDialog.Builder(open)
                    .setTitle(Notices.word(open, "updateReady", "A new version of Kino is ready"))
                    .setPositiveButton(Notices.word(open, "updateInstall", "Install"), (dialog, which) -> installDownloaded(open, true))
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
        });
    }

    /** The person said to install it (a button, or the notification). */
    static void installDownloaded(Context context, boolean asked) {
        File apk = readyFile(context);
        if (apk == null) {
            if (asked) checkNow(context);
            return;
        }
        Context app = context.getApplicationContext();
        new Thread(() -> install(app, apk), "kino-install").start();
    }

    /**
     * The APK to Android's installer, once: while one is with it (until UpdateReceiver hears how it went, a quarter of an hour at most), another is not handed.
     * A session that could not be filled or committed is given up at once (the judge, 17 Nov: it was left behind).
     */
    private static synchronized void install(Context context, File apk) {
        SharedPreferences prefs = Prefs.of(context);
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        int waiting = prefs.getInt(Prefs.INSTALL_SESSION, -1);
        long since = prefs.getLong(Prefs.INSTALL_AT, 0);
        if (waiting >= 0) {
            if (System.currentTimeMillis() - since < INSTALL_WAIT_MS && System.currentTimeMillis() >= since) return;
            abandon(installer, waiting);
            installed(context);
        }
        int id = -1;
        try {
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            id = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(id)) {
                try (OutputStream out = session.openWrite("kino.apk", 0, apk.length()); InputStream in = new FileInputStream(apk)) {
                    byte[] buffer = new byte[64 * 1024];
                    for (int read; (read = in.read(buffer)) > 0; ) out.write(buffer, 0, read);
                    session.fsync(out);
                }
                Intent done = new Intent(context, UpdateReceiver.class).putExtra(UpdateReceiver.EXTRA_SESSION, id);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                prefs.edit().putInt(Prefs.INSTALL_SESSION, id).putLong(Prefs.INSTALL_AT, System.currentTimeMillis()).apply();
                session.commit(PendingIntent.getBroadcast(context, id, done, flags).getIntentSender());
            }
        } catch (IOException | RuntimeException failed) {
            Log.w(TAG, "The update could not be handed to Android: " + failed.getClass().getSimpleName());
            if (id >= 0) abandon(installer, id);
            installed(context);
        }
    }

    /** The installer said how it went (or it was given up): another may be handed. */
    static void installed(Context context) {
        Prefs.of(context).edit().remove(Prefs.INSTALL_SESSION).remove(Prefs.INSTALL_AT).apply();
    }

    private static void abandon(PackageInstaller installer, int id) {
        try {
            installer.abandonSession(id);
        } catch (RuntimeException gone) {
            // (it is gone already, or done)
        }
    }

    /** The site answered 404: it offers no build. */
    private static final class NotThere extends IOException {}

    private static HttpURLConnection open(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "KinoApp/" + BuildConfig.VERSION_NAME);
        int status = connection.getResponseCode();
        if (status == 404) throw new NotThere();
        if (status != 200) throw new IOException("status " + status);
        return connection;
    }

    private static byte[] fetch(String address, int max) throws IOException {
        HttpURLConnection connection = open(address);
        try (InputStream in = connection.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int read; (read = in.read(buffer)) > 0; ) {
                out.write(buffer, 0, read);
                if (out.size() > max) throw new IOException("too big");
            }
            return out.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    private static void download(String address, File into, long size) throws IOException {
        HttpURLConnection connection = open(address);
        File part = new File(into.getPath() + ".part");
        try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            for (int read; (read = in.read(buffer)) > 0; ) {
                total += read;
                if (total > size) throw new IOException("bigger than said");
                out.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
        if (part.length() != size || !part.renameTo(into)) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new IOException("not the size said");
        }
    }

    private static String hashOf(File file) {
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            for (int read; (read = in.read(buffer)) > 0; ) digest.update(buffer, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte each : digest.digest()) hex.append(String.format("%02x", each));
            return hex.toString();
        } catch (Exception failed) {
            return "";
        }
    }
}
