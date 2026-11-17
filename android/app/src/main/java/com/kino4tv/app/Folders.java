package com.kino4tv.app;

import android.content.Intent;
import android.os.Build;
import android.provider.DocumentsContract;
import android.webkit.WebChromeClient;

/**
 * The folders of the phone a page's next file chooser can open in (Bridge `pickFrom`): WhatsApp's stickers and its GIFs, to make them Kino's personal stickers.
 * Android's own file chooser is opened (not the photo picker, which does not show a folder WhatsApp hides from the gallery), and it is asked to start in the
 * folder: where the phone has no such folder, it starts where it would have. The app reads nothing of the phone's files itself, and asks for no permission to:
 * the person chooses, and only what they chose is given to the page.
 *
 * (A page that knows no folder of these does not ask for it: a folder here before the site uses it is no button anywhere.)
 */
final class Folders {
    private Folders() {}

    static final String WHATSAPP_STICKERS = "whatsapp-stickers";
    /** WhatsApp keeps a GIF it was sent as a short MP4 with no sound. */
    static final String WHATSAPP_GIFS = "whatsapp-gifs";

    static boolean known(String folder) {
        return WHATSAPP_STICKERS.equals(folder) || WHATSAPP_GIFS.equals(folder);
    }

    /** The folders, as the bridge tells the page. */
    static String[] all() {
        return new String[] {WHATSAPP_STICKERS, WHATSAPP_GIFS};
    }

    /** Where WhatsApp keeps `media` (its own name for the folder): in Android/media since Android 11, and in a folder of its own on the phone's storage before. */
    private static String whatsApp(String media) {
        return (Build.VERSION.SDK_INT >= 30 ? "Android/media/com.whatsapp/WhatsApp/Media/" : "WhatsApp/Media/") + media;
    }

    /** The file chooser for `folder`, choosing what the page's chooser would (one file, or several). */
    static Intent chooser(String folder, WebChromeClient.FileChooserParams params) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
        if (WHATSAPP_GIFS.equals(folder)) {
            intent.setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"video/mp4", "image/gif"});
        } else {
            intent.setType("image/*");
        }
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (Build.VERSION.SDK_INT >= 26 && known(folder)) {
            String media = WHATSAPP_GIFS.equals(folder) ? "WhatsApp Animated Gifs" : "WhatsApp Stickers";
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:" + whatsApp(media)));
        }
        return intent;
    }
}
