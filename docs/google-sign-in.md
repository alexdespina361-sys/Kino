# Sign in with Google

"Continue with Google" signs a person in, or makes their account, with their Google account. It is on the phone's sign-in form and on the form of a
computer used as the TV. A TV's own browser (Fire TV, Tizen, webOS, VIDAA...) does not show it: Google's pages are no place for a remote, and those TVs
sign in from a phone with their code, as before.

It is off until the three settings below are set. Without them nothing of it shows, and `/api/me` says nothing about Google.

## Set it up (once)

### 1. Google Cloud

1. Go to <https://console.cloud.google.com/>, and make a new project (for example "Kino").
2. **Google Auth Platform** (or **APIs & Services > OAuth consent screen**): **Get started**.
   - App name: `Kino`. User support e-mail: your e-mail.
   - Audience: **External**.
   - Contact e-mail: your e-mail.
3. **Branding**:
   - App home page: `https://kino.24-7.ro`
   - Privacy policy: `https://kino.24-7.ro/privacy.html` (it has a part about Google sign-in, in the three languages)
   - Authorised domains: `24-7.ro` and `kino4tv.com`
   - Leave the logo out: a logo makes Google review the app before it shows it.
4. **Data access**: nothing to add. The site asks for `openid`, `email` and `profile` only, Google's basic ones.
5. **Audience**: **Publish app** (to "In production"). While it is "Testing", only the test users listed there can sign in.
6. **Clients > Create client**:
   - Application type: **Web application**. Name: `Kino`.
   - Authorised JavaScript origins: none.
   - Authorised redirect URIs, exactly these:
     - `https://kino.24-7.ro/api/auth/google/callback`
     - `https://kino4tv.com/api/auth/google/callback`
     - `http://127.0.0.1:8787/api/auth/google/callback` (only to try it on your own computer with `pnpm dev`; leave it out otherwise)
   - **Create**, then copy the **Client ID** and the **Client secret**.

### 2. Render

The service's **Environment**, three variables:

| Key | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | the Client ID |
| `GOOGLE_CLIENT_SECRET` | the Client secret |
| `GOOGLE_REDIRECT_URIS` | `https://kino.24-7.ro/api/auth/google/callback,https://kino4tv.com/api/auth/google/callback` |

Paste the secret into Render yourself, and nowhere else: not into a chat, not into a file, not into this repository (it is public). If it was ever
pasted somewhere else, make a new one in Google Cloud (the client's page, **Add secret**, then delete the old one) and put the new one in Render.

**Save, rebuild, and deploy.**

### 3. Check

- `https://kino.24-7.ro/api/me` ends with `"google":true`, and so does `https://kino4tv.com/api/me`.
- On the phone, the account page shows **Continue with Google** above the name and password.
- Render's log says `Google sign-in is on at kino.24-7.ro, kino4tv.com.` as the server starts (or what is missing, never the secret).

An address that is not in `GOOGLE_REDIRECT_URIS` (`www.kino4tv.com`, the `onrender.com` one) has no button and no `"google"` in `/api/me`. That is on
purpose: Google sends a person back only to an address it knows. To have it there too, add that address's way back in both places.

If `"google"` is missing at `https://kino.24-7.ro` although the log says it is on there, the server does not see that request as
`https://kino.24-7.ro`: it reads the address from the request's `Host` (or the proxy's `X-Forwarded-Host`) and the proxy's `X-Forwarded-Proto`
(`TRUST_PROXY`, 1 on Render by default). The
answer's `Strict-Transport-Security` header is a quick sign: the server sends it only when it sees `https`.

## How it works

- **Sign in and sign up are the same button.** A Google account that has an account here signs in; a new one makes an account (while sign-ups are
  open, under the same limits as a sign-up with a password). Its first profile is named after the person's first name at Google ("Me" if there is
  none), and can be renamed.
- **An account with a password is never joined to a Google account by e-mail.** Its owner connects Google on **Password & security > Connect Google**,
  and can then sign in either way. A Google account belongs to one account at most.
- **An account made with Google has no password.** Its **Password & security** says so, and deleting it asks the person to sign in to Google again
  (**Confirm with Google**): the site deletes the account only for a session that Google confirmed in the last five minutes.
- **A TV** signs in from a phone that is signed in with Google, with its code or its QR code, as with any account.

## What is kept

- For each account that uses Google: Google's ID number for the person (`sub`), and whether the account was made with Google. Nothing else of Google's:
  not the e-mail address, not the name or the picture, not Google's tokens.
- The first name, once, as the first profile's name (only for an account made with Google).
- An account made with Google gets a login nobody chose (`g-` and 12 letters and digits), and a random password nobody knows.
- During the round trip (at most ten minutes): a cookie, `kino_oauth`, that ties Google's answer to the browser that went there, and the trip's own
  numbers in the server's memory. Both are gone when the browser comes back.
- The server does not log the way back from Google (its address has the code in it). A refused sign-in is logged as one line that says only why
  (`Google sign-in refused: the state.`, for example).

## Limits

- Google refuses to sign in inside some apps' own browsers (Facebook's, Instagram's, TikTok's...), with "Error 403: disallowed_useragent". The person
  opens the site in Chrome or Safari instead.
- A phone that opened a TV's QR code before it was signed in comes back to its home page after Google: it scans the code again.
- Turning it off (taking any of the three settings away) hides the button; an account made with Google cannot sign in until it is back on (nothing of
  it is lost).
- It has been tried against a fake Google only (`e2e/google-sign-in.spec.ts`, `src/server/accounts/google.test.ts`: nothing in the tests reaches
  Google). The first real sign-in is the owner's.

## For developers

- Code: `src/server/accounts/google.ts` (the two routes, the token request, the ID token's checks), `src/client/account/google.ts` and
  `GoogleButton.tsx`.
- `GOOGLE_AUTHORIZE_URL` and `GOOGLE_TOKEN_URL` point the server at a fake Google, for the tests. They count only with `ALLOW_PRIVATE_NETWORK=1`, which
  no deployed server has, and only for an address on the same machine.
