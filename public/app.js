'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// ---------- client id + api ----------
function clientId() {
  try {
    let id = localStorage.getItem('reps_cid');
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2)); localStorage.setItem('reps_cid', id); }
    return id;
  } catch (e) { return 'no-storage'; }
}
async function api(path, { method = 'GET', body = null, form = null } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Client-Id': clientId() } };
  if (form) opts.body = form;
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { showAuth(); throw new Error(data.error || 'Please sign in'); }
  if (r.status === 403) { toast(data.error || 'Access blocked', 1); showAuth(); throw new Error(data.error || 'Blocked'); }
  if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
  return data;
}
let toastT = null;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

// ---------- state ----------
let ME = {}; let DAILY = { water_ml: 0, steps: 0, sleep_hours: null, weight_kg: null }; let SESSION = null;

// ---------- static content ----------
const PROGRAMS = [
  { id: 'push', name: 'Push Day', focus: 'Chest · Shoulders · Triceps', tile: 'P', weeks: '8 weeks', level: 'Intermediate',
    exercises: [{ name: 'Bench Press', sets: 4, reps: '8' }, { name: 'Overhead Press', sets: 3, reps: '10' }, { name: 'Incline Dumbbell Press', sets: 3, reps: '10' }, { name: 'Lateral Raise', sets: 3, reps: '15' }, { name: 'Triceps Pushdown', sets: 3, reps: '12' }, { name: 'Overhead Extension', sets: 3, reps: '12' }] },
  { id: 'pull', name: 'Pull Day', focus: 'Back · Biceps', tile: 'L', weeks: '8 weeks', level: 'Intermediate',
    exercises: [{ name: 'Deadlift', sets: 3, reps: '5' }, { name: 'Pull-Up', sets: 3, reps: '8' }, { name: 'Barbell Row', sets: 4, reps: '10' }, { name: 'Lat Pulldown', sets: 3, reps: '12' }, { name: 'Face Pull', sets: 3, reps: '15' }, { name: 'Barbell Curl', sets: 3, reps: '12' }] },
  { id: 'legs', name: 'Leg Day', focus: 'Quads · Hamstrings · Glutes', tile: 'G', weeks: '8 weeks', level: 'Intermediate',
    exercises: [{ name: 'Squat', sets: 4, reps: '8' }, { name: 'Romanian Deadlift', sets: 3, reps: '10' }, { name: 'Leg Press', sets: 3, reps: '12' }, { name: 'Leg Curl', sets: 3, reps: '12' }, { name: 'Calf Raise', sets: 4, reps: '15' }] },
  { id: 'full', name: 'Full Body', focus: 'Total-body strength', tile: 'F', weeks: '6 weeks', level: 'Beginner',
    exercises: [{ name: 'Goblet Squat', sets: 3, reps: '12' }, { name: 'Push-Up', sets: 3, reps: '12' }, { name: 'Dumbbell Row', sets: 3, reps: '10' }, { name: 'Shoulder Press', sets: 3, reps: '10' }, { name: 'Plank', sets: 3, reps: '45s' }] }
];
const EX = {
  Chest: [{ name: 'Bench Press', muscle: 'Chest, Triceps', how: ['Lie flat, grip slightly wider than shoulders', 'Lower the bar to mid-chest', 'Press up to lockout'], err: ['Bouncing the bar off the chest', 'Flaring elbows straight out'], alt: ['Dumbbell Press', 'Push-Up'] },
    { name: 'Incline Dumbbell Press', muscle: 'Upper chest', how: ['Set the bench to ~30°', 'Press dumbbells up and slightly together', 'Lower under control'], err: ['Bench angle too steep', 'Over-arching the back'], alt: ['Incline Barbell Press'] }],
  Back: [{ name: 'Deadlift', muscle: 'Back, Glutes, Hamstrings', how: ['Bar over mid-foot', 'Flat back, brace hard', 'Drive through heels to stand'], err: ['Rounding the lower back', 'Letting the bar drift forward'], alt: ['Trap-Bar Deadlift', 'Rack Pull'] },
    { name: 'Pull-Up', muscle: 'Lats, Biceps', how: ['Hang with full grip', 'Pull chest toward the bar', 'Lower all the way down'], err: ['Half reps', 'Swinging for momentum'], alt: ['Lat Pulldown', 'Assisted Pull-Up'] }],
  Shoulders: [{ name: 'Overhead Press', muscle: 'Shoulders', how: ['Bar at collarbone', 'Press straight overhead', 'Lock out with bar over crown'], err: ['Leaning back too far', 'Pressing in front of the head'], alt: ['Dumbbell Shoulder Press'] },
    { name: 'Lateral Raise', muscle: 'Side delts', how: ['Slight bend in the elbows', 'Raise to shoulder height', 'Lower slowly'], err: ['Using momentum', 'Shrugging the traps'], alt: ['Cable Lateral Raise'] }],
  Legs: [{ name: 'Squat', muscle: 'Quads, Glutes', how: ['Bar on upper back', 'Break at hips and knees together', 'Hit parallel, then drive up'], err: ['Knees caving inward', 'Heels lifting off the floor'], alt: ['Front Squat', 'Leg Press'] },
    { name: 'Romanian Deadlift', muscle: 'Hamstrings', how: ['Soft knees', 'Hinge at the hips', 'Feel the stretch, then return'], err: ['Bending the knees too much', 'Rounding the back'], alt: ['Leg Curl', 'Good Morning'] }],
  Arms: [{ name: 'Barbell Curl', muscle: 'Biceps', how: ['Elbows pinned to your sides', 'Curl the bar up', 'Lower fully'], err: ['Swinging the torso', 'Cutting reps short'], alt: ['Dumbbell Curl', 'Cable Curl'] },
    { name: 'Triceps Pushdown', muscle: 'Triceps', how: ['Elbows fixed at your sides', 'Extend down to lockout', 'Control the way up'], err: ['Elbows drifting out', 'Leaning over the bar'], alt: ['Overhead Extension', 'Dips'] }],
  Core: [{ name: 'Plank', muscle: 'Core', how: ['Forearms on the floor', 'Straight line, head to heel', 'Brace and hold'], err: ['Hips sagging down', 'Hips piking up'], alt: ['Dead Bug', 'Hollow Hold'] },
    { name: 'Hanging Leg Raise', muscle: 'Lower abs', how: ['Hang from the bar', 'Raise legs to 90°', 'Lower slowly'], err: ['Swinging', 'Using momentum'], alt: ['Lying Leg Raise'] }]
};
const QUICK = [{ name: 'Chicken breast 150g', kcal: 248 }, { name: 'Rice 1 cup', kcal: 206 }, { name: 'Banana', kcal: 105 }, { name: 'Protein shake', kcal: 160 }, { name: 'Eggs (2)', kcal: 156 }, { name: 'Oats 50g', kcal: 190 }];
const PRIMARIES = [{ id: 'lose_weight', name: 'Lose weight', d: 'Cut body fat' }, { id: 'build_muscle', name: 'Build muscle', d: 'Add lean mass' }, { id: 'get_stronger', name: 'Get stronger', d: 'Raise your lifts' }, { id: 'stay_consistent', name: 'Stay consistent', d: 'Build the habit' }];

