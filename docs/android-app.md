# The Android app

Kino for Android (`android/`) is the site in a WebView, for phones and for Android TV / Fire TV. It adds what a browser tab cannot:

- **Notifications** from friends: a message, a title sent, an invitation to a watch party or to watch together, a plan or the answer to one.
- **Updates of itself**: the app installs a new version on its own once the server says one is out.
- **Google sign-in** that works inside the app. Google signs nobody in from a WebView, so the button goes out to the phone's browser and back.
- **Stickers from WhatsApp** (0.2.0): "From WhatsApp" in the stickers opens the phone's file chooser in the folder where WhatsApp keeps the stickers it was sent. Several can be chosen at once; each becomes a personal sticker (one that moves becomes its first picture). The app knows WhatsApp's GIFs folder too (`whatsapp-gifs`, MP4 and GIF files): **WhatsApp GIFs** shows only while the host has stickers that move on (`MOVING_STICKERS`, docs/personal-stickers.md), and makes each a sticker that moves.

It is Java, with no framework: `MainActivity` (the WebView), `Bridge` (`window.KinoApp` for the site's pages), `Folders`, `GoogleTrip`, `KinoMessaging` (Firebase), `Notices`, `Updates` and `UpdateWork` (WorkManager). It is
built with AGP 8.13, Gradle 8.14.3, SDK 36, minimum Android 7.0 (API 24). Lint runs on every release build, and an error stops it.

## The bridge (`window.KinoApp`)

From 0.2.0 the page and the app talk by messages (`WebViewCompat.addWebMessageListener`). Android gives `KinoApp` only to pages of the site's own addresses (`Site.origins`), and the app answers only the page itself, never a frame in it. (0.1.0 used `addJavascriptInterface`, which every frame of a page had, a frame of another site too.)

| The page says | The app answers |
|---|---|
| `{call: "hello"}` | `{kind: "hello", version, folders, notify, token}` |
| `{call: "pushToken"}` | (the phone may ask whether the app may notify) then `{kind: "state", notify, token}` |
| `{call: "setStrings", json}` | nothing: the notifications' words in the profile's language |
| `{call: "pickFrom", folder}` | `{kind: "picking", folder, known}`, and the next file chooser (within 10 s) opens in that folder (`whatsapp-stickers`: pictures; `whatsapp-gifs`: MP4 and GIF) |
| `{call: "googleTicket", ticket}` | (`GoogleTrip`'s own script sends it) the Custom Tab opens |

The app sends `{kind: "state", notify, token}` again whenever either changes (a token arrives, the notifications are turned off or on in the phone's settings). `client/app/kinoApp.ts` is the page's side, and still speaks to a 0.1.0 app the old way.

## What the server does

| Setting (env) | What it turns on |
|---|---|
| `FCM_SERVICE_ACCOUNT_FILE` | The notifications: the path of a Firebase service account's JSON key, on the server only. Without it nothing is sent (`/api/features` has no `push`). |
| `ANDROID_APP_DIR` | The app's builds: `android.json` and `kino-<versionCode>.apk` in that folder (on the box `/var/lib/kino-web/app`, outside the checkout). Without it no app is offered. |

- `PUT /api/push {token, profileId}` keeps the device's Firebase token with its sign-in (the session), for one of the account's profiles. `DELETE /api/push` forgets it, and so does signing out, deleting the profile, or the sign-in running out.
- The phone is registered with Firebase only while its notifications are on (Firebase's own start-up registration is off). With them off, the app lets the token go, the page has the server forget the phone, and nothing about it goes through Google. The news of a new version then comes only from the app's own looks.
- Chat messages (`ChatBook.write`) and new inbox items (`FriendBook.deliver`) are told to the store's listener (`onNotice`). `PushHub` sends a data message to the profile's devices. A friend's notifications come at most once every 20 s. A muted friend's messages are not told.
- A notification carries the friend's name and id, the profile's id and the kind of thing. Never the words of a chat, never a title. The app writes the sentence in the profile's language (the site gives it the words).
- A token is let go only when Firebase says `UNREGISTERED` (or that it is not a registration token). Any other refusal keeps every token.
- `GET /api/app/android` says which version is the newest. `/app/android/kino-<n>.apk` is the APK, and `/app/kino.apk` always leads to the newest one (a link to give people). Once the site listens, and within a minute of a new `android.json`, the server sends the topic `app-updates` once (`signalled.json` remembers it across restarts): that is the signal.
- Google from the app (`accounts/google.ts`, `AppTrip`):
  1. The WebView goes to `/api/auth/google/start`. The app opens that address in a Custom Tab instead, with `app=<sha256 of a secret>`.
  2. The way back does not sign the browser in, connect or confirm anything. It sends the browser to `intent://google?code=…#Intent;scheme=kino4tv;package=com.kino4tv.app;…`: an intent for this app's package alone, so no other app that says it opens `kino4tv:` addresses is given the code.
  3. The app loads `/api/auth/google/app-claim?code=…&verifier=…` in the WebView, which signs the WebView in.
  4. Connecting Google, or confirming who is here, needs the WebView's session. The WebView asks for a ticket first (`POST /api/auth/google/app-ticket`, ten an account in ten minutes). The claim connects or confirms only for that same session, still signed in.

## Building

`android/local.properties` (not in git) says where the SDK is: `sdk.dir=C\:\\Users\\Me\\Android\\Sdk`. Then (in PowerShell the `-P` arguments need quotes):

```
cd android
set JAVA_HOME=C:\Users\Me\dev-tools\jdk-21
gradlew.bat assembleRelease "-PkinoVersionCode=2" "-PkinoVersionName=0.2.0"
```

The APK is `android/app/build/outputs/apk/release/app-release.apk`. Two files stay out of the repository:

- **The signing key**: `signing.properties` and `kino-release.jks` in `~/dev-tools/kino-android-keys` (or the folder `KINO_ANDROID_KEYS` names). **Back it up**: an update has to be signed with the same key. Lose it, and everybody has to uninstall the app and install it again.
- **Firebase's file**: `android/app/google-services.json`. Without it the app is built all the same, with no notifications.

`-PkinoSite=http://127.0.0.1:8787` makes a build that opens another site. Use it with `adb reverse tcp:8787 tcp:8787` and a server on this machine.

## Releasing (the signal)

```
set KINO_BOX=ubuntu@<the box>
set KINO_BOX_SSH_KEY=%USERPROFILE%\.ssh\kino-oracle-relay\id_rsa
set KINO_BOX_KNOWN_HOSTS=%USERPROFILE%\.ssh\kino-oracle-relay\known_hosts
node scripts/android-release.mjs 3 0.3.0 "What is new"
```

The script:

1. Asks the server which version it offers, and stops unless the new one is newer.
2. Builds the APK with that version, and checks it: the package `com.kino4tv.app`, that version, signed with the app's key (`CERT_SHA256` in the script).
3. Puts the APK into `/var/lib/kino-web/app`, then `android.json`, each written beside its place and moved there in one step.
4. The server tells every copy of the app.

On Android 12 and later, once the app has installed one update itself, the later ones go in without a tap while the app is in the background. Before that, the person gets one confirmation: in the app, or as a notification. Every app also looks when it is opened (if its last look is six hours old) and twice a day in the background, through WorkManager, which waits for a network and tries again when a look fails.

## Firebase

The project is `kino-513800`, the same Google Cloud project as Google sign-in, on the free Spark plan. Setup:

1. Add Firebase to the project.
2. Add an Android app with the package `com.kino4tv.app`, and put its `google-services.json` in `android/app/`.
3. Make a service account key (Project settings, then Service accounts), copy it to the box as `/etc/kino-web-fcm.json` (root:kino-web 640), and set `FCM_SERVICE_ACCOUNT_FILE=/etc/kino-web-fcm.json`.

The key never goes in git or a chat.

## Known limits

- A TV's Back key is handed to the page as its `GoBack` key. When the page does not take it, the app goes back a page, and out of the app from the first one.
- Keyboard GIFs (Android's `commitContent`) are not wired yet.
- Tapping a notification opens the app where it was, not the chat.
- "From WhatsApp" opens the folder of WhatsApp itself (not WhatsApp Business). Android takes the folder as a hint: on a phone where it is elsewhere, the chooser opens where Android chooses. The app asks for no permission to read the phone's files: only what the person chooses is given to the page.
- A WebView older than the message bridge (Chrome 84's) has no `KinoApp`: the site works, without notifications, folders, or connecting Google from the app.
- No Android tests run on a device or an emulator yet: the app is checked by lint and by hand.
