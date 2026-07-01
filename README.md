# REPS — secure backend + app

Three-tier setup: **browser → this Node server → Supabase**.
The browser never holds any Supabase keys; this server does, verifies every
request, and talks to the database on the user's behalf. Row-Level Security in
the database is a second line of defence underneath.

```
public/index.html + app.js   →   server.js (Express)   →   Supabase (Postgres + Storage)
        (the app)                  (auth, validation,          (data, files, RLS)
                                    rate limiting, keys)
```

## Prerequisites
- Node.js 18 or newer
- A free Supabase project with `schema.sql`, `schema-moderation.sql`, and `schema-tracking.sql` already run in its SQL Editor

## Setup
1. `cp .env.example .env`
2. Fill in `.env` from Supabase → **Project Settings → API**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (the *anon public* key)
   - `SUPABASE_SERVICE_ROLE_KEY` (the *service_role* key — secret, server-only)
   - `ADMIN_EMAILS` (your email, so you can reach the admin panel)
3. In Supabase SQL Editor, run **`schema.sql`**, then **`schema-moderation.sql`**, then **`schema-tracking.sql`** (three separate runs, in that order)
4. `npm install`
5. `npm start`
6. Open `http://localhost:3000` (app) and `http://localhost:3000/admin.html` (admin)

## Moderation & safety features
- **Client ID on every request.** The app generates a per-device ID and sends it as `X-Client-Id`. It's a best-effort signal (a user can reset it by clearing storage) — handy for logs and as a ban target, not a hard security control.
- **Request logging.** Every `/api` call is written to `logs/requests.log` (one JSON line each: time, method, path, status, duration, user, client ID, IP) and kept in a 500-entry in-memory buffer the admin panel reads.
- **Ban system.** Block by user ID, client ID, or IP. Bans live in the `bans` table (server-only) and are cached in memory for fast checks — a banned user/client/IP gets a 403 on every request.
- **Admin panel** at `/admin.html` (only for emails in `ADMIN_EMAILS`): issue and lift bans, review reports, and watch the live request log. Every admin endpoint is server-side gated, so the page is just a convenient face.
- **User reporting.** A Report link on others' posts files a row in `reports` (visible only to you in the admin panel).
- **Self-serve account deletion.** Profile → Delete my account removes the auth user, cascades their rows, and clears their stored photos — useful and expected by the app stores.

> Bans are a *deterrent*, not a wall: client IDs reset and IPs rotate, so a determined person can return. The strongest lever is the per-user ban tied to their account.

## Test
```
npm test
```
Runs without any Supabase connection. It verifies routing, the auth gate
(protected routes return 401), input validation, that the frontend is served,
that security headers are set, and that no keys leak into the HTML.

> What this does **not** test is the live data path (real signup, saving a
> session, uploading a photo) — that needs your real Supabase project. Once your
> `.env` is filled in and all three schema files have been run, those work end to end.

## How it's secured
- **Keys stay server-side.** The browser only ever calls `/api/*` on this server. No Supabase URL or key is in the frontend (a test asserts this).
- **httpOnly + SameSite cookies.** The session token is in an httpOnly cookie, so page JavaScript can't read it (defends against token theft via XSS), and `SameSite=strict` keeps it from being sent cross-site (CSRF mitigation).
- **Every request is verified.** The `requireAuth` gate validates the token with Supabase before any handler runs; protected routes return 401 otherwise.
- **Row-Level Security underneath.** Each request talks to Supabase as the signed-in user, so even a server bug can't read or write another user's rows.
- **No raw SQL.** All queries go through the Supabase client (parameterized) — nothing for SQL injection to grab.
- **Input is whitelisted.** Profile updates only accept known columns; reactions only accept `love`/`support`; uploads only accept images under 6 MB.
- **Rate limiting + Helmet.** Brute-force protection on auth, and a strict Content-Security-Policy with no inline scripts allowed.
- **Private photos.** Images live in a private bucket, split per user, served only through short-lived signed URLs.

**The one rule:** never put `SUPABASE_SERVICE_ROLE_KEY` in the frontend or commit
`.env`. That key bypasses all of the above and belongs only on the server.

## Deploy
This is a normal Node app — host it anywhere that runs Node and gives you HTTPS:
Render, Koyeb, Railway, Fly.io, or your own VM (including an Oracle Cloud free VM)
behind a reverse proxy that terminates TLS. Set the same environment variables
there, set `NODE_ENV=production`, and you're live for your test group.

## Install on a phone (no app store)
Reps is a PWA. Once it's hosted over HTTPS, send people to **`https://your-site/install`** —
that page detects their phone and shows the right steps:
- **iPhone:** open in **Safari** → Share → **Add to Home Screen** (Apple allows no app file; this is the iOS path).
- **Android:** tap **Install app**, or download the APK (below).

## Give Android users a downloadable APK (optional)
1. Deploy so the app has a live HTTPS URL.
2. Go to **pwabuilder.com**, enter your URL, choose **Android**, download the package.
3. From that zip, take the signed `.apk`, rename it **`reps.apk`**, and drop it in the **`downloads/`** folder.
4. The **Download APK** button on `/install` switches on automatically.

> **iPhone note:** there is no downloadable app file for iOS — Apple doesn't allow
> installing a normal app from a file. "Add to Home Screen" is the no-store way, and
> it gives a full-screen, fully functional app.