function targetsFrom(goals) {
  const t = { water: 2500, steps: 10000, sleep: 8, calories: 2200, primary: null };
  for (const g of (goals || [])) { if (g.kind === 'primary') t.primary = g.unit; else if (g.kind in t) t[g.kind] = g.target; }
  return t;
}

// ---------- date helpers ----------
const ymd = d => new Date(d).toISOString().slice(0, 10);
function mondayOf(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x; }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

// ---------- auth ----------
function authView(which) { $('a-login').classList.toggle('active', which === 'login'); $('a-signup').classList.toggle('active', which === 'signup'); }
function showAuth() { $('nav').classList.remove('show'); document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.querySelectorAll('.sub').forEach(s => s.classList.remove('active')); authView('login'); }
async function onLogin() { $('nav').classList.add('show'); document.querySelectorAll('.auth').forEach(a => a.classList.remove('active')); try { ME = await api('/profile'); } catch (e) { ME = {}; } go('home'); }
async function signIn() { const email = $('liEmail').value.trim(), password = $('liPass').value; if (!email || !password) { toast('Enter email and password', 1); return; } try { await api('/auth/login', { method: 'POST', body: { email, password } }); $('liPass').value = ''; onLogin(); } catch (e) { toast(e.message, 1); } }
async function signUp() { const full_name = $('suName').value.trim(), email = $('suEmail').value.trim(), password = $('suPass').value; if (!email || password.length < 6) { toast('Valid email and a 6+ character password', 1); return; } try { const r = await api('/auth/signup', { method: 'POST', body: { email, password, full_name } }); toast(r.message || 'Account created — check your email'); authView('login'); $('liEmail').value = email; } catch (e) { toast(e.message, 1); } }
async function signOut() { try { await api('/auth/logout', { method: 'POST' }); } catch (e) {} ME = {}; showAuth(); }
async function deleteAccount() { if (!confirm('Delete your account and all your data? This cannot be undone.')) return; if (!confirm('Are you absolutely sure?')) return; try { await api('/account', { method: 'DELETE' }); toast('Account deleted'); ME = {}; showAuth(); } catch (e) { toast(e.message, 1); } }

// ---------- navigation ----------
function switchScreen(tab) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(tab).classList.add('active'); document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.t === tab)); }
function openSub(screen, mainId, subId, html) { $(subId).innerHTML = html; $(mainId).style.display = 'none'; $(subId).classList.add('active'); $(screen).scrollTop = 0; }
function closeSub(mainId, subId) { const s = $(subId); s.classList.remove('active'); s.innerHTML = ''; $(mainId).style.display = 'block'; }
function closeAllSubs() { [['wkMain', 'wkSub'], ['trkMain', 'trkSub'], ['pfMain', 'pfSub']].forEach(([m, s]) => { const sub = $(s); if (sub) { sub.classList.remove('active'); sub.innerHTML = ''; } if ($(m)) $(m).style.display = 'block'; }); }
function go(tab) {
  closeAllSubs(); switchScreen(tab); $(tab).scrollTop = 0;
  if (tab === 'home') loadHome();
  else if (tab === 'workouts') showWorkoutTab(curWk);
  else if (tab === 'track') { if (SESSION) openSession(); else loadTrack(); }
  else if (tab === 'progress') loadProgress();
  else if (tab === 'friends') loadFriends();
  else if (tab === 'profile') loadProfile();
}

// ---------- HOME ----------
function renderStreak(dates) {
  const days = new Set((dates || []).map(ymd));
  const mon = mondayOf(new Date());
  const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  let html = '', weekCount = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); const on = days.has(ymd(d)); if (on) weekCount++; html += `<div class="wd ${on ? 'on' : ''}"><div class="dot">✓</div><span>${names[i]}</span></div>`; }
  $('weekDots').innerHTML = html;
  const wkKey = d => ymd(mondayOf(d)); const byWeek = {}; days.forEach(ds => { const k = wkKey(ds); byWeek[k] = (byWeek[k] || 0) + 1; });
  let streak = 0, cursor = new Date(mon);
  if ((byWeek[wkKey(cursor)] || 0) < 2) cursor.setDate(cursor.getDate() - 7);
  while ((byWeek[wkKey(cursor)] || 0) >= 2) { streak++; cursor.setDate(cursor.getDate() - 7); }
  $('streakNum').textContent = streak;
  const left = 2 - weekCount;
  $('streakStatus').textContent = weekCount >= 2 ? `${weekCount} gym days this week — locked in` : `${left} more day${left === 1 ? '' : 's'} this week to keep it`;
}
function renderHomeGoals(daily, kcal, t) {
  const items = [['Water', daily.water_ml || 0, t.water, 'ml'], ['Steps', daily.steps || 0, t.steps, ''], ['Calories', kcal, t.calories, 'kcal']];
  $('homeGoals').innerHTML = items.map(([n, v, g, u]) => `<div class="goalbar"><div class="gm"><div class="t"><b>${n}</b><span><span class="mono">${v}</span> / ${g} ${u}</span></div><div class="track"><i style="width:${Math.min(100, v / g * 100)}%"></i></div></div></div>`).join('');
}
async function loadHome() {
  $('homeDate').textContent = new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
  $('homeHi').textContent = greeting() + (ME.full_name ? ', ' + ME.full_name.split(' ')[0] : '');
  try {
    const [streak, daily, food, goals] = await Promise.all([api('/streak'), api('/daily'), api('/food'), api('/goals')]);
    renderStreak(streak); renderHomeGoals(daily, food.reduce((a, b) => a + b.kcal, 0), targetsFrom(goals));
  } catch (e) {}
}

