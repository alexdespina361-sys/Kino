package com.kino4tv.app;

import android.net.Uri;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Where the site is: the address the app opens, and the addresses that are the site's own (everything else opens in the phone's browser). */
final class Site {
    private Site() {}

    static final Uri HOME = Uri.parse(BuildConfig.SITE);
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList(BuildConfig.OTHER_HOSTS.split(",")));

    static {
        String home = HOME.getHost();
        if (home != null) HOSTS.add(home);
    }

    /** Whether `uri` is a page of the site: https on one of its addresses (or the address a test build was made for). */
    static boolean isOwn(Uri uri) {
        if (uri == null || uri.getHost() == null) return false;
        String scheme = uri.getScheme();
        boolean sameAsHome = uri.getHost().equals(HOME.getHost()) && scheme != null && scheme.equals(HOME.getScheme()) && uri.getPort() == HOME.getPort();
        return sameAsHome || ("https".equals(scheme) && HOSTS.contains(uri.getHost()) && uri.getPort() == -1);
    }

    static boolean isOwn(String url) {
        return url != null && isOwn(Uri.parse(url));
    }

    /** The origins of the site's pages, as Android's message bridge takes them: only pages of these have `window.KinoApp` (Bridge). */
    static Set<String> origins() {
        Set<String> origins = new HashSet<>();
        for (String host : HOSTS) if (!host.isEmpty()) origins.add("https://" + host);
        origins.add(originOf(HOME));
        return origins;
    }

    /** `https://host` of a page of the site (the origin a round trip to Google started from). */
    static String originOf(Uri uri) {
        return uri.getScheme() + "://" + uri.getHost() + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
    }
}
