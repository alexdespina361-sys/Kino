package com.kino4tv.app;

import android.content.Context;
import android.text.TextUtils;

/** The app's own page for when the site cannot be reached: it says so, and tries again with a press (of a finger, or of a remote's OK). */
final class Offline {
    private Offline() {}

    static String page(Context context, String again) {
        String title = context.getString(R.string.offline_title);
        String button = context.getString(R.string.offline_again);
        return "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'><style>"
                + "html,body{height:100%;margin:0;background:#000;color:#eee;font:18px sans-serif}"
                + "body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;padding:24px;box-sizing:border-box}"
                + "a{color:#000;background:#e8b04b;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600}a:focus{outline:4px solid #fff}"
                + "</style></head><body><div>" + TextUtils.htmlEncode(title) + "</div><a href='" + TextUtils.htmlEncode(again) + "' autofocus>" + TextUtils.htmlEncode(button) + "</a></body></html>";
    }
}
