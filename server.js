// ============================================================
//  REPS — web server (middle tier)
//  Browser  →  THIS server  →  Supabase
//
//  Adds on top of the base server:
//   • every request carries an X-Client-Id from the app
//   • request logging (file + in-memory) for the owner to review
//   • a ban system (by user, client id, or IP) as a backstop
//   • an admin-only control panel API (ban, logs, reports, users)
//   • user content reporting + self-serve account deletion
// ============================================================

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  PORT = 3000,
  NODE_ENV = 'development',
  ADMIN_EMAILS = ''
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('✗ Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

let SUPA_ORIGIN = "'self'";
try { SUPA_ORIGIN = new URL(SUPABASE_URL).origin; } catch (_) {}

const ADMINS = new Set(ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));

// Admin (service-role) client — server only. Validates tokens and
// performs privileged/moderation operations. Never sent to the client.
//
// `realtime: { transport: ws }` is required on Node <22: supabase-js
// always constructs a realtime client internally (even though this app
// never uses realtime subscriptions), and on Node versions below 22 it
// throws at construction time unless a WebSocket implementation is
// explicitly supplied. Without this, the server crashes on boot.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws }
});

// Per-request client bound to the user's token → RLS still applies.
function userClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
    realtime: { transport: ws }
  });
}

const app = express();
if (NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", SUPA_ORIGIN],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------
//  LOGGING  — every /api request is logged to a file and kept in a
//  small in-memory ring buffer the admin panel can read.
// ---------------------------------------------------------------
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'requests.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
const recentLogs = [];

function logger(req, res, next) {
  const start = Date.now();
  req.reqId = crypto.randomUUID();
  req.clientId = req.get('X-Client-Id') || null;
  res.on('finish', () => {
    const entry = {
      t: new Date().toISOString(),
      id: req.reqId,
      ip: req.ip,
      client: req.clientId,
      user: req.user ? req.user.id : null,
      method: req.method,
      path: (req.originalUrl || req.url).split('?')[0],
      status: res.statusCode,
      ms: Date.now() - start
    };
    recentLogs.push(entry);
    if (recentLogs.length > 500) recentLogs.shift();
    if (NODE_ENV !== 'test') {
      fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', () => {});
      console.log(`${entry.t} ${entry.method} ${entry.path} ${entry.status} ${entry.ms}ms ` +
        `user=${entry.user || '-'} client=${(entry.client || '-').slice(0, 8)} ip=${entry.ip}`);
    }
  });
  next();
}
app.use('/api', logger);

// ---------------------------------------------------------------
//  BAN SYSTEM  — kept in memory for fast checks, sourced from the DB.
// ---------------------------------------------------------------
const banned = { user: new Set(), client: new Set(), ip: new Set() };
async function loadBans() {
  try {
    const { data, error } = await admin.from('bans').select('subject_type,subject_value');
    if (error) throw error;
    banned.user = new Set(); banned.client = new Set(); banned.ip = new Set();
    for (const b of data) if (banned[b.subject_type]) banned[b.subject_type].add(b.subject_value);
  } catch (e) {
    console.error('loadBans failed:', e.message);
  }
}

// IP / client bans are checked before anything else on /api.
app.use('/api', (req, res, next) => {
  if (banned.ip.has(req.ip) || (req.clientId && banned.client.has(req.clientId))) {
    return res.status(403).json({ error: 'Access blocked' });
  }
  next();
});

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many attempts, try later.' } });

app.use(express.static(path.join(__dirname, 'public')));
// APK / file downloads (drop reps.apk into the downloads/ folder)
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));
// Friendly URL for the install page
app.get('/install', (req, res) => res.sendFile(path.join(__dirname, 'public', 'install.html')));

