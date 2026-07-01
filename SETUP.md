# Reps — setup guide

## What you're deploying
**One Node app.** It serves both the web app *and* the API together — that's
deliberate (it's what keeps the login cookie secure), so keep them together.
This package already contains the app inside `public/`.

---

## Step 0 — Database (Supabase), do this once
1. Create a free project at **supabase.com**.
2. Open **SQL Editor → New query**, paste in **`schema.sql`**, Run.
3. Do the same with **`schema-moderation.sql`**.
4. Do the same with **`schema-tracking.sql`** (nutrition + daily metrics — Track and Progress screens need this one).
5. Go to **Project Settings → API** and copy three values:
   - **Project URL**
   - **anon public** key
   - **service_role** key (secret)

## Step 1 — Configure
1. `cp .env.example .env`
2. Open `.env` and fill in:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_EMAILS=` your email (so you can reach the admin panel)
   - `NODE_ENV=production`

Now pick ONE of the three deploy options below.

---

## Option A — Render (easiest, no server admin)
1. Put this folder in a GitHub repo (or upload it).
2. On **render.com**: New → **Web Service** → connect your repo.
   (Or New → **Blueprint** to use the included `render.yaml`.)
3. Build command: `npm install`  ·  Start command: `node server.js`
4. Add your environment variables (the four from `.env`, plus `NODE_ENV=production`) in the Render dashboard.
5. Deploy. Render gives you an `https://…onrender.com` URL.
   > Free instances sleep when idle; the first visit after a nap takes ~1 minute to wake.

Koyeb works the same way if you prefer it.

---

## Option B — Your own server / VPS (Ubuntu) — full control
You need a server with a domain pointed at its IP.

1. **Install Node 20:**
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
2. **Copy the project** to `/opt/reps` (via `scp` or `git clone`).
3. `cd /opt/reps && npm install`
4. Create your `.env` (Step 1) in `/opt/reps`.
5. **Test it:** `node server.js` → visit `http://YOUR_SERVER_IP:3000`. Ctrl-C to stop.
6. **Keep it running (systemd):**
   ```
   sudo useradd -r -s /usr/sbin/nologin reps
   sudo chown -R reps:reps /opt/reps
   sudo cp deploy/reps.service /etc/systemd/system/reps.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now reps
   ```
   (Or with pm2: `sudo npm i -g pm2 && pm2 start server.js --name reps && pm2 save && pm2 startup`)
7. **Add HTTPS with nginx + certbot:**
   ```
   sudo apt-get install -y nginx certbot python3-certbot-nginx
   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/reps
   sudo nano /etc/nginx/sites-available/reps        # set your domain
   sudo ln -s /etc/nginx/sites-available/reps /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d your-domain.com          # gets the certificate
   ```
8. Visit `https://your-domain.com`. Done.

---

## Option C — Docker (any host with Docker)
```
docker build -t reps .
docker run -d -p 3000:3000 --env-file .env --name reps reps
```
Then put nginx + certbot in front for HTTPS (Option B, step 7), or use a host that
provides TLS for you.

---

## After it's live
- **Make yourself admin:** open the app, sign up with the email you put in `ADMIN_EMAILS`, confirm via the email link, then open **`/admin.html`**.
- **Install on phones (no app store):** send people to **`https://your-site/install`** — it auto-detects iPhone vs Android and walks them through it.
  - iPhone: Safari → Share → **Add to Home Screen**.
  - Android: tap **Install app** on that page.
- **Give Android a downloadable APK (optional):** go to **pwabuilder.com**, enter your live URL, choose Android, download the package, rename the signed `.apk` to **`reps.apk`**, and drop it in the **`downloads/`** folder. The Download APK button on `/install` then turns on.
- Send your testers the link.

## Security reminders
- **Never** commit `.env`, and **never** put the `service_role` key in `public/`.
- HTTPS is required for both login and home-screen install — it works on your live
  domain, just not on plain `http://localhost`.
