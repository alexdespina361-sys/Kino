package com.kino4tv.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

/**
 * What Android's installer says of an update (Updates): it wants the person to say yes (asked now if the app is on the screen, else by a notification), or it is
 * done (installed, or not: then another may be handed to it).
 */
public class UpdateReceiver extends BroadcastReceiver {
    static final String EXTRA_SESSION = "com.kino4tv.app.SESSION";

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            MainActivity open = MainActivity.open;
            if (confirm != null && MainActivity.onScreen && open != null) open.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            else Notices.updateReady(context);
            return;
        }
        // (Done, one way or the other: the session that was waiting is no longer.)
        int session = intent.getIntExtra(EXTRA_SESSION, -1);
        if (session < 0 || session == Prefs.of(context).getInt(Prefs.INSTALL_SESSION, -1)) Updates.installed(context);
        if (status != PackageInstaller.STATUS_SUCCESS) Log.w("KinoUpdates", "The installer said " + status + ": " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
    }
}