// ---------- WORKOUTS ----------
let curWk = 'programs', curCat = 'Chest';
function showWorkoutTab(w) {
  const sub = $('wkSub'); sub.classList.remove('active'); sub.innerHTML = ''; $('wkMain').style.display = 'block';
  curWk = w; document.querySelectorAll('#workouts .seg button').forEach(b => b.classList.toggle('on', b.dataset.w === w));
  ['programs', 'library', 'mine'].forEach(k => $('wp-' + k).style.display = k === w ? 'block' : 'none');
  if (w === 'programs') renderPrograms(); else if (w === 'library') renderLibrary(); else loadTemplates();
}
function renderPrograms() {
  $('programList').innerHTML = PROGRAMS.map(p => `<div class="card prog" data-id="${p.id}"><div class="row"><div class="tile acc">${p.tile}</div><div class="info"><h3>${p.name}</h3><p>${p.focus}</p></div><div class="arr">›</div></div></div>`).join('');
  $('programList').querySelectorAll('.prog').forEach(c => c.onclick = () => openProgram(c.dataset.id));
}
function openProgram(id) {
  const p = PROGRAMS.find(x => x.id === id);
  openSub('workouts', 'wkMain', 'wkSub', `<button class="back" id="pBack">‹ Workouts</button>
    <div class="cover"><div class="mark">${p.tile}</div><h1>${p.name}</h1></div>
    <div class="row" style="margin-bottom:6px"><span class="pill acc">${p.level}</span><span class="pill">${p.weeks}</span><span class="pill">${p.exercises.length} exercises</span></div>
    <p style="color:var(--muted);font-size:13px;margin:6px 0">${p.focus}</p>
    <div class="sec"><h2>Exercises</h2></div>
    ${p.exercises.map(e => `<div class="card row"><div class="info"><h3>${e.name}</h3><p>${e.sets} sets × ${e.reps}</p></div></div>`).join('')}
    <button class="btn btn-accent btn-block" id="pStart" style="margin-top:14px">Start this workout</button>`);
  $('pBack').onclick = () => closeSub('wkMain', 'wkSub');
  $('pStart').onclick = () => startWorkout(p.name, p.exercises);
}
function renderLibrary() {
  $('catChips').innerHTML = Object.keys(EX).map(c => `<span class="chip ${c === curCat ? 'on' : ''}" data-c="${c}">${c}</span>`).join('');
  $('catChips').querySelectorAll('.chip').forEach(ch => ch.onclick = () => { curCat = ch.dataset.c; renderLibrary(); });
  $('exerciseList').innerHTML = EX[curCat].map((e, i) => `<div class="card row exitem" data-i="${i}"><div class="info"><h3>${e.name}</h3><p>${e.muscle}</p></div><div class="arr">›</div></div>`).join('');
  $('exerciseList').querySelectorAll('.exitem').forEach(c => c.onclick = () => openExercise(curCat, +c.dataset.i));
}
function openExercise(cat, i) {
  const e = EX[cat][i];
  openSub('workouts', 'wkMain', 'wkSub', `<button class="back" id="eBack">‹ Library</button>
    <div class="head"><div class="eyebrow">${e.muscle}</div><h1>${e.name}</h1></div>
    <div class="media"><div class="play">▶</div><small>Form demo</small></div>
    <div class="dblock"><div class="lbl">How to</div><ol class="dlist num">${e.how.map(h => `<li>${h}</li>`).join('')}</ol></div>
    <div class="dblock"><div class="lbl">Common mistakes</div><ul class="dlist">${e.err.map(h => `<li>${h}</li>`).join('')}</ul></div>
    <div class="dblock"><div class="lbl">Alternatives</div><div style="margin-top:6px">${e.alt.map(a => `<span class="pill">${a}</span>`).join('')}</div></div>`);
  $('eBack').onclick = () => closeSub('wkMain', 'wkSub');
}
async function loadTemplates() {
  try {
    const w = await api('/workouts');
    $('templateList').innerHTML = w.length ? w.map(t => `<div class="card"><div class="row"><div class="tile">▤</div><div class="info"><h3>${esc(t.name)}</h3><p>${(t.workout_exercises || []).length} exercises</p></div><span class="del2" data-id="${t.id}" style="color:var(--faint);cursor:pointer;font-size:18px">×</span></div><div style="margin-top:10px"><button class="btn btn-primary btn-xs start2" data-id="${t.id}">Start</button></div></div>`).join('') : '<p class="empty">No saved workouts yet. Create one above.</p>';
    $('templateList').querySelectorAll('.del2').forEach(b => b.onclick = async () => { if (confirm('Delete this workout?')) { try { await api('/workouts/' + b.dataset.id, { method: 'DELETE' }); loadTemplates(); } catch (e) { toast(e.message, 1); } } });
    $('templateList').querySelectorAll('.start2').forEach(b => b.onclick = () => { const t = w.find(x => String(x.id) === b.dataset.id); const exs = (t.workout_exercises || []).slice().sort((a, b) => a.position - b.position).map(e => ({ name: e.name, sets: e.sets || 3, reps: e.reps || '' })); startWorkout(t.name, exs.length ? exs : [{ name: 'Exercise 1', sets: 3 }]); });
  } catch (e) { $('templateList').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
let builderRows = [];
function openBuilder() { builderRows = [{ name: '', sets: 3, reps: 10, weight: '' }]; renderBuilder(''); }
function renderBuilder(name) {
  const rows = builderRows.map((r, i) => `<div class="bx"><div class="bxh"><input class="bn" data-i="${i}" placeholder="Exercise name" value="${esc(r.name)}"/><span class="ic rm" data-i="${i}">×</span></div>
    <div class="bxr"><div><div class="l">Sets</div><input class="bs" data-i="${i}" inputmode="numeric" value="${r.sets}"/></div><div><div class="l">Reps</div><input class="br" data-i="${i}" inputmode="numeric" value="${r.reps}"/></div><div><div class="l">Kg</div><input class="bw" data-i="${i}" inputmode="decimal" value="${r.weight}"/></div></div></div>`).join('');
  openSub('workouts', 'wkMain', 'wkSub', `<button class="back" id="bBack">‹ Workouts</button>
    <div class="head"><div class="eyebrow">New</div><h1>Build workout</h1></div>
    <div class="field"><label>Workout name</label><input id="bName" placeholder="e.g. Upper A" value="${esc(name || '')}"/></div>
    <div id="bRows">${rows}</div>
    <button class="btn btn-line btn-block" id="bAdd">+ Add exercise</button>
    <button class="btn btn-accent btn-block" id="bSave" style="margin-top:10px">Save workout</button>`);
  const sync = () => { $('bRows').querySelectorAll('.bn').forEach(el => builderRows[+el.dataset.i].name = el.value); $('bRows').querySelectorAll('.bs').forEach(el => builderRows[+el.dataset.i].sets = el.value); $('bRows').querySelectorAll('.br').forEach(el => builderRows[+el.dataset.i].reps = el.value); $('bRows').querySelectorAll('.bw').forEach(el => builderRows[+el.dataset.i].weight = el.value); };
  $('bRows').querySelectorAll('input').forEach(el => el.addEventListener('input', sync));
  $('bRows').querySelectorAll('.rm').forEach(b => b.onclick = () => { sync(); builderRows.splice(+b.dataset.i, 1); if (!builderRows.length) builderRows = [{ name: '', sets: 3, reps: 10, weight: '' }]; renderBuilder($('bName').value); });
  $('bAdd').onclick = () => { sync(); builderRows.push({ name: '', sets: 3, reps: 10, weight: '' }); renderBuilder($('bName').value); };
  $('bBack').onclick = () => closeSub('wkMain', 'wkSub');
  $('bSave').onclick = async () => {
    sync(); const nm = $('bName').value.trim() || 'My workout';
    const exercises = builderRows.filter(r => String(r.name).trim()).map(r => ({ name: r.name.trim(), sets: +r.sets || 3, reps: +r.reps || null, weight: r.weight ? +r.weight : null }));
    if (!exercises.length) { toast('Add at least one exercise', 1); return; }
    try { await api('/workouts', { method: 'POST', body: { name: nm, exercises } }); toast('Workout saved'); showWorkoutTab('mine'); } catch (e) { toast(e.message, 1); }
  };
}

// ---------- active session ----------
function sessionVolume() { let v = 0; if (SESSION) SESSION.exercises.forEach(e => e.sets.forEach(s => { if (s.done) v += (+s.weight || 0) * (+s.reps || 0); })); return Math.round(v); }
function doneSets() { let n = 0; if (SESSION) SESSION.exercises.forEach(e => e.sets.forEach(s => { if (s.done) n++; })); return n; }
function updateSessionStats() { if ($('sVol')) $('sVol').textContent = sessionVolume(); if ($('sSets')) $('sSets').textContent = doneSets(); }
let sessTimer = null;
function startSessionTimer() { clearInterval(sessTimer); sessTimer = setInterval(() => { const el = $('sTime'); if (!el || !SESSION) { clearInterval(sessTimer); return; } const sec = Math.floor((Date.now() - SESSION.start) / 1000); el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }, 1000); }
function stopSessionTimer() { clearInterval(sessTimer); }
async function startWorkout(name, exercises) {
  try {
    const s = await api('/sessions', { method: 'POST', body: { name } });
    SESSION = { id: s.id, name, start: Date.now(), exercises: (exercises || []).map(e => ({ name: e.name, target: e.reps || '', sets: Array.from({ length: e.sets || 3 }).map(() => ({ weight: '', reps: '', rpe: '', done: false })) })) };
    switchScreen('track'); openSession();
  } catch (e) { toast(e.message, 1); }
}
function openSession() {
  const s = SESSION; if (!s) { loadTrack(); return; }
  const exHtml = s.exercises.map((ex, ei) => `<div class="ex"><div class="exhead"><h3>${esc(ex.name)}</h3><span>TARGET ${ex.target || '—'}</span></div>
    <div class="colhead"><span>KG</span><span>REPS</span><span>RPE</span></div>
    ${ex.sets.map((st, si) => `<div class="setrow ${st.done ? 'done' : ''}" data-e="${ei}" data-s="${si}"><div class="sn">${si + 1}</div><input class="w" inputmode="decimal" value="${st.weight}" placeholder="0"/><input class="r" inputmode="numeric" value="${st.reps}" placeholder="0"/><input class="rpe" inputmode="numeric" value="${st.rpe}" placeholder="-"/><button class="tick">✓</button></div>`).join('')}
    <button class="btn btn-line btn-xs addset" data-e="${ei}" style="margin-top:8px">+ Add set</button></div>`).join('');
  openSub('track', 'trkMain', 'trkSub', `<button class="back" id="sBack">‹ Cancel</button>
    <div class="head"><div class="eyebrow">In progress</div><h1>${esc(s.name)}</h1></div>
    <div class="sstats"><div class="sstat"><div class="v mono" id="sVol">${sessionVolume()}</div><div class="l">Volume (kg)</div></div><div class="sstat"><div class="v mono" id="sSets">${doneSets()}</div><div class="l">Sets done</div></div><div class="sstat"><div class="v mono acc" id="sTime">0:00</div><div class="l">Elapsed</div></div></div>
    ${exHtml}
    <button class="btn btn-accent btn-block" id="sFinish" style="margin-top:18px">Finish &amp; save</button>`);
  $('trkSub').querySelectorAll('.setrow').forEach(row => {
    const ei = +row.dataset.e, si = +row.dataset.s;
    row.querySelector('.w').addEventListener('input', e => { SESSION.exercises[ei].sets[si].weight = e.target.value; updateSessionStats(); });
    row.querySelector('.r').addEventListener('input', e => { SESSION.exercises[ei].sets[si].reps = e.target.value; updateSessionStats(); });
    row.querySelector('.rpe').addEventListener('input', e => { SESSION.exercises[ei].sets[si].rpe = e.target.value; });
    row.querySelector('.tick').addEventListener('click', () => { const st = SESSION.exercises[ei].sets[si]; st.done = !st.done; row.classList.toggle('done', st.done); updateSessionStats(); if (st.done) startRest(90); });
  });
  $('trkSub').querySelectorAll('.addset').forEach(b => b.onclick = () => { SESSION.exercises[+b.dataset.e].sets.push({ weight: '', reps: '', rpe: '', done: false }); openSession(); });
  $('sBack').onclick = () => { if (confirm('Discard this workout?')) { SESSION = null; stopSessionTimer(); closeSub('trkMain', 'trkSub'); loadTrack(); } };
  $('sFinish').onclick = finishSession;
  startSessionTimer();
}
async function finishSession() {
  const logs = [];
  SESSION.exercises.forEach(ex => ex.sets.forEach((st, i) => { if (st.done || st.weight || st.reps) logs.push({ exercise_name: ex.name, set_number: i + 1, weight: +st.weight || 0, reps: +st.reps || 0, rpe: st.rpe ? +st.rpe : null, done: !!st.done }); }));
  try { await api('/sessions/' + SESSION.id + '/finish', { method: 'POST', body: { logs, total_volume: sessionVolume() } }); toast('Workout saved 💪'); SESSION = null; stopSessionTimer(); closeSub('trkMain', 'trkSub'); switchScreen('home'); loadHome(); }
  catch (e) { toast(e.message, 1); }
}

// ---------- rest popup ----------
let restInt = null, restLeft = 0;
function paintRest() { const m = Math.floor(Math.max(restLeft, 0) / 60), s = Math.max(restLeft, 0) % 60; $('restRead').textContent = `${m}:${String(s).padStart(2, '0')}`; }
function startRest(sec) { restLeft = sec; $('restPop').classList.add('show'); paintRest(); clearInterval(restInt); restInt = setInterval(() => { restLeft--; paintRest(); if (restLeft <= 0) { clearInterval(restInt); $('restPop').classList.remove('show'); toast('Rest done — next set'); } }, 1000); }

// ---------- TRACK ----------
async function loadTrack() {
  closeSub('trkMain', 'trkSub');
  try {
    const [daily, food, goals] = await Promise.all([api('/daily'), api('/food'), api('/goals')]);
    DAILY = daily; const t = targetsFrom(goals);
    $('trkKcal').textContent = food.reduce((a, b) => a + b.kcal, 0);
    $('waterV').textContent = daily.water_ml || 0; $('waterBar').style.width = Math.min(100, (daily.water_ml || 0) / t.water * 100) + '%';
    $('stepsV').textContent = daily.steps || 0; $('stepsBar').style.width = Math.min(100, (daily.steps || 0) / t.steps * 100) + '%';
    $('sleepV').textContent = daily.sleep_hours != null ? daily.sleep_hours : '—'; $('sleepBar').style.width = Math.min(100, (daily.sleep_hours || 0) / t.sleep * 100) + '%';
    $('wtV').textContent = daily.weight_kg != null ? daily.weight_kg : '—';
  } catch (e) {}
}
async function saveDaily(patch) { try { await api('/daily', { method: 'PUT', body: patch }); loadTrack(); } catch (e) { toast(e.message, 1); } }
async function openNutrition() {
  openSub('track', 'trkMain', 'trkSub', `<button class="back" id="nBack">‹ Track</button><div class="head"><div class="eyebrow">Today</div><h1>Nutrition</h1></div>
    <div class="card"><div class="chart-meta"><div><div class="eyebrow">Calories today</div><div class="v mono"><span id="nTotal">0</span> <span style="font-size:13px;color:var(--muted)">/ <span id="nTarget">2200</span></span></div></div></div><div class="track" style="height:7px"><i id="nBar" style="width:0%"></i></div></div>
    <div class="add-food"><input id="nName" placeholder="Food name"/><input id="nKcal" class="kcal" inputmode="numeric" placeholder="kcal"/><button class="btn btn-primary btn-xs" id="nAdd">Add</button></div>
    <div class="quick" id="nQuick"></div><div class="card" id="nList"></div>`);
  $('nQuick').innerHTML = QUICK.map((q, i) => `<span class="qchip" data-i="${i}">+ ${esc(q.name.split(' ')[0])} ${q.kcal}</span>`).join('');
  $('nQuick').querySelectorAll('.qchip').forEach(c => c.onclick = () => { const q = QUICK[+c.dataset.i]; addFood(q.name, q.kcal); });
  $('nAdd').onclick = () => { const n = $('nName').value.trim(), k = +$('nKcal').value; if (!n || !k) return; addFood(n, k); $('nName').value = ''; $('nKcal').value = ''; };
  $('nBack').onclick = () => { closeSub('trkMain', 'trkSub'); loadTrack(); };
  refreshFood();
}
async function addFood(name, kcal) { try { await api('/food', { method: 'POST', body: { name, kcal } }); refreshFood(); } catch (e) { toast(e.message, 1); } }
async function refreshFood() {
  try {
    const [items, goals] = await Promise.all([api('/food'), api('/goals')]);
    if (!$('nTotal')) return;
    const t = targetsFrom(goals), total = items.reduce((a, b) => a + b.kcal, 0);
    $('nTotal').textContent = total; $('nTarget').textContent = t.calories; $('nBar').style.width = Math.min(100, total / t.calories * 100) + '%';
    $('nList').innerHTML = items.length ? items.map(f => `<div class="fooditem"><div class="fn">${esc(f.name)}</div><div class="fk">${f.kcal}</div><span class="del" data-id="${f.id}">×</span></div>`).join('') : '<p class="empty">No food logged yet.</p>';
    $('nList').querySelectorAll('.del').forEach(d => d.onclick = async () => { try { await api('/food/' + d.dataset.id, { method: 'DELETE' }); refreshFood(); } catch (e) { toast(e.message, 1); } });
  } catch (e) {}
}
let tInt = null, tLeft = 0, tTotal = 90, tRun = false;
function paintT() { const m = Math.floor(Math.max(tLeft, 0) / 60), s = Math.max(tLeft, 0) % 60; if ($('tRead')) $('tRead').textContent = `${m}:${String(s).padStart(2, '0')}`; if ($('tArc')) $('tArc').style.strokeDashoffset = String(653 * (1 - Math.max(tLeft, 0) / tTotal)); }
function openTimer() {
  openSub('track', 'trkMain', 'trkSub', `<button class="back" id="tBack">‹ Track</button><div class="head"><div class="eyebrow">Rest</div><h1>Timer</h1></div>
    <div class="timer-wrap"><div class="ring2"><svg viewBox="0 0 230 230"><circle cx="115" cy="115" r="104" stroke="var(--surface2)" stroke-width="12"/><circle id="tArc" cx="115" cy="115" r="104" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray="653" stroke-dashoffset="0"/></svg><div class="read"><div class="t mono" id="tRead">1:30</div><div class="lab">Rest timer</div></div></div>
    <div class="presets" id="tPresets"></div><button class="btn btn-accent btn-block" id="tToggle">Start</button></div>`);
  const presets = [30, 60, 90, 120, 180];
  const drawPresets = () => { $('tPresets').innerHTML = presets.map(p => `<button class="preset ${p === tTotal ? 'sel' : ''}" data-p="${p}">${p < 60 ? p + 's' : (p / 60) + 'm'}</button>`).join(''); $('tPresets').querySelectorAll('.preset').forEach(b => b.onclick = () => { tTotal = +b.dataset.p; tLeft = tTotal; tRun = false; clearInterval(tInt); $('tToggle').textContent = 'Start'; drawPresets(); paintT(); }); };
  drawPresets(); tLeft = tTotal; paintT();
  $('tToggle').onclick = () => { if (tRun) { clearInterval(tInt); tRun = false; $('tToggle').textContent = 'Resume'; } else { tRun = true; $('tToggle').textContent = 'Pause'; clearInterval(tInt); tInt = setInterval(() => { tLeft--; paintT(); if (tLeft <= 0) { clearInterval(tInt); tRun = false; $('tToggle').textContent = 'Start'; toast('Time!'); tLeft = tTotal; setTimeout(paintT, 1400); } }, 1000); } };
  $('tBack').onclick = () => { clearInterval(tInt); tRun = false; closeSub('trkMain', 'trkSub'); };
}
async function openStartPicker() {
  let tpl = []; try { tpl = await api('/workouts'); } catch (e) {}
  const progHtml = PROGRAMS.map(p => `<div class="card row picker" data-type="prog" data-id="${p.id}"><div class="tile acc">${p.tile}</div><div class="info"><h3>${p.name}</h3><p>${p.exercises.length} exercises</p></div><div class="arr">›</div></div>`).join('');
  const tplHtml = tpl.length ? tpl.map(w => `<div class="card row picker" data-type="tpl" data-id="${w.id}"><div class="tile">▤</div><div class="info"><h3>${esc(w.name)}</h3><p>${(w.workout_exercises || []).length} exercises</p></div><div class="arr">›</div></div>`).join('') : '';
  openSub('track', 'trkMain', 'trkSub', `<button class="back" id="spBack">‹ Track</button><div class="head"><div class="eyebrow">Choose</div><h1>Start workout</h1></div>
    <div class="eyebrow" style="margin:4px 2px 8px">Programs</div>${progHtml}
    ${tplHtml ? `<div class="eyebrow" style="margin:16px 2px 8px">My workouts</div>${tplHtml}` : ''}
    <button class="btn btn-line btn-block" id="spEmpty" style="margin-top:14px">Empty workout</button>`);
  $('spBack').onclick = () => closeSub('trkMain', 'trkSub');
  $('spEmpty').onclick = () => startWorkout('Workout', [{ name: 'Exercise 1', sets: 3, reps: '' }]);
  $('trkSub').querySelectorAll('.picker').forEach(c => c.onclick = () => {
    if (c.dataset.type === 'prog') { const p = PROGRAMS.find(x => x.id === c.dataset.id); startWorkout(p.name, p.exercises); }
    else { const w = tpl.find(x => String(x.id) === c.dataset.id); const exs = (w.workout_exercises || []).slice().sort((a, b) => a.position - b.position).map(e => ({ name: e.name, sets: e.sets || 3, reps: e.reps || '' })); startWorkout(w.name, exs.length ? exs : [{ name: 'Exercise 1', sets: 3 }]); }
  });
}

// ---------- PROGRESS ----------
let curMetric = 'weight';
function renderMetricChips() { const ms = [['weight', 'Weight'], ['bmi', 'BMI'], ['calories', 'Calories'], ['frequency', 'Frequency']]; $('metricChips').innerHTML = ms.map(([k, l]) => `<span class="chip ${k === curMetric ? 'on' : ''}" data-m="${k}">${l}</span>`).join(''); $('metricChips').querySelectorAll('.chip').forEach(c => c.onclick = () => { curMetric = c.dataset.m; renderMetricChips(); drawMetric(); }); }
function paintChart(vals, labels, label) {
  $('chartLbl').textContent = label;
  if (!vals.length) { $('chartVal').textContent = '—'; $('chartBox').innerHTML = '<p class="empty">No data yet — log some entries.</p>'; return; }
  $('chartVal').textContent = vals[vals.length - 1];
  const w = 320, h = 150, pad = 10, min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
  const X = i => pad + i * (w - 2 * pad) / Math.max(vals.length - 1, 1), Y = v => h - pad - ((v - min) / rng) * (h - 2 * pad);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const area = d + ` L${X(vals.length - 1).toFixed(1)} ${h - pad} L${X(0).toFixed(1)} ${h - pad} Z`;
  const dots = vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" fill="var(--accent)"/>`).join('');
  $('chartBox').innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#cg)"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}
function paintBars(vals, labels, activeIdx) {
  $('chartLbl').textContent = 'Sessions / week'; $('chartVal').textContent = (vals[activeIdx] || 0) + ' this week';
  const max = Math.max(...vals, 1);
  $('chartBox').innerHTML = `<div class="bars">${vals.map((v, i) => `<div class="b ${i === activeIdx ? 'on' : ''}"><i style="height:${Math.max(v / max * 100, 4)}%"></i><span>${labels[i]}</span></div>`).join('')}</div>`;
}
async function drawMetric() {
  try {
    if (curMetric === 'weight' || curMetric === 'bmi') {
      const hist = await api('/daily/history?days=90'); const pts = hist.filter(d => d.weight_kg != null); const hm = (ME.height_cm || 175) / 100;
      const vals = pts.map(d => curMetric === 'bmi' ? +(d.weight_kg / (hm * hm)).toFixed(1) : +d.weight_kg);
      paintChart(vals, pts.map(d => d.day.slice(5)), curMetric === 'bmi' ? 'BMI' : 'Weight (kg)');
    } else if (curMetric === 'calories') {
      const hist = await api('/food/history?days=14'); const byDay = {}; hist.forEach(f => { byDay[f.logged_on] = (byDay[f.logged_on] || 0) + f.kcal; });
      const days = Object.keys(byDay).sort(); paintChart(days.map(d => byDay[d]), days.map(d => d.slice(5)), 'Calories / day');
    } else {
      const sess = await api('/sessions'); const weeks = {}; sess.forEach(s => { const k = ymd(mondayOf(s.started_at)); weeks[k] = (weeks[k] || 0) + 1; });
      const arr = []; const mon = mondayOf(new Date()); for (let i = 5; i >= 0; i--) { const d = new Date(mon); d.setDate(mon.getDate() - i * 7); arr.push(weeks[ymd(d)] || 0); }
      paintBars(arr, ['5w', '4w', '3w', '2w', 'Last', 'This'], arr.length - 1);
    }
  } catch (e) {}
}
async function loadMeasurements() {
  try {
    const m = await api('/measurements'); const latest = {}; m.forEach(r => { if (!latest[r.site]) latest[r.site] = r; });
    const vals = Object.values(latest);
    $('measList').innerHTML = vals.length ? vals.map(r => `<div class="meas"><div class="mn">${esc(r.site)}</div><div class="mv">${r.value_cm} cm</div><div class="md">${new Date(r.measured_at).toLocaleDateString()}</div></div>`).join('') : '<p class="empty">No measurements yet.</p>';
  } catch (e) { $('measList').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
async function loadPRs() {
  try {
    const p = await api('/prs');
    $('prList').innerHTML = p.length ? p.map(r => `<div class="meas"><div class="mn">${esc(r.lift)}</div><div class="mv">${r.value} ${esc(r.unit || 'kg')}</div><div class="md">${new Date(r.achieved_at).toLocaleDateString()}</div></div>`).join('') : '<p class="empty">No personal records yet.</p>';
  } catch (e) { $('prList').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
function renderCalendar(photos) {
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  $('calHead').innerHTML = `<div class="eyebrow">${now.toLocaleString('default', { month: 'long' })} ${y}</div>`;
  const byDay = {}; (photos || []).forEach(p => { if (p.url) { const d = new Date(p.taken_on); if (d.getFullYear() === y && d.getMonth() === mo) byDay[d.getDate()] = p.url; } });
  const first = (new Date(y, mo, 1).getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate();
  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++) cells += '<div class="cell empty"></div>';
  for (let d = 1; d <= days; d++) { const u = byDay[d]; cells += `<div class="cell ${u ? 'has' : ''}">${u ? `<img src="${u}"/>` : ''}<span class="dn">${d}</span></div>`; }
  $('calGrid').innerHTML = cells;
}
async function loadPhotos() { try { renderCalendar(await api('/photos')); } catch (e) { $('calGrid').innerHTML = `<p class="empty">${esc(e.message)}</p>`; } }
async function loadProgress() { renderMetricChips(); drawMetric(); loadMeasurements(); loadPRs(); loadPhotos(); }

// ---------- FRIENDS ----------
async function loadFriends() {
  try { const prof = await api('/profile'); $('myCode').textContent = prof.friend_code || '—'; } catch (e) {}
  try {
    const fr = await api('/friends');
    $('friendList').innerHTML = fr.length ? fr.map(f => `<div class="fcard"><div class="fav">${esc((f.name || '?').slice(0, 1).toUpperCase())}</div><div class="fi"><h3>${esc(f.name || 'Pending user')}</h3><p>${f.status === 'accepted' ? 'Friend' : (f.incoming ? 'Wants to connect' : 'Request sent')}</p></div>${f.incoming ? `<button class="btn btn-primary btn-xs acc" data-id="${f.id}">Accept</button>` : `<span class="badge ${f.status === 'accepted' ? 'ok' : ''}">${f.status === 'accepted' ? '✓' : '…'}</span>`}</div>`).join('') : '<p class="empty">No friends yet. Share your ID to connect.</p>';
    $('friendList').querySelectorAll('.acc').forEach(b => b.onclick = async () => { try { await api('/friends/' + b.dataset.id + '/accept', { method: 'POST' }); loadFriends(); } catch (e) { toast(e.message, 1); } });
  } catch (e) { $('friendList').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  loadFeed();
}
async function loadFeed() {
  try {
    const posts = await api('/feed');
    $('feed').innerHTML = posts.length ? posts.map(p => `<div class="post"><div class="ph">${p.url ? `<img src="${p.url}"/>` : ''}<span class="who">${p.mine ? 'You' : 'Friend'}</span></div><div class="react"><button class="${p.iLove ? 'on-l' : ''}" data-love="${p.id}" data-has="${p.iLove}">♥ ${p.loves}</button><button class="${p.iSupport ? 'on-s' : ''}" data-sup="${p.id}" data-has="${p.iSupport}">▲ ${p.supports}</button></div>${p.mine ? '' : `<div style="text-align:right;margin-top:6px"><span data-report="${p.id}" style="font-size:11px;color:var(--faint);cursor:pointer">Report</span></div>`}</div>`).join('') : '<p class="empty">When friends post a photo, it shows here.</p>';
    $('feed').querySelectorAll('[data-love]').forEach(b => b.onclick = () => react(b.dataset.love, 'love', b.dataset.has === 'true'));
    $('feed').querySelectorAll('[data-sup]').forEach(b => b.onclick = () => react(b.dataset.sup, 'support', b.dataset.has === 'true'));
    $('feed').querySelectorAll('[data-report]').forEach(b => b.onclick = () => reportPost(b.dataset.report));
  } catch (e) { $('feed').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
async function react(id, type, have) { try { await api('/reactions', { method: have ? 'DELETE' : 'POST', body: { post_id: id, type } }); loadFeed(); } catch (e) { toast(e.message, 1); } }
async function reportPost(id) { const reason = prompt('Report this post — what\'s the problem?'); if (reason === null) return; try { await api('/reports', { method: 'POST', body: { target_type: 'post', target_id: id, reason } }); toast('Reported. Thanks for flagging.'); } catch (e) { toast(e.message, 1); } }

// ---------- PROFILE ----------
function calcBMI() { const h = +$('pfH').value / 100, w = +$('pfW').value; $('pfBMI').textContent = (h && w) ? (w / (h * h)).toFixed(1) : '—'; }
async function renderProfileGoals() {
  try { const goals = await api('/goals'); const t = targetsFrom(goals); const pr = PRIMARIES.find(p => p.id === t.primary);
    $('pfGoals').innerHTML = `<div class="kv"><span class="k">Primary goal</span><span class="v">${pr ? pr.name : 'Not set'}</span></div><div class="kv"><span class="k">Daily steps</span><span class="v mono">${t.steps}</span></div><div class="kv"><span class="k">Water</span><span class="v mono">${t.water} ml</span></div><div class="kv"><span class="k">Calories</span><span class="v mono">${t.calories}</span></div>`;
  } catch (e) { $('pfGoals').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
async function loadProfile() {
  closeSub('pfMain', 'pfSub');
  try {
    const [p, me] = await Promise.all([api('/profile'), api('/me')]); ME = p;
    $('pfName').textContent = p.full_name || 'Athlete'; $('pfEmail').textContent = me.email || '';
    $('pfInitial').textContent = (p.full_name || 'A').slice(0, 1).toUpperCase();
    $('pfH').value = p.height_cm || ''; $('pfW').value = p.weight_kg || ''; $('pfLevel').textContent = cap(p.fitness_level || 'beginner');
    calcBMI(); renderProfileGoals();
  } catch (e) { toast(e.message, 1); }
}
async function openGoals() {
  let goals = []; try { goals = await api('/goals'); } catch (e) {}
  const t = targetsFrom(goals); let primary = t.primary;
  openSub('profile', 'pfMain', 'pfSub', `<button class="back" id="gBack">‹ Profile</button><div class="head"><div class="eyebrow">Goals</div><h1>Your goals</h1></div>
    <div class="sec"><h2>Primary focus</h2></div>
    <div class="goalgrid" id="gGrid">${PRIMARIES.map(p => `<div class="gcard ${t.primary === p.id ? 'on' : ''}" data-id="${p.id}"><h3>${p.name}</h3><p>${p.d}</p></div>`).join('')}</div>
    <div class="sec"><h2>Daily targets</h2></div>
    <div class="card"><div class="kv"><span class="k">Steps</span><span class="v"><input id="gSteps" class="mono" inputmode="numeric" value="${t.steps}"/></span></div><div class="kv"><span class="k">Water (ml)</span><span class="v"><input id="gWater" class="mono" inputmode="numeric" value="${t.water}"/></span></div><div class="kv"><span class="k">Sleep (h)</span><span class="v"><input id="gSleep" class="mono" inputmode="numeric" value="${t.sleep}"/></span></div><div class="kv"><span class="k">Calories</span><span class="v"><input id="gCal" class="mono" inputmode="numeric" value="${t.calories}"/></span></div></div>
    <button class="btn btn-accent btn-block" id="gSave" style="margin-top:14px">Save goals</button>`);
  $('gGrid').querySelectorAll('.gcard').forEach(c => c.onclick = () => { primary = c.dataset.id; $('gGrid').querySelectorAll('.gcard').forEach(x => x.classList.toggle('on', x.dataset.id === primary)); });
  $('gBack').onclick = () => { closeSub('pfMain', 'pfSub'); loadProfile(); };
  $('gSave').onclick = async () => {
    const arr = [{ kind: 'primary', target: null, unit: primary || null }, { kind: 'steps', target: +$('gSteps').value || 10000, unit: '' }, { kind: 'water', target: +$('gWater').value || 2500, unit: 'ml' }, { kind: 'sleep', target: +$('gSleep').value || 8, unit: 'h' }, { kind: 'calories', target: +$('gCal').value || 2200, unit: 'kcal' }];
    try { await api('/goals', { method: 'PUT', body: { goals: arr } }); toast('Goals saved'); closeSub('pfMain', 'pfSub'); loadProfile(); } catch (e) { toast(e.message, 1); }
  };
}

// ---------- wire events ----------
$('btnLogin').onclick = signIn;
$('btnSignup').onclick = signUp;
$('toSignup').onclick = () => authView('signup');
$('toLogin').onclick = () => authView('login');
[['liPass', signIn], ['suPass', signUp]].forEach(([id, fn]) => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') fn(); }));

document.querySelectorAll('.nav button').forEach(b => b.onclick = () => go(b.dataset.t));
document.querySelectorAll('#workouts .seg button').forEach(b => b.onclick = () => showWorkoutTab(b.dataset.w));
$('btnNewWorkout').onclick = openBuilder;
$('btnTodayStart').onclick = () => { const p = PROGRAMS[0]; startWorkout(p.name, p.exercises); };
$('toGoals').onclick = openGoals; $('toGoals2').onclick = () => { switchScreen('profile'); openGoals(); };

$('trkStart').onclick = openStartPicker;
$('trkFood').onclick = openNutrition;
$('trkTimer').onclick = openTimer;
$('btnWater').onclick = () => saveDaily({ water_ml: (DAILY.water_ml || 0) + 250 });
$('btnSteps').onclick = () => { const v = prompt('Steps today?', DAILY.steps || ''); if (v !== null) saveDaily({ steps: +v || 0 }); };
$('btnSleep').onclick = () => { const v = prompt('Hours slept?', DAILY.sleep_hours || ''); if (v !== null) saveDaily({ sleep_hours: +v || 0 }); };
$('btnWeight').onclick = () => { const v = prompt('Weight today (kg)?', DAILY.weight_kg || ''); if (v !== null) saveDaily({ weight_kg: +v || 0 }); };
$('restAdd').onclick = () => { restLeft += 15; paintRest(); };
$('restSkip').onclick = () => { clearInterval(restInt); $('restPop').classList.remove('show'); };

$('btnAddMeas').onclick = async () => { const site = prompt('Which measurement? (e.g. Waist, Chest, Arm)'); if (!site) return; const v = prompt(site + ' in cm?'); if (!v) return; try { await api('/measurements', { method: 'POST', body: { site, value_cm: +v } }); loadMeasurements(); } catch (e) { toast(e.message, 1); } };
$('btnAddPr').onclick = async () => { const lift = prompt('Lift name? (e.g. Bench Press)'); if (!lift) return; const v = prompt(lift + ' best (kg)?'); if (!v) return; try { await api('/prs', { method: 'POST', body: { lift, value: +v, unit: 'kg' } }); loadPRs(); } catch (e) { toast(e.message, 1); } };
$('btnAddPhoto2').onclick = () => $('photoUpload').click();
$('photoUpload').onchange = async e => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('photo', f); try { toast('Uploading…'); await api('/photos', { method: 'POST', form: fd }); toast('Photo added'); loadPhotos(); } catch (err) { toast(err.message, 1); } e.target.value = ''; };

$('btnCopy').onclick = () => { const c = $('myCode').textContent; if (navigator.clipboard) navigator.clipboard.writeText(c); toast('ID copied'); };
$('btnAddFriend').onclick = async () => { const c = $('addCode').value.trim(); if (!c) return; try { await api('/friends', { method: 'POST', body: { code: c } }); $('addCode').value = ''; toast('Request sent'); loadFriends(); } catch (e) { toast(e.message, 1); } };

['pfH', 'pfW'].forEach(id => $(id).addEventListener('change', async () => { calcBMI(); try { await api('/profile', { method: 'PATCH', body: { height_cm: +$('pfH').value || null, weight_kg: +$('pfW').value || null } }); toast('Saved'); } catch (e) { toast(e.message, 1); } }));
$('btnLogout').onclick = signOut;
$('btnDeleteAccount').onclick = deleteAccount;

// ---------- boot ----------
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
function hideSplash() { const s = $('splash'); if (!s || s.classList.contains('hide')) return; s.classList.add('hide'); setTimeout(() => { s.style.display = 'none'; }, 440); }
(async function boot() {
  const started = Date.now();
  const status = $('splashStatus');
  const t1 = setTimeout(() => { if (status) status.textContent = 'Waking up the server…'; }, 2500);
  const t2 = setTimeout(() => { if (status) status.textContent = 'Almost there — hang tight…'; }, 12000);
  const t3 = setTimeout(() => { if (status) status.textContent = 'Still starting up…'; }, 30000);
  try { await api('/me'); await onLogin(); }
  catch (e) { showAuth(); }
  finally {
    clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
    setTimeout(hideSplash, Math.max(0, 650 - (Date.now() - started)));
  }
})();
