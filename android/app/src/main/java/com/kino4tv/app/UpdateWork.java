package com.kino4tv.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONException;

import java.io.IOException;

/** One look for an update (Updates), as Android's WorkManager runs it: once there is a network, and again a little later when it could not be done. */
public final class UpdateWork extends Worker {
    public UpdateWork(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Updates.look(getApplicationContext());
            return Result.success();
        } catch (IOException | JSONException failed) {
            Log.w("KinoUpdates", "No update this time: " + failed.getClass().getSimpleName());
            return getRunAttemptCount() < 5 ? Result.retry() : Result.failure();
        }
    }
}
