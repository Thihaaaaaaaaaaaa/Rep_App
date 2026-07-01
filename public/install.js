// Detects the visitor's device and shows the right install path.
(function () {
  const $ = id => document.getElementById(id);
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);

  function show(which) {
    ['pIos', 'pAndroid', 'pDesktop'].forEach(id => $(id).classList.remove('on'));
    $({ ios: 'pIos', android: 'pAndroid', desktop: 'pDesktop' }[which]).classList.add('on');
    $('tabIos').classList.toggle('on', which === 'ios');
    $('tabAndroid').classList.toggle('on', which === 'android');
  }

  // initial panel
  if (isIOS) show('ios');
  else if (isAndroid) show('android');
  else show('desktop');

  $('tabIos').onclick = () => show('ios');
  $('tabAndroid').onclick = () => show('android');

  // desktop: show current address to type on phone
  $('urlBox').textContent = location.origin;

  // ---- Android: PWA install prompt ----
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    $('installHint').textContent = 'Tap to add Reps to your home screen.';
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!deferred) { $('installHint').innerHTML = 'Open this page in <b>Chrome</b>, then tap ⋮ → <b>Install app</b>.'; return; }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') $('installHint').textContent = 'Installing… check your home screen.';
  });
  window.addEventListener('appinstalled', () => { $('installHint').textContent = 'Installed! Open Reps from your home screen.'; });

  // ---- APK availability check ----
  fetch('/downloads/reps.apk', { method: 'HEAD' }).then(r => {
    if (!r.ok) throw new Error();
    const len = Number(r.headers.get('content-length') || 0);
    if (len) $('apkNote').textContent = (len / 1048576).toFixed(1) + ' MB';
  }).catch(() => {
    const btn = $('btnApk');
    btn.setAttribute('disabled', '');
    btn.removeAttribute('href');
    $('apkNote').innerHTML = 'APK not uploaded yet — use <b>Install app</b> above for now.';
  });
})();
