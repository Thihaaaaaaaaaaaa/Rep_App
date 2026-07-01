// Smoke tests that run WITHOUT a real Supabase project.
// They verify routing, the auth gate, input validation, static
// serving, and security headers. (End-to-end data tests need your
// real Supabase keys — see README.)

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'admin@example.com';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const app = require('./server');

const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  let pass = 0, fail = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log('  \u2713', name); pass++; }
    catch (e) { console.log('  \u2717', name, '\u2014', e.message); fail++; }
  };

  await check('GET /health returns { ok: true }', async () => {
    const r = await fetch(base + '/health');
    const j = await r.json();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(j.ok, true);
  });

  await check('protected route /api/me is 401 without a session', async () => {
    const r = await fetch(base + '/api/me');
    assert.strictEqual(r.status, 401);
  });

  await check('protected route /api/profile is 401 without a session', async () => {
    const r = await fetch(base + '/api/profile');
    assert.strictEqual(r.status, 401);
  });

  await check('protected route /api/sessions is 401 without a session', async () => {
    const r = await fetch(base + '/api/sessions');
    assert.strictEqual(r.status, 401);
  });

  await check('login with missing fields is rejected (400)', async () => {
    const r = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.strictEqual(r.status, 400);
  });

  await check('signup with short password is rejected (400)', async () => {
    const r = await fetch(base + '/api/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: '123' })
    });
    assert.strictEqual(r.status, 400);
  });

  await check('frontend index.html is served at /', async () => {
    const r = await fetch(base + '/');
    const t = await r.text();
    assert.strictEqual(r.status, 200);
    assert.ok(t.includes('RE') && t.toLowerCase().includes('<!doctype html'));
  });

  await check('security headers are present (helmet)', async () => {
    const r = await fetch(base + '/health');
    assert.ok(r.headers.get('content-security-policy'), 'CSP missing');
    assert.ok(r.headers.get('x-content-type-options'), 'nosniff missing');
  });

  await check('no Supabase keys leak to the frontend HTML', async () => {
    const r = await fetch(base + '/');
    const t = await r.text();
    assert.ok(!t.includes('service'), 'frontend must not contain the word "service" key material');
    assert.ok(!t.includes('supabase.co'), 'frontend must not reference Supabase directly');
  });

  await check('admin route /api/admin/logs is 401 without a session', async () => {
    const r = await fetch(base + '/api/admin/logs');
    assert.strictEqual(r.status, 401);
  });

  await check('admin route /api/admin/ban is 401 without a session', async () => {
    const r = await fetch(base + '/api/admin/ban', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', value: 'x' })
    });
    assert.strictEqual(r.status, 401);
  });

  await check('reporting /api/reports is 401 without a session', async () => {
    const r = await fetch(base + '/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: 'post', target_id: 'x' })
    });
    assert.strictEqual(r.status, 401);
  });

  await check('account deletion /api/account is 401 without a session', async () => {
    const r = await fetch(base + '/api/account', { method: 'DELETE' });
    assert.strictEqual(r.status, 401);
  });

  await check('X-Client-Id header is accepted (logged, not rejected)', async () => {
    const r = await fetch(base + '/api/me', { headers: { 'X-Client-Id': 'test-client-123' } });
    assert.strictEqual(r.status, 401); // still 401 (no auth) but header handled fine
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
});
