// Platform demo: exercises src/platform/native.js in the browser.
//
//   node tools/build-web.mjs --demo platform-demo
//   node tools/shot.mjs --path 'dev/platform-demo/index.html?mock=android' --out /tmp/p \
//        --steps-inline '[{"eval":"window.__platformSelfTest()"},{"shot":"demo"}]'
//
// ?mock=android installs a fake window.AndroidBridge that records every call (what the APK's
// NativeBridge.java receives). Without it the Web fallbacks are used. The buttons trigger each
// API by hand; window.__platformSelfTest() runs an automated check and returns a summary.

import { native, createNative, normalizePattern, pickVoice, HAPTICS } from '../platform/native.js';
import iconUrl from '../../web/static/icon-512.png';

const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === 'android';

// ------------------------------------------------------------------ mock bridge
const calls = [];
function makeMockBridge() {
  const rec = (name) => (...args) => {
    calls.push({ name, args });
    log(`AndroidBridge.${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`, 'bridge');
  };
  return {
    vibrate: rec('vibrate'),
    speak: rec('speak'),
    stopSpeaking: rec('stopSpeaking'),
    hasTts: () => (rec('hasTts')(), true),
    hasVibrator: () => true,
    exitApp: rec('exitApp'),
    keepScreenOn: rec('keepScreenOn'),
    getInfo: () => JSON.stringify({ platform: 'android', versionName: '1.0.0', versionCode: 1, sdk: 34, device: 'Mock Pixel', locale: 'ru-RU' }),
  };
}
if (MOCK) window.AndroidBridge = makeMockBridge();

// ------------------------------------------------------------------ page
const css = `
  :root { --cyan:#29E6FF; --crimson:#FF2E63; --gold:#FFD23F; --void:#05030C; }
  body { margin:0; min-height:100%; background:radial-gradient(120% 80% at 50% 0%, #2A0F3A 0%, #120A2A 45%, #05030C 100%);
         color:#fff; font:15px/1.35 Oswald, system-ui, sans-serif; overflow:auto !important; height:auto !important; }
  .wrap { max-width:520px; margin:0 auto; padding:16px; box-sizing:border-box; }
  header { display:flex; gap:14px; align-items:center; margin:6px 0 14px; }
  header img { width:72px; height:72px; border-radius:18px; box-shadow:0 0 24px rgba(41,230,255,.35), 0 0 24px rgba(255,46,99,.3); }
  h1 { font:400 26px/1 "Dela Gothic One", sans-serif; margin:0; letter-spacing:.5px;
       background:linear-gradient(90deg,var(--cyan),#fff 50%,var(--crimson)); -webkit-background-clip:text; color:transparent; }
  .sub { opacity:.75; font-size:13px; margin-top:4px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; margin-top:6px;
           border:1px solid currentColor; }
  .grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; }
  button { font:500 15px Oswald, sans-serif; color:#fff; padding:10px 8px; border-radius:10px; cursor:pointer;
           border:1px solid rgba(255,255,255,.18); background:linear-gradient(180deg, rgba(122,92,255,.28), rgba(18,10,42,.8)); }
  button:active { transform:scale(.97); }
  button.c { border-color:rgba(41,230,255,.6); } button.r { border-color:rgba(255,46,99,.6); } button.g { border-color:rgba(255,210,63,.6); }
  h2 { font:700 13px Oswald, sans-serif; letter-spacing:2px; text-transform:uppercase; opacity:.7; margin:18px 0 8px; }
  #log { font:12px/1.4 ui-monospace, Menlo, monospace; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.1);
         border-radius:10px; padding:8px; height:210px; overflow:auto; white-space:pre-wrap; }
  #log .bridge { color:var(--cyan); } #log .ok { color:#3DDC97; } #log .fail { color:var(--crimson); } #log .ev { color:var(--gold); }
  #result { margin-top:10px; font:400 18px "Russo One", sans-serif; }
`;
document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
const app = document.getElementById('app');
app.innerHTML = `
  <div class="wrap">
    <header>
      <img src="${iconUrl}" alt="">
      <div>
        <h1>EPIC ШАШКИ · platform</h1>
        <div class="sub">src/platform/native.js — haptics, TTS, wake lock, back, pause/resume</div>
        <span class="badge" id="mode"></span>
      </div>
    </header>
    <h2>Haptics</h2>
    <div class="grid">
      <button class="c" data-act="vib40">vibrate(40)</button>
      <button class="c" data-act="vibPattern">vibrate([40,30,80])</button>
      <button class="r" data-act="hCapture">haptic('capture')</button>
      <button class="g" data-act="hUltimate">haptic('ultimate', 1.5)</button>
    </div>
    <h2>Announcer (TTS)</h2>
    <div class="grid">
      <button class="c" data-act="sayCombo">speak('COMBO!')</button>
      <button class="r" data-act="sayRu">speak('Пробуждение!', ru-RU)</button>
      <button data-act="stopSay">stopSpeaking()</button>
      <button data-act="hasTts">hasTTS()</button>
    </div>
    <h2>System</h2>
    <div class="grid">
      <button class="g" data-act="wakeOn">keepScreenOn(true)</button>
      <button data-act="wakeOff">keepScreenOn(false)</button>
      <button class="r" data-act="back">simulate Back</button>
      <button data-act="pause">simulate pause/resume</button>
      <button data-act="info">info()</button>
      <button class="r" data-act="exit">exitApp()</button>
    </div>
    <h2>Log</h2>
    <div id="log"></div>
    <div id="result"></div>
  </div>`;

