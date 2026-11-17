package com.kino4tv.app;

import android.content.Intent;
import android.os.Build;
import android.provider.DocumentsContract;
import android.webkit.WebChromeClient;

/**
 * The folders of the phone a page's next file chooser can open in (Bridge `pickFrom`): WhatsApp's stickers, to make them Kino's personal stickers. Android's
 * own file chooser is opened (not the photo picker, which does not show a folder WhatsApp hides from the gallery), and it is asked to start in the folder: where
 * the phone has no such folder, it starts where it would have. The app reads nothing of the phone's files itself, and asks for no permission to: the person
 * chooses, and only what they chose is given to the page.
 */
final class Folders {
    private Folders() {}

    static final String WHATSAPP_STICKERS = "whatsapp-stickers";

    static boolean known(String folder) {
        return WHATSAPP_STICKERS.equals(folder);
    }

    /** WhatsApp keeps what it was sent in Android/media since Android 11, and in a folder of its own on the phone's storage before. */
    private static String whatsAppStickers() {
        return Build.VERSION.SDK_INT >= 30 ? "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Stickers" : "WhatsApp/Media/WhatsApp Stickers";
    }

    /** The file chooser for `folder`, choosing what the page's chooser would (one picture, or several). */
    static Intent chooser(String folder, WebChromeClient.FileChooserParams params) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        if (Build.VERSION.SDK_INT >= 26 && WHATSAPP_STICKERS.equals(folder)) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:" + whatsAppStickers()));
        }
        return intent;
    }
}
