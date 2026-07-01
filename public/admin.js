// Admin panel. Sign in to the main app first with an email listed in
// ADMIN_EMAILS; the cookie is shared (same origin). Every endpoint here
// is server-side admin-gated, so this page is just a convenient face.

const $ = id => document.getElementById(id);
async function api(path, { method = 'GET', body = null } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
  return data;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = s => (s || '').length > 14 ? s.slice(0, 14) + '…' : (s || '');

async function boot() {
  try {
    const me = await api('/admin/me');
    $('who').textContent = 'Signed in as ' + me.email;
    $('panel').style.display = 'block';
    loadBans(); loadReports(); loadLogs();
  } catch (e) {
    $('who').innerHTML = 'Not authorized. <a href="/">Open the app</a>, sign in with an admin email (set in ADMIN_EMAILS), then reload this page.';
  }
}

async function loadBans() {
  try {
    const rows = await api('/admin/bans');
    $('bansBody').innerHTML = rows.length ? rows.map(b => `<tr>
      <td><span class="tag">${esc(b.subject_type)}</span></td>
      <td class="mono" title="${esc(b.subject_value)}">${esc(short(b.subject_value))}</td>
      <td>${esc(b.reason || '')}</td>
      <td><button class="ghost sm" data-unban="${esc(b.subject_type)}|${esc(b.subject_value)}">Unban</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">No active bans.</td></tr>';
    document.querySelectorAll('[data-unban]').forEach(btn => btn.onclick = () => {
      const [type, value] = btn.dataset.unban.split('|');
      unban(type, value);
    });
  } catch (e) { $('bansBody').innerHTML = `<tr><td colspan="4" class="empty">${esc(e.message)}</td></tr>`; }
}
async function ban() {
  const type = $('banType').value, value = $('banValue').value.trim(), reason = $('banReason').value.trim();
  if (!value) return;
  try { await api('/admin/ban', { method: 'POST', body: { type, value, reason } }); $('banValue').value = ''; $('banReason').value = ''; loadBans(); }
  catch (e) { alert(e.message); }
}
async function unban(type, value) {
  try { await api('/admin/unban', { method: 'POST', body: { type, value } }); loadBans(); }
  catch (e) { alert(e.message); }
}

async function loadReports() {
  try {
    const rows = await api('/admin/reports');
    const open = rows.filter(r => !r.resolved);
    $('reportsBody').innerHTML = open.length ? open.map(r => `<tr>
      <td class="mono">${new Date(r.created_at).toLocaleDateString()}</td>
      <td><span class="tag">${esc(r.target_type)}</span></td>
      <td class="mono" title="${esc(r.target_id)}">${esc(short(r.target_id))}</td>
      <td>${esc(r.reason || '')}</td>
      <td><button class="ghost sm" data-resolve="${esc(r.id)}">Resolve</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">No open reports.</td></tr>';
    document.querySelectorAll('[data-resolve]').forEach(btn => btn.onclick = () => resolve(btn.dataset.resolve));
  } catch (e) { $('reportsBody').innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`; }
}
async function resolve(id) {
  try { await api('/admin/reports/' + id + '/resolve', { method: 'POST' }); loadReports(); }
  catch (e) { alert(e.message); }
}

async function loadLogs() {
  try {
    const rows = await api('/admin/logs');
    $('logsBody').innerHTML = rows.length ? rows.map(l => `<tr>
      <td class="mono">${new Date(l.t).toLocaleTimeString()}</td>
      <td class="mono">${esc(l.method)}</td>
      <td class="mono">${esc(l.path)}</td>
      <td class="mono s${String(l.status)[0]}">${l.status}</td>
      <td class="mono" title="${esc(l.user)}">${esc(short(l.user) || '-')}</td>
      <td class="mono">${esc(l.ip)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No requests logged yet.</td></tr>';
  } catch (e) { $('logsBody').innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`; }
}

$('btnBan').onclick = ban;
$('rBans').onclick = loadBans;
$('rReports').onclick = loadReports;
$('rLogs').onclick = loadLogs;
boot();