const logEl = document.getElementById('log');
function log(text, cls = '') {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
document.getElementById('mode').textContent = native.isAndroid ? 'mock AndroidBridge' : 'web fallback';
document.getElementById('mode').style.color = native.isAndroid ? 'var(--cyan)' : 'var(--gold)';

// Back: emulate what MainActivity evaluates (BACK_JS) and decide like Java does.
const BACK_JS = "(function(){try{return window.__androidBack?String(window.__androidBack()):'false'}catch(e){return 'false'}})()";
function simulateBack() {
  // eslint-disable-next-line no-eval
  const value = JSON.stringify((0, eval)(BACK_JS));
  const handled = value === '"true"' || value === 'true';
  log(`back -> ${value} -> ${handled ? 'handled by page' : 'activity.finish()'}`, 'ev');
  return handled;
}

let backDepth = 2; // pretend two nested screens are open
native.setBackHandler(() => {
  if (backDepth > 0) {
    backDepth--;
    log(`page back handler: closed a screen (${backDepth} left)`, 'ev');
    return true;
  }
  log('page back handler: at root -> let the app exit', 'ev');
  return false;
});
native.onPause((e) => log(`onPause (${e.source})`, 'ev'));
native.onResume((e) => log(`onResume (${e.source})`, 'ev'));

const actions = {
  vib40: () => native.vibrate(40),
  vibPattern: () => native.vibrate([40, 30, 80]),
  hCapture: () => native.haptic('capture'),
  hUltimate: () => native.haptic('ultimate', { intensity: 1.5 }),
  sayCombo: () => native.speak('COMBO!', { lang: 'en-US', pitch: 0.8, rate: 1.1 }),
  sayRu: () => native.speak('Пробуждение!', { lang: 'ru-RU', pitch: 0.9 }),
  stopSay: () => native.stopSpeaking(),
  hasTts: () => native.hasTTS(),
  wakeOn: () => native.keepScreenOn(true),
  wakeOff: () => native.keepScreenOn(false),
  back: () => simulateBack(),
  pause: () => {
    window.__androidPause && window.__androidPause();
    window.__androidPause && window.__androidPause(); // duplicate must be ignored
    window.__androidResume && window.__androidResume();
    return native.isPaused;
  },
  info: () => native.info(),
  exit: () => native.exitApp(),
};
app.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const r = actions[btn.dataset.act]();
  log(`${btn.textContent} => ${JSON.stringify(r)}`);
});