const cookieOpts = {
  httpOnly: true, sameSite: 'strict', secure: NODE_ENV === 'production',
  maxAge: 7 * 24 * 3600 * 1000, path: '/'
};
const upload = multer({
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

const send = (res, { data, error }) =>
  error ? res.status(400).json({ error: error.message }) : res.json(data ?? { ok: true });

// ---- auth gate (also enforces user-level bans) ----
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.sb_token;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Session expired' });
    if (banned.user.has(data.user.id)) {
      res.clearCookie('sb_token', { path: '/' });
      return res.status(403).json({ error: 'Your account has been suspended' });
    }
    req.user = data.user;
    req.db = userClient(token);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}
function adminGate(req, res, next) {
  if (!req.user || !ADMINS.has((req.user.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}
const requireAdmin = [requireAuth, adminGate];

// ============================================================
//  AUTH
// ============================================================
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  const { email, password, full_name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const { error } = await admin.auth.signUp({ email, password, options: { data: { full_name } } });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, message: 'Account created. Check your email to confirm, then sign in.' });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const { data, error } = await admin.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });
  if (banned.user.has(data.user.id)) return res.status(403).json({ error: 'Your account has been suspended' });
  res.cookie('sb_token', data.session.access_token, cookieOpts);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('sb_token', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', requireAuth, (req, res) => res.json({ id: req.user.id, email: req.user.email }));

// ============================================================
//  PROFILE
// ============================================================
app.get('/api/profile', requireAuth, async (req, res) =>
  send(res, await req.db.from('profiles').select('*').eq('id', req.user.id).single()));

app.patch('/api/profile', requireAuth, async (req, res) => {
  const allowed = ['full_name', 'age', 'gender', 'height_cm', 'weight_kg', 'fitness_level',
    'activity_level', 'conditions', 'allergies', 'injuries', 'preferred_type', 'calendar_public'];
  const update = {};
  for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
  const { error } = await req.db.from('profiles').update(update).eq('id', req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// ============================================================
//  SESSIONS
// ============================================================
app.get('/api/sessions', requireAuth, async (req, res) =>
  send(res, await req.db.from('sessions').select('*')
    .not('ended_at', 'is', null).order('started_at', { ascending: false }).limit(20)));

app.post('/api/sessions', requireAuth, async (req, res) =>
  send(res, await req.db.from('sessions')
    .insert({ user_id: req.user.id, name: String(req.body?.name || 'Workout') }).select().single()));

app.post('/api/sessions/:id/finish', requireAuth, async (req, res) => {
  const id = req.params.id;
  const logs = Array.isArray(req.body?.logs) ? req.body.logs : [];
  if (logs.length) {
    const rows = logs.map(l => ({
      session_id: id, exercise_name: String(l.exercise_name || ''),
      set_number: parseInt(l.set_number) || 0, weight: Number(l.weight) || 0,
      reps: parseInt(l.reps) || 0, rpe: l.rpe == null ? null : Number(l.rpe), done: !!l.done
    }));
    const r1 = await req.db.from('set_logs').insert(rows);
    if (r1.error) return res.status(400).json({ error: r1.error.message });
  }
  const { error } = await req.db.from('sessions')
    .update({ ended_at: new Date().toISOString(), total_volume: Number(req.body?.total_volume) || 0 })
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', requireAuth, async (req, res) =>
  send(res, await req.db.from('sessions').delete().eq('id', req.params.id)));

// ============================================================
//  PHOTOS
// ============================================================
app.get('/api/photos', requireAuth, async (req, res) => {
  const { data, error } = await req.db.from('photos').select('*').order('taken_on', { ascending: false }).limit(60);
  if (error) return res.status(400).json({ error: error.message });
  const out = [];
  for (const p of data) {
    const { data: s } = await req.db.storage.from('progress-photos').createSignedUrl(p.storage_path, 3600);
    out.push({ ...p, url: s?.signedUrl || null });
  }
  res.json(out);
});

app.post('/api/photos', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A valid image is required' });
  const safe = (req.file.originalname || 'photo').replace(/[^a-zA-Z0-9.]/g, '');
  const storagePath = `${req.user.id}/${Date.now()}_${safe}`;
  const up = await req.db.storage.from('progress-photos')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (up.error) return res.status(400).json({ error: up.error.message });
  const { data, error } = await req.db.from('photos')
    .insert({ user_id: req.user.id, storage_path: storagePath, taken_on: new Date().toISOString().slice(0, 10) })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  if (req.body.share === 'true') await req.db.from('posts').insert({ user_id: req.user.id, photo_id: data.id });
  res.json({ ok: true });
});

// ============================================================
//  FRIENDS + FEED + REACTIONS
// ============================================================
app.get('/api/friends', requireAuth, async (req, res) => {
  const { data, error } = await req.db.from('friendships').select('*');
  if (error) return res.status(400).json({ error: error.message });
  const out = [];
  for (const f of data) {
    const other = f.requester_id === req.user.id ? f.addressee_id : f.requester_id;
    const incoming = f.addressee_id === req.user.id && f.status === 'pending';
    let name = null;
    if (f.status === 'accepted') {
      const { data: pr } = await req.db.from('profiles').select('full_name,friend_code').eq('id', other).maybeSingle();
      if (pr) name = pr.full_name || pr.friend_code;
    }
    out.push({ id: f.id, status: f.status, incoming, name });
  }
  res.json(out);
});

app.post('/api/friends', requireAuth, async (req, res) => {
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: 'Friend ID is required' });
  const { data: found, error: e0 } = await req.db.rpc('find_profile_by_code', { code });
  if (e0) return res.status(400).json({ error: e0.message });
  if (!found || !found.length) return res.status(404).json({ error: 'No user with that ID' });
  if (found[0].id === req.user.id) return res.status(400).json({ error: "That's your own ID" });
  const { error } = await req.db.from('friendships').insert({ requester_id: req.user.id, addressee_id: found[0].id });
  if (error) return res.status(400).json({ error: /duplicate/.test(error.message) ? 'Already added' : error.message });
  res.json({ ok: true });
});

app.post('/api/friends/:id/accept', requireAuth, async (req, res) =>
  send(res, await req.db.from('friendships').update({ status: 'accepted' }).eq('id', req.params.id)));

app.get('/api/feed', requireAuth, async (req, res) => {
  const { data, error } = await req.db.from('posts')
    .select('id,user_id,created_at,photos(storage_path),reactions(type,user_id)')
    .order('created_at', { ascending: false }).limit(20);
  if (error) return res.status(400).json({ error: error.message });
  const out = [];
  for (const p of data) {
    let url = null;
    if (p.photos?.storage_path) {
      const { data: s } = await req.db.storage.from('progress-photos').createSignedUrl(p.photos.storage_path, 3600);
      url = s?.signedUrl || null;
    }
    const r = p.reactions || [];
    out.push({
      id: p.id, mine: p.user_id === req.user.id, url,
      loves: r.filter(x => x.type === 'love').length,
      supports: r.filter(x => x.type === 'support').length,
      iLove: r.some(x => x.type === 'love' && x.user_id === req.user.id),
      iSupport: r.some(x => x.type === 'support' && x.user_id === req.user.id)
    });
  }
  res.json(out);
});

app.post('/api/reactions', requireAuth, async (req, res) => {
  const { post_id, type } = req.body || {};
  if (!post_id || !['love', 'support'].includes(type)) return res.status(400).json({ error: 'Bad request' });
  send(res, await req.db.from('reactions').insert({ post_id, user_id: req.user.id, type }));
});

app.delete('/api/reactions', requireAuth, async (req, res) => {
  const { post_id, type } = req.body || {};
  if (!post_id || !type) return res.status(400).json({ error: 'Bad request' });
  send(res, await req.db.from('reactions').delete().eq('post_id', post_id).eq('user_id', req.user.id).eq('type', type));
});

// ============================================================
//  REPORTING (users flag bad content/people)
// ============================================================
app.post('/api/reports', requireAuth, async (req, res) => {
  const { target_type, target_id, reason } = req.body || {};
  if (!['post', 'user'].includes(target_type) || !target_id) return res.status(400).json({ error: 'Bad request' });
  send(res, await req.db.from('reports').insert({
    reporter_id: req.user.id, target_type, target_id: String(target_id),
    reason: reason ? String(reason).slice(0, 500) : null
  }));
});

// ============================================================
//  ACCOUNT DELETION (user removes themselves + their data)
// ============================================================
app.delete('/api/account', requireAuth, async (req, res) => {
  try {
    const { data: list } = await admin.storage.from('progress-photos').list(req.user.id);
    if (list && list.length) {
      await admin.storage.from('progress-photos').remove(list.map(f => `${req.user.id}/${f.name}`));
    }
    const { error } = await admin.auth.admin.deleteUser(req.user.id);
    if (error) return res.status(400).json({ error: error.message });
    res.clearCookie('sb_token', { path: '/' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
//  ADMIN PANEL API  (owner only — set ADMIN_EMAILS in .env)
// ============================================================
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: true, email: req.user.email }));

app.get('/api/admin/logs', requireAdmin, (req, res) => res.json(recentLogs.slice(-200).reverse()));

app.get('/api/admin/bans', requireAdmin, async (req, res) =>
  send(res, await admin.from('bans').select('*').order('created_at', { ascending: false })));

app.post('/api/admin/ban', requireAdmin, async (req, res) => {
  const { type, value, reason } = req.body || {};
  if (!['user', 'client', 'ip'].includes(type) || !value) return res.status(400).json({ error: 'type and value are required' });
  const { error } = await admin.from('bans').upsert(
    { subject_type: type, subject_value: String(value), reason: reason || null, created_by: req.user.email },
    { onConflict: 'subject_type,subject_value' });
  if (error) return res.status(400).json({ error: error.message });
  await loadBans();
  res.json({ ok: true });
});

app.post('/api/admin/unban', requireAdmin, async (req, res) => {
  const { type, value } = req.body || {};
  if (!type || !value) return res.status(400).json({ error: 'type and value are required' });
  const { error } = await admin.from('bans').delete().eq('subject_type', type).eq('subject_value', String(value));
  if (error) return res.status(400).json({ error: error.message });
  await loadBans();
  res.json({ ok: true });
});

app.get('/api/admin/reports', requireAdmin, async (req, res) =>
  send(res, await admin.from('reports').select('*').order('created_at', { ascending: false }).limit(100)));

app.post('/api/admin/reports/:id/resolve', requireAdmin, async (req, res) =>
  send(res, await admin.from('reports').update({ resolved: true }).eq('id', req.params.id)));

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) throw error;
    res.json(data.users.map(u => ({ id: u.id, email: u.email, created_at: u.created_at })));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
//  GOALS  (primary goals + daily targets)
// ============================================================
app.get('/api/goals', requireAuth, async (req, res) =>
  send(res, await req.db.from('goals').select('*')));

app.put('/api/goals', requireAuth, async (req, res) => {
  const goals = Array.isArray(req.body?.goals) ? req.body.goals : [];
  const del = await req.db.from('goals').delete().eq('user_id', req.user.id);
  if (del.error) return res.status(400).json({ error: del.error.message });
  if (goals.length) {
    const rows = goals.map(g => ({
      user_id: req.user.id, kind: String(g.kind),
      target: g.target == null ? null : Number(g.target), unit: g.unit || null
    }));
    const ins = await req.db.from('goals').insert(rows);
    if (ins.error) return res.status(400).json({ error: ins.error.message });
  }
  res.json({ ok: true });
});

// ============================================================
//  CUSTOM WORKOUTS (templates the user builds)
// ============================================================
app.get('/api/workouts', requireAuth, async (req, res) =>
  send(res, await req.db.from('workouts')
    .select('id,name,created_at,workout_exercises(id,name,position,sets,reps,weight,rest_seconds)')
    .order('created_at', { ascending: false })));

app.post('/api/workouts', requireAuth, async (req, res) => {
  const name = String(req.body?.name || 'My workout');
  const exs = Array.isArray(req.body?.exercises) ? req.body.exercises : [];
  const w = await req.db.from('workouts').insert({ user_id: req.user.id, name }).select().single();
  if (w.error) return res.status(400).json({ error: w.error.message });
  if (exs.length) {
    const rows = exs.map((e, i) => ({
      workout_id: w.data.id, name: String(e.name || ''), position: i,
      sets: parseInt(e.sets) || null, reps: parseInt(e.reps) || null,
      weight: e.weight == null ? null : Number(e.weight), rest_seconds: parseInt(e.rest_seconds) || null
    }));
    const ie = await req.db.from('workout_exercises').insert(rows);
    if (ie.error) return res.status(400).json({ error: ie.error.message });
  }
  res.json({ ok: true, id: w.data.id });
});

app.delete('/api/workouts/:id', requireAuth, async (req, res) =>
  send(res, await req.db.from('workouts').delete().eq('id', req.params.id)));

// ============================================================
//  MEASUREMENTS
// ============================================================
app.get('/api/measurements', requireAuth, async (req, res) =>
  send(res, await req.db.from('measurements').select('*').order('measured_at', { ascending: false }).limit(300)));

app.post('/api/measurements', requireAuth, async (req, res) => {
  const { site, value_cm } = req.body || {};
  if (!site || value_cm == null) return res.status(400).json({ error: 'site and value are required' });
  send(res, await req.db.from('measurements').insert({ user_id: req.user.id, site: String(site), value_cm: Number(value_cm) }));
});

// ============================================================
//  PERSONAL RECORDS
// ============================================================
app.get('/api/prs', requireAuth, async (req, res) =>
  send(res, await req.db.from('personal_records').select('*').order('achieved_at', { ascending: false }).limit(100)));

app.post('/api/prs', requireAuth, async (req, res) => {
  const { lift, value, unit } = req.body || {};
  if (!lift || value == null) return res.status(400).json({ error: 'lift and value are required' });
  send(res, await req.db.from('personal_records').insert({ user_id: req.user.id, lift: String(lift), value: Number(value), unit: unit || 'kg' }));
});

// ============================================================
//  NUTRITION (food log)
// ============================================================
app.get('/api/food', requireAuth, async (req, res) => {
  const day = req.query.day || new Date().toISOString().slice(0, 10);
  send(res, await req.db.from('food_logs').select('*').eq('logged_on', day).order('created_at', { ascending: false }));
});

app.get('/api/food/history', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 120);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  send(res, await req.db.from('food_logs').select('kcal,logged_on').gte('logged_on', since));
});

app.post('/api/food', requireAuth, async (req, res) => {
  const { name, kcal } = req.body || {};
  if (!name || kcal == null) return res.status(400).json({ error: 'name and kcal are required' });
  send(res, await req.db.from('food_logs').insert({
    user_id: req.user.id, name: String(name).slice(0, 120), kcal: parseInt(kcal) || 0,
    logged_on: new Date().toISOString().slice(0, 10)
  }));
});

app.delete('/api/food/:id', requireAuth, async (req, res) =>
  send(res, await req.db.from('food_logs').delete().eq('id', req.params.id)));

// ============================================================
//  DAILY METRICS (water / steps / sleep / weight)
// ============================================================
app.get('/api/daily', requireAuth, async (req, res) => {
  const day = req.query.day || new Date().toISOString().slice(0, 10);
  const { data, error } = await req.db.from('daily_metrics').select('*').eq('day', day).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || { day, water_ml: 0, steps: 0, sleep_hours: null, weight_kg: null });
});

app.get('/api/daily/history', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 60, 180);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  send(res, await req.db.from('daily_metrics').select('*').gte('day', since).order('day', { ascending: true }));
});

