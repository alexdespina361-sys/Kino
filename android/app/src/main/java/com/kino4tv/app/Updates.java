package com.kino4tv.app;

import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The app's own updates (src/server/push/appRelease.ts). The site says which version is the newest (`/api/app/android`); a newer one is downloaded, its size and
 * SHA-256 checked against what the site said, and handed to Android's installer (Android also checks it is signed with this app's key). While the app is on the
 * screen the person is asked first; in the background it is installed without a tap where Android allows that (12 and later, once this app installed itself
 * once), else a notification says it is ready. It is asked when the app opens (at most every six hours) and whenever the site sends the news of a version.
 */
final class Updates {
    private Updates() {}

    static final String EXTRA_INSTALL = "com.kino4tv.app.INSTALL_UPDATE";
    private static final String TAG = "KinoUpdates";
    private static final long EVERY_MS = 6 * 3600_000L;
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    private static volatile boolean installing;

    static void checkSoon(Context context, boolean background) {
        long last = Prefs.of(context).getLong(Prefs.UPDATE_CHECKED_AT, 0);
        if (System.currentTimeMillis() - last < EVERY_MS) {
            if (!background && readyFile(context) != null) offer(context);
            return;
        }
        checkNow(context, background);
    }

    static void checkNow(Context context, boolean background) {
        Context app = context.getApplicationContext();
        WORK.execute(() -> {
            try {
                Prefs.of(app).edit().putLong(Prefs.UPDATE_CHECKED_AT, System.currentTimeMillis()).apply();
                JSONObject release = new JSONObject(new String(fetch(BuildConfig.SITE + "/api/app/android", 64 * 1024), "UTF-8"));
                int code = release.getInt("versionCode");
                if (code <= BuildConfig.VERSION_CODE) {
                    clear(app);
                    return;
                }
                String url = release.getString("url");
                if (!url.matches("/app/android/kino-\\d+\\.apk")) return;
                long size = release.getLong("size");
                String sha256 = release.getString("sha256");
                File apk = new File(dir(app), "kino-" + code + ".apk");
                if (!apk.exists() || apk.length() != size || !sha256.equals(hashOf(apk))) {
                    download(BuildConfig.SITE + url, apk, size);
                    if (!sha256.equals(hashOf(apk))) {
                        Log.w(TAG, "The download is not the build the site said: it is let go.");
                        apk.delete();
                        return;
                    }
                }
                Prefs.of(app).edit().putString(Prefs.UPDATE_READY, apk.getName()).apply();
                // (On the screen the person is asked, whatever made it look; in the background it goes in without a tap where Android allows.)
                if (MainActivity.onScreen) offer(app);
                else install(app, apk);
            } catch (Exception failed) {
                Log.w(TAG, "No update this time: " + failed.getClass().getSimpleName());
            }
        });
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
            if (open.isFinishing()) return;
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
            if (asked) checkNow(context, false);
            return;
        }
        Context app = context.getApplicationContext();
        WORK.execute(() -> install(app, apk));
    }

    private static void install(Context context, File apk) {
        if (installing) return;
        installing = true;
        try {
            PackageInstaller installer = context.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(id)) {
                try (OutputStream out = session.openWrite("kino.apk", 0, apk.length()); InputStream in = new FileInputStream(apk)) {
                    byte[] buffer = new byte[64 * 1024];
                    for (int read; (read = in.read(buffer)) > 0; ) out.write(buffer, 0, read);
                    session.fsync(out);
                }
                Intent done = new Intent(context, UpdateReceiver.class);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                session.commit(PendingIntent.getBroadcast(context, id, done, flags).getIntentSender());
            }
        } catch (IOException | RuntimeException failed) {
            Log.w(TAG, "The update could not be handed to Android: " + failed.getClass().getSimpleName());
        } finally {
            installing = false;
        }
    }

    private static HttpURLConnection open(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "KinoApp/" + BuildConfig.VERSION_NAME);
        if (connection.getResponseCode() != 200) throw new IOException("status " + connection.getResponseCode());
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