// ------------------------------------------------------------------ automated self-test
window.__platformSelfTest = async () => {
  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, ok: !!cond, detail });
    log(`${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`, cond ? 'ok' : 'fail');
  };

  // pure helpers
  check('normalizePattern(40)', JSON.stringify(normalizePattern(40)) === '[40]');
  check('normalizePattern clamps', JSON.stringify(normalizePattern([-3, 99999, 'x', 7.6])) === '[0,5000,0,8]');
  check('normalizePattern caps total 10 s', normalizePattern([5000, 5000, 5000]).reduce((a, b) => a + b) === 10000);
  check('HAPTICS presets start with vibration', Object.values(HAPTICS).every((p) => p[0] > 0));
  const voices = [
    { lang: 'en-GB', localService: true, name: 'gb' },
    { lang: 'en-US', localService: false, name: 'us-net' },
    { lang: 'en_US', localService: true, name: 'us-local' },
    { lang: 'ru-RU', localService: true, name: 'ru' },
  ];
  check('pickVoice exact+local', pickVoice(voices, 'en-US').name === 'us-local');
  check('pickVoice language fallback', pickVoice(voices, 'en-AU').name === 'gb');
  check('pickVoice ru', pickVoice(voices, 'ru').name === 'ru');
  check('pickVoice none', pickVoice(voices, 'ja-JP') === null);

  // facade against a recording fake bridge (independent of ?mock)
  const rec = [];
  const fakeWin = {
    AndroidBridge: {
      vibrate: (s) => rec.push(['vibrate', s]),
      speak: (...a) => rec.push(['speak', ...a]),
      stopSpeaking: () => rec.push(['stopSpeaking']),
      hasTts: () => false,
      exitApp: () => rec.push(['exitApp']),
      keepScreenOn: (b) => rec.push(['keepScreenOn', b]),
      getInfo: () => '{"platform":"android","sdk":30}',
    },
  };
  const n = createNative(fakeWin);
  check('isAndroid with bridge', n.isAndroid === true && n.platform === 'android');
  n.vibrate(40);
  n.vibrate([40, 30, 80]);
  n.vibrate([]);
  check('vibrate → bridge strings', JSON.stringify(rec.splice(0)) === '[["vibrate","40"],["vibrate","[40,30,80]"],["vibrate","[]"]]');
  n.haptic('capture', { intensity: 2 });
  check('haptic scales vibration only', JSON.stringify(rec.splice(0)) === '[["vibrate","[84,28,132]"]]');
  check('haptic intensity 0 = off', n.haptic('capture', { intensity: 0 }) === false && rec.length === 0);
  n.speak('  COMBO!  ', { lang: 'en-US', pitch: 5, rate: 1.2 });
  check('speak → bridge (trim, clamp pitch)', JSON.stringify(rec.splice(0)) === '[["speak","COMBO!","en-US",2,1.2]]');
  check('speak empty is ignored', n.speak('   ') === false && rec.length === 0);
  check('hasTTS from bridge', n.hasTTS() === false);
  n.keepScreenOn(true);
  n.keepScreenOn(0);
  check('keepScreenOn → bridge booleans', JSON.stringify(rec.splice(0)) === '[["keepScreenOn",true],["keepScreenOn",false]]');
  check('exitApp → bridge', n.exitApp() === true && rec.splice(0)[0][0] === 'exitApp');
  check('info() parses bridge JSON', n.info().sdk === 30);

  // back handler semantics (exactly what MainActivity evaluates)
  const evalBack = (w) => {
    const v = w.__androidBack ? String(w.__androidBack()) : 'false';
    return JSON.stringify(v);
  };
  check('no handler → "false"', evalBack(fakeWin) === '"false"');
  n.setBackHandler(() => true);
  check('handler true → "true"', evalBack(fakeWin) === '"true"');
  n.setBackHandler(() => 0);
  check('falsy → "false"', evalBack(fakeWin) === '"false"');
  n.setBackHandler(() => Promise.resolve(false));
  check('async handler counts as handled', evalBack(fakeWin) === '"true"');
  n.setBackHandler(() => {
    throw new Error('boom (expected)');
  });
  const first = evalBack(fakeWin);
  const second = evalBack(fakeWin);
  check('throwing handler: 1st press swallowed, 2nd exits', first === '"true"' && second === '"false"', `${first} ${second}`);
  n.setBackHandler(null);
  check('setBackHandler(null) → "false"', evalBack(fakeWin) === '"false"');

  // pause / resume dedupe
  const ev = [];
  const offP = n.onPause((e) => ev.push('pause:' + e.source));
  n.onResume((e) => ev.push('resume:' + e.source));
  n.onPause(() => {
    throw new Error('listener failure (expected)');
  });
  fakeWin.__androidPause();
  fakeWin.__androidPause();
  check('isPaused', n.isPaused === true);
  fakeWin.__androidResume();
  fakeWin.__androidResume();
  offP();
  fakeWin.__androidPause();
  fakeWin.__androidResume();
  check('pause/resume deduped, unsubscribe works', JSON.stringify(ev) === '["pause:android","resume:android","resume:android"]', JSON.stringify(ev));

  // throwing bridge never leaks
  const boom = () => {
    throw new Error('bridge down (expected)');
  };
  const broken = createNative({ AndroidBridge: { vibrate: boom, speak: boom, hasTts: boom, exitApp: boom, keepScreenOn: boom, stopSpeaking: boom, getInfo: boom } });
  let leaked = false;
  try {
    broken.vibrate(10);
    broken.speak('x');
    broken.stopSpeaking();
    broken.hasTTS();
    broken.exitApp();
    broken.keepScreenOn(true);
    broken.info();
  } catch (e) {
    leaked = true;
  }
  check('throwing bridge is contained', !leaked);

  // no window at all (Node / SSR)
  const none = createNative(null);
  check('null window: all no-ops', none.isAndroid === false && none.vibrate(5) === false && none.speak('a') === false && none.exitApp() === false && none.hasTTS() === false);

  // the real singleton on this page
  if (MOCK) {
    calls.length = 0;
    native.vibrate([10, 20, 30]);
    native.speak('K.O.!', { lang: 'en-US' });
    check('page singleton uses window.AndroidBridge', calls.length === 2 && calls[0].args[0] === '[10,20,30]');
    check('page back handler installed', typeof window.__androidBack === 'function');
  } else {
    check('web: isAndroid false', native.isAndroid === false);
    const ua = navigator.userActivation;
    const expectSkip = !!ua && !ua.hasBeenActive;
    const vr = native.vibrate(30);
    check('web: vibrate before a user gesture is skipped quietly', expectSkip ? vr === false : typeof vr === 'boolean', `returned ${vr}`);
    check('web: hasTTS reflects speechSynthesis', native.hasTTS() === ('speechSynthesis' in window));
    native.keepScreenOn(true);
    await new Promise((r) => setTimeout(r, 300));
    native.keepScreenOn(false);
    check('web: wake lock toggles without throwing', true);
  }

  const failed = results.filter((r) => !r.ok);
  const summary = `${results.length - failed.length}/${results.length} passed`;
  const el = document.getElementById('result');
  el.textContent = failed.length ? `✘ ${summary}` : `✔ ${summary}`;
  el.style.color = failed.length ? 'var(--crimson)' : '#3DDC97';
  return { summary, failed: failed.map((f) => f.name + (f.detail ? ` (${f.detail})` : '')) };
};

log(`ready — ${native.isAndroid ? 'mock bridge' : 'web'}; hasTTS=${native.hasTTS()}`);
