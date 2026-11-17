# The Android app

Kino for Android (`android/`) is the site in a WebView, for phones and for Android TV / Fire TV. It adds what a browser tab cannot:

- **Notifications** from friends: a message, a title sent, an invitation to a watch party or to watch together, a plan or the answer to one.
- **Updates of itself**: the app installs a new version on its own once the server says one is out.
- **Google sign-in** that works inside the app. Google signs nobody in from a WebView, so the button goes out to the phone's browser and back.

It is Java, with no framework: `MainActivity` (the WebView), `Bridge` (`window.KinoApp` for the site's pages), `GoogleTrip`, `KinoMessaging` (Firebase), `Notices`, `Updates`. It is
built with AGP 8.13, Gradle 8.14.3, SDK 36, minimum Android 7.0 (API 24).

## What the server does

| Setting (env) | What it turns on |
|---|---|
| `FCM_SERVICE_ACCOUNT_FILE` | The notifications: the path of a Firebase service account's JSON key, on the server only. Without it nothing is sent (`/api/features` has no `push`). |
| `ANDROID_APP_DIR` | The app's builds: `android.json` and `kino-<versionCode>.apk` in that folder (on the box `/var/lib/kino-web/app`, outside the checkout). Without it no app is offered. |

- `PUT /api/push {token, profileId}` keeps the device's Firebase token with its sign-in (the session), for one of the account's profiles. `DELETE /api/push` forgets it, and so does signing out.
- Chat messages (`ChatBook.write`) and new inbox items (`FriendBook.deliver`) are told to the store's listener (`onNotice`). `PushHub` sends a data message to the profile's devices. A friend's notifications come at most once every 20 s. A muted friend's messages are not told.
- A notification carries the friend's name and id, the profile's id and the kind of thing. Never the words of a chat, never a title. The app writes the sentence in the profile's language (the site gives it the words: `client/app/kinoApp.ts`).
- `GET /api/app/android` says which version is the newest. `/app/android/kino-<n>.apk` is the APK, and `/app/kino.apk` always leads to the newest one (a link to give people). Within a minute of a new `android.json`, the server sends the topic `app-updates` once (`signalled.json` remembers it across restarts): that is the signal.
- Google from the app (`accounts/google.ts`, `AppTrip`):
  1. The WebView goes to `/api/auth/google/start`. The app opens that address in a Custom Tab instead, with `app=<sha256 of a secret>`.
  2. The way back does not sign the browser in. It sends the browser to `kino4tv://google?code=…`.
  3. The app loads `/api/auth/google/app-claim?code=…&verifier=…` in the WebView, which signs the WebView in.
  4. Connecting Google, or confirming who is here, needs the WebView's session. The WebView asks for a ticket first (`POST /api/auth/google/app-ticket`).

## Building

`android/local.properties` (not in git) says where the SDK is: `sdk.dir=C\:\\Users\\Me\\Android\\Sdk`. Then:

```
cd android
set JAVA_HOME=C:\Users\Me\dev-tools\jdk-21
gradlew.bat assembleRelease -PkinoVersionCode=2 -PkinoVersionName=0.1.1
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
node scripts/android-release.mjs 2 0.1.1 "What is new"
```

The script:

1. Builds the APK with that version.
2. Copies the APK into `/var/lib/kino-web/app`, then `android.json`.
3. The server tells every copy of the app.

On Android 12 and later, once the app has installed one update itself, the later ones go in without a tap while the app is in the background. Before that, the person gets one confirmation: in the app, or as a notification. Every app also checks when it is opened (at most every six hours).

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