app.put('/api/daily', requireAuth, async (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  const fields = {};
  for (const k of ['water_ml', 'steps', 'sleep_hours', 'weight_kg'])
    if (k in (req.body || {})) fields[k] = req.body[k] == null ? null : Number(req.body[k]);
  send(res, await req.db.from('daily_metrics').upsert({ user_id: req.user.id, day, ...fields }, { onConflict: 'user_id,day' }));
});

// ============================================================
//  STREAK (raw session dates; computed on the client)
// ============================================================
app.get('/api/streak', requireAuth, async (req, res) => {
  const { data, error } = await req.db.from('sessions').select('started_at')
    .not('ended_at', 'is', null).order('started_at', { ascending: false }).limit(400);
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map(s => s.started_at));
});

// ---- health + error handler ----
app.get('/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image too large (max 6 MB)' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

if (require.main === module) {
  // Start listening immediately. If this were gated behind loadBans()
  // (a network call to Supabase), a slow/unreachable Supabase — a typo'd
  // URL, a brief outage, a cold database — would leave the ENTIRE server
  // unreachable, including the static frontend and the /health check
  // Render uses to confirm the deploy succeeded. Ban enforcement is
  // still real, it just becomes ready a moment after the server does.
  app.listen(PORT, () =>
    console.log(`✓ REPS server on http://localhost:${PORT}  | admins: ${[...ADMINS].join(', ') || '(none set)'}`));
  loadBans();
}
module.exports = app;
